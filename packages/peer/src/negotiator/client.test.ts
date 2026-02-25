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
import { describe, expect, it, mock } from "bun:test";
import { sbrpClientNegotiator } from "./client.js";
import { createMemoryIdentityKeyStore } from "./identity-key-store.js";
import { createTransportPair } from "./test-helpers.js";

const daemonId = asDaemonId("test-daemon");
const sessionId = 100n;

describe("sbrpClientNegotiator", () => {
  describe("construction validation", () => {
    it('throws if trustPolicy "prompt" without onFirstConnection', () => {
      expect(() =>
        sbrpClientNegotiator({
          daemonId,
          sessionId,
          identityKeyStore: createMemoryIdentityKeyStore(),
          trustPolicy: "prompt",
          // no onFirstConnection
        } as any),
      ).toThrow(/requires onFirstConnection/);
    });

    it('throws if trustPolicy "prompt" without onIdentityMismatch', () => {
      expect(() =>
        sbrpClientNegotiator({
          daemonId,
          sessionId,
          identityKeyStore: createMemoryIdentityKeyStore(),
          trustPolicy: "prompt",
          onFirstConnection: async () => true,
          // no onIdentityMismatch
        } as any),
      ).toThrow(/requires onIdentityMismatch/);
    });

    it('does not throw for "auto" without onFirstConnection', () => {
      expect(() =>
        sbrpClientNegotiator({
          daemonId,
          sessionId,
          identityKeyStore: createMemoryIdentityKeyStore(),
          trustPolicy: "auto",
        }),
      ).not.toThrow();
    });

    it('does not throw for "strict" without onFirstConnection', () => {
      expect(() =>
        sbrpClientNegotiator({
          daemonId,
          sessionId,
          identityKeyStore: createMemoryIdentityKeyStore(),
          trustPolicy: "strict",
        }),
      ).not.toThrow();
    });

    it.each([0, -1, NaN, Infinity])(
      "throws for invalid handshakeTimeoutMs: %p",
      (value) => {
        expect(() =>
          sbrpClientNegotiator({
            daemonId,
            sessionId,
            identityKeyStore: createMemoryIdentityKeyStore(),
            trustPolicy: "auto",
            handshakeTimeoutMs: value,
          }),
        ).toThrow(/finite positive number/);
      },
    );
  });

  describe("TOFU trust policy", () => {
    it('"auto" accepts first connection and pins key', async () => {
      const identity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();

      const { clientConn, daemonConn } = createTransportPair();
      const { sbrpDaemonNegotiator } = await import("./daemon.js");

      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "auto",
      });

      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      // Run both sides concurrently
      const [clientResult] = await Promise.all([
        negotiator.negotiate(clientConn),
        daemonNeg.negotiate(daemonConn),
      ]);

      // Key should be pinned
      const pinnedKey = await identityKeyStore.get(daemonId);
      expect(pinnedKey).not.toBeNull();
      expect(pinnedKey).toEqual(identity.publicKey);

      // Identity should be in the result
      expect(clientResult.identity).toBeDefined();
      expect(clientResult.identity!.type).toBe("ed25519");
      expect(clientResult.identity!.fingerprint).toBe(
        computeFingerprint(identity.publicKey),
      );
    });

    it('"prompt" calls onFirstConnection and pins key on acceptance', async () => {
      const identity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();
      const onFirstConnection = mock(async () => true);

      const { clientConn, daemonConn } = createTransportPair();
      const { sbrpDaemonNegotiator } = await import("./daemon.js");

      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "prompt",
        onFirstConnection,
        onIdentityMismatch: async () => true,
      });

      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      await Promise.all([
        negotiator.negotiate(clientConn),
        daemonNeg.negotiate(daemonConn),
      ]);

      expect(onFirstConnection).toHaveBeenCalledTimes(1);
      const pinnedKey = await identityKeyStore.get(daemonId);
      expect(pinnedKey).toEqual(identity.publicKey);
    });

    it('"prompt" rejects when onFirstConnection returns false', async () => {
      const identity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();

      const { clientConn, daemonConn } = createTransportPair();
      const { sbrpDaemonNegotiator } = await import("./daemon.js");

      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "prompt",
        onFirstConnection: async () => false,
        onIdentityMismatch: async () => true,
      });

      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      const clientPromise = negotiator.negotiate(clientConn);
      // Daemon side may throw too when client drops; ignore that
      daemonNeg.negotiate(daemonConn).catch(() => {});

      await expect(clientPromise).rejects.toThrow(SbrpError);

      // Key should NOT be pinned
      const pinnedKey = await identityKeyStore.get(daemonId);
      expect(pinnedKey).toBeNull();
    });

    it('"strict" rejects when no pinned key exists', async () => {
      const identity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();

      const { clientConn, daemonConn } = createTransportPair();
      const { sbrpDaemonNegotiator } = await import("./daemon.js");

      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "strict",
      });

      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      const clientPromise = negotiator.negotiate(clientConn);
      daemonNeg.negotiate(daemonConn).catch(() => {});

      await expect(clientPromise).rejects.toThrow(SbrpError);
      await expect(clientPromise).rejects.toThrow(/strict mode/);
    });

    it('"strict" accepts when pinned key matches', async () => {
      const identity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();
      // Pre-pin the key
      await identityKeyStore.set(daemonId, identity.publicKey);

      const { clientConn, daemonConn } = createTransportPair();
      const { sbrpDaemonNegotiator } = await import("./daemon.js");

      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "strict",
      });

      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      const [clientResult] = await Promise.all([
        negotiator.negotiate(clientConn),
        daemonNeg.negotiate(daemonConn),
      ]);

      expect(clientResult.peerId).toBeDefined();
      expect(clientResult.identity).toBeDefined();
    });

    it("verifies pinned key on subsequent connection", async () => {
      const identity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();
      // Pre-pin the key
      await identityKeyStore.set(daemonId, identity.publicKey);

      const { clientConn, daemonConn } = createTransportPair();
      const { sbrpDaemonNegotiator } = await import("./daemon.js");

      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "auto",
      });

      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
      });

      const [clientResult] = await Promise.all([
        negotiator.negotiate(clientConn),
        daemonNeg.negotiate(daemonConn),
      ]);

      expect(clientResult.peerId).toBeDefined();
    });

    it("prompt: rejects when user denies identity key change", async () => {
      const originalIdentity = generateIdentityKeyPair();
      const newIdentity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();
      await identityKeyStore.set(daemonId, originalIdentity.publicKey);

      const { clientConn, daemonConn } = createTransportPair();
      const { sbrpDaemonNegotiator } = await import("./daemon.js");

      const onIdentityMismatch = mock(async () => false);
      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "prompt",
        onFirstConnection: async () => true, // key is pre-pinned, never called
        onIdentityMismatch,
      });

      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: newIdentity,
      });

      const clientPromise = negotiator.negotiate(clientConn);
      daemonNeg.negotiate(daemonConn).catch(() => {});

      await expect(clientPromise).rejects.toThrow(SbrpError);
      expect(onIdentityMismatch).toHaveBeenCalledTimes(1);
    });

    it("prompt: accepts identity key change when user confirms", async () => {
      const originalIdentity = generateIdentityKeyPair();
      const newIdentity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();
      await identityKeyStore.set(daemonId, originalIdentity.publicKey);

      const { clientConn, daemonConn } = createTransportPair();
      const { sbrpDaemonNegotiator } = await import("./daemon.js");

      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "prompt",
        onFirstConnection: async () => true, // key is pre-pinned, never called
        onIdentityMismatch: async () => true,
      });

      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: newIdentity,
      });

      const [clientResult] = await Promise.all([
        negotiator.negotiate(clientConn),
        daemonNeg.negotiate(daemonConn),
      ]);

      expect(clientResult.peerId).toBeDefined();
      expect(await identityKeyStore.get(daemonId)).toEqual(
        newIdentity.publicKey,
      );
    });

    it("auto: silently re-pins on identity key change without invoking callback", async () => {
      const originalIdentity = generateIdentityKeyPair();
      const newIdentity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();
      await identityKeyStore.set(daemonId, originalIdentity.publicKey);

      const { clientConn, daemonConn } = createTransportPair();
      const { sbrpDaemonNegotiator } = await import("./daemon.js");

      const onIdentityMismatch = mock(async () => false);
      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "auto",
        onIdentityMismatch,
      });

      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: newIdentity,
      });

      const [clientResult] = await Promise.all([
        negotiator.negotiate(clientConn),
        daemonNeg.negotiate(daemonConn),
      ]);

      expect(clientResult.peerId).toBeDefined();
      expect(await identityKeyStore.get(daemonId)).toEqual(
        newIdentity.publicKey,
      );
      // "auto" never consults the callback
      expect(onIdentityMismatch).not.toHaveBeenCalled();
    });
  });

  describe("handshake control frames", () => {
    it("propagates relay Control code instead of collapsing to HandshakeFailed", async () => {
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

      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore: createMemoryIdentityKeyStore(),
        trustPolicy: "auto",
      });

      const err = await negotiator.negotiate(conn).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SbrpError);
      expect((err as SbrpError).code).toBe(SbrpErrorCode.DaemonOffline);
    });
  });

  describe("classifyError", () => {
    it("classifies identity_key_changed as fatal", () => {
      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore: createMemoryIdentityKeyStore(),
        trustPolicy: "auto",
      });

      expect(
        negotiator.classifyError(
          new SbrpError(SbrpErrorCode.IdentityKeyChanged, "changed"),
        ),
      ).toBe("fatal");
    });

    it("classifies handshake_failed as fatal", () => {
      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore: createMemoryIdentityKeyStore(),
        trustPolicy: "auto",
      });

      expect(
        negotiator.classifyError(
          new SbrpError(SbrpErrorCode.HandshakeFailed, "failed"),
        ),
      ).toBe("fatal");
    });

    it("classifies handshake_timeout as retryable", () => {
      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore: createMemoryIdentityKeyStore(),
        trustPolicy: "auto",
      });

      expect(
        negotiator.classifyError(
          new SbrpError(SbrpErrorCode.HandshakeTimeout, "timeout"),
        ),
      ).toBe("retryable");
    });

    it("classifies decrypt_failed as fatal", () => {
      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore: createMemoryIdentityKeyStore(),
        trustPolicy: "auto",
      });

      expect(
        negotiator.classifyError(
          new SbrpError(SbrpErrorCode.DecryptFailed, "failed"),
        ),
      ).toBe("fatal");
    });

    it("classifies relay terminal codes as fatal", () => {
      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore: createMemoryIdentityKeyStore(),
        trustPolicy: "auto",
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

      expect(
        negotiator.classifyError(
          new SbrpError(SbrpErrorCode.SessionExpired, "expired"),
        ),
      ).toBe("fatal");
    });

    it("classifies relay non-terminal codes as retryable", () => {
      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore: createMemoryIdentityKeyStore(),
        trustPolicy: "auto",
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
      const negotiator = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore: createMemoryIdentityKeyStore(),
        trustPolicy: "auto",
      });

      expect(negotiator.classifyError(new Error("network error"))).toBe(
        "retryable",
      );
    });
  });
});
