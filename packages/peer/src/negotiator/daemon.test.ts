// SPDX-License-Identifier: Apache-2.0

import {
  asDaemonId,
  computeFingerprint,
  encodeControl,
  generateIdentityKeyPair,
  SbrpError,
  SbrpErrorCode,
  WireControlCode,
} from "@sideband/secure-relay";
import { describe, expect, it } from "bun:test";
import { sbrpClientNegotiator } from "./client.js";
import { sbrpDaemonNegotiator } from "./daemon.js";
import { createMemoryIdentityKeyStore } from "./identity-key-store.js";
import { createTransportPair } from "./test-helpers.js";

const daemonId = asDaemonId("test-daemon");
const sessionId = 100n;

describe("sbrpDaemonNegotiator", () => {
  describe("full handshake", () => {
    it("completes handshake with client", async () => {
      const identity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();

      const { clientConn, daemonConn } = createTransportPair();

      const clientNeg = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "auto",
      });

      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      const [clientResult, daemonResult] = await Promise.all([
        clientNeg.negotiate(clientConn),
        daemonNeg.negotiate(daemonConn),
      ]);

      // Both should have peer IDs
      expect(clientResult.peerId).toBeDefined();
      expect(daemonResult.peerId).toBeDefined();

      // Both should have identity info
      expect(clientResult.identity).toBeDefined();
      expect(clientResult.identity!.type).toBe("ed25519");
      expect(daemonResult.identity).toBeDefined();
      expect(daemonResult.identity!.type).toBe("ed25519");

      // Both should return an encrypted channel
      expect(clientResult.channel).toBeDefined();
      expect(daemonResult.channel).toBeDefined();
    });

    it("returns correct daemon fingerprint", async () => {
      const identity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();
      const expectedFingerprint = computeFingerprint(identity.publicKey);

      const { clientConn, daemonConn } = createTransportPair();

      const clientNeg = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "auto",
      });

      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      const [clientResult, daemonResult] = await Promise.all([
        clientNeg.negotiate(clientConn),
        daemonNeg.negotiate(daemonConn),
      ]);

      // Both sides should agree on the fingerprint
      expect(clientResult.identity!.fingerprint).toBe(expectedFingerprint);
      expect(daemonResult.identity!.fingerprint).toBe(expectedFingerprint);
    });

    it("uses custom peerId when provided", async () => {
      const identity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();

      const { clientConn, daemonConn } = createTransportPair();

      const clientNeg = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "auto",
        peerId: "custom-client",
      });

      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
        peerId: "custom-daemon",
      });

      const [clientResult, daemonResult] = await Promise.all([
        clientNeg.negotiate(clientConn),
        daemonNeg.negotiate(daemonConn),
      ]);

      // The peerId in the result is the REMOTE peer's ID
      // Client sees daemon's peerId, daemon sees client's peerId
      expect(String(daemonResult.peerId)).toBe("custom-client");
      expect(String(clientResult.peerId)).toBe("custom-daemon");
    });
  });

  describe("construction validation", () => {
    it.each([0, -1, NaN, Infinity])(
      "throws for invalid handshakeTimeoutMs: %p",
      (value) => {
        const identity = generateIdentityKeyPair();
        expect(() =>
          sbrpDaemonNegotiator({
            daemonId,
            identityKeyPair: identity,
            handshakeTimeoutMs: value,
          }),
        ).toThrow(/finite positive number/);
      },
    );
  });

  describe("handshake control frames", () => {
    it("propagates relay Control code instead of collapsing to HandshakeFailed", async () => {
      const identity = generateIdentityKeyPair();
      const controlFrame = encodeControl(
        sessionId,
        WireControlCode.DaemonOffline,
        "daemon unavailable",
      );

      const conn = {
        id: "mock",
        endpoint: "ws://localhost:8080",
        async send() {},
        async close() {},
        inbound: {
          async *[Symbol.asyncIterator]() {
            yield controlFrame;
          },
        },
      };

      const negotiator = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      const err = await negotiator.negotiate(conn).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SbrpError);
      expect((err as SbrpError).code).toBe(SbrpErrorCode.DaemonOffline);
    });
  });

  describe("classifyError", () => {
    it("classifies handshake_failed as fatal", () => {
      const identity = generateIdentityKeyPair();
      const negotiator = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      expect(
        negotiator.classifyError(
          new SbrpError(SbrpErrorCode.HandshakeFailed, "failed"),
        ),
      ).toBe("fatal");
    });

    it("classifies handshake_timeout as retryable", () => {
      const identity = generateIdentityKeyPair();
      const negotiator = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      expect(
        negotiator.classifyError(
          new SbrpError(SbrpErrorCode.HandshakeTimeout, "timeout"),
        ),
      ).toBe("retryable");
    });

    it("classifies relay terminal codes as fatal", () => {
      const identity = generateIdentityKeyPair();
      const negotiator = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      expect(
        negotiator.classifyError(
          new SbrpError(SbrpErrorCode.Unauthorized, "auth failed"),
        ),
      ).toBe("fatal");

      expect(
        negotiator.classifyError(
          new SbrpError(SbrpErrorCode.MalformedFrame, "bad frame"),
        ),
      ).toBe("fatal");
    });

    it("classifies relay non-terminal codes as retryable", () => {
      const identity = generateIdentityKeyPair();
      const negotiator = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      expect(
        negotiator.classifyError(
          new SbrpError(SbrpErrorCode.DaemonOffline, "offline"),
        ),
      ).toBe("retryable");

      expect(
        negotiator.classifyError(
          new SbrpError(SbrpErrorCode.RateLimited, "slow down"),
        ),
      ).toBe("retryable");
    });

    it("classifies non-SbrpError as retryable", () => {
      const identity = generateIdentityKeyPair();
      const negotiator = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      expect(negotiator.classifyError(new Error("network error"))).toBe(
        "retryable",
      );
    });
  });
});
