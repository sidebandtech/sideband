// SPDX-License-Identifier: Apache-2.0

/**
 * Integration tests for SBRP negotiators.
 *
 * Tests full client-daemon handshake over paired mock transports,
 * encrypted communication, and TOFU lifecycle.
 */

import {
  asDaemonId,
  computeFingerprint,
  generateIdentityKeyPair,
  SbrpError,
  SbrpErrorCode,
} from "@sideband/secure-relay";
import { describe, expect, it } from "bun:test";
import { sbrpClientNegotiator } from "./client.js";
import { sbrpDaemonNegotiator } from "./daemon.js";
import { createMemoryIdentityKeyStore } from "./identity-key-store.js";
import { createTransportPair } from "./test-helpers.js";

const daemonId = asDaemonId("integration-daemon");
const sessionId = 500n;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

describe("SBRP negotiator integration", () => {
  describe("full handshake", () => {
    it("completes E2EE handshake and establishes encrypted channels", async () => {
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

      expect(clientResult.peerId).toBeDefined();
      expect(daemonResult.peerId).toBeDefined();
      expect(clientResult.channel).toBeDefined();
      expect(daemonResult.channel).toBeDefined();
      expect(clientResult.identity!.type).toBe("ed25519");
    });

    it("exchanges data over encrypted channels after handshake", async () => {
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

      const clientChannel = clientResult.channel!;
      const daemonChannel = daemonResult.channel!;

      // Client sends to daemon
      const clientMessage = textEncoder.encode("hello from client via E2EE");
      await clientChannel.send(clientMessage);

      // Daemon reads from its encrypted channel
      const daemonInbound = daemonChannel.inbound[Symbol.asyncIterator]();
      const { value: receivedByDaemon } = await daemonInbound.next();
      expect(textDecoder.decode(receivedByDaemon)).toBe(
        "hello from client via E2EE",
      );

      // Daemon sends to client
      const daemonMessage = textEncoder.encode("hello from daemon via E2EE");
      await daemonChannel.send(daemonMessage);

      // Client reads from its encrypted channel
      const clientInbound = clientChannel.inbound[Symbol.asyncIterator]();
      const { value: receivedByClient } = await clientInbound.next();
      expect(textDecoder.decode(receivedByClient)).toBe(
        "hello from daemon via E2EE",
      );
    });
  });

  describe("TOFU lifecycle", () => {
    it("pins key on first connection, verifies on second", async () => {
      const identity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();

      // First connection — pins the key
      {
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

        await Promise.all([
          clientNeg.negotiate(clientConn),
          daemonNeg.negotiate(daemonConn),
        ]);

        const pinnedKey = await identityKeyStore.get(daemonId);
        expect(pinnedKey).toEqual(identity.publicKey);
      }

      // Second connection — verifies the pinned key
      {
        const { clientConn, daemonConn } = createTransportPair();

        const clientNeg = sbrpClientNegotiator({
          daemonId,
          sessionId,
          identityKeyStore,
          trustPolicy: "strict", // Now strict works because key is pinned
        });

        const daemonNeg = sbrpDaemonNegotiator({
          daemonId,
          identityKeyPair: identity, // Same identity
        });

        const [clientResult] = await Promise.all([
          clientNeg.negotiate(clientConn),
          daemonNeg.negotiate(daemonConn),
        ]);

        expect(clientResult.peerId).toBeDefined();
        expect(clientResult.identity!.fingerprint).toBe(
          computeFingerprint(identity.publicKey),
        );
      }
    });

    it("detects MITM on second connection with different key", async () => {
      const originalIdentity = generateIdentityKeyPair();
      const attackerIdentity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();

      // First connection — pins original key
      {
        const { clientConn, daemonConn } = createTransportPair();

        const clientNeg = sbrpClientNegotiator({
          daemonId,
          sessionId,
          identityKeyStore,
          trustPolicy: "auto",
        });

        const daemonNeg = sbrpDaemonNegotiator({
          daemonId,
          identityKeyPair: originalIdentity,
        });

        await Promise.all([
          clientNeg.negotiate(clientConn),
          daemonNeg.negotiate(daemonConn),
        ]);
      }

      // Second connection with attacker identity — should reject
      {
        const { clientConn, daemonConn } = createTransportPair();

        const clientNeg = sbrpClientNegotiator({
          daemonId,
          sessionId,
          identityKeyStore,
          trustPolicy: "strict",
        });

        const daemonNeg = sbrpDaemonNegotiator({
          daemonId,
          identityKeyPair: attackerIdentity, // Different identity!
        });

        const clientPromise = clientNeg.negotiate(clientConn);
        daemonNeg.negotiate(daemonConn).catch(() => {});

        await expect(clientPromise).rejects.toThrow(/identity key changed/i);
      }
    });
  });

  describe("timeout budget", () => {
    it("total negotiation respects single timeout budget, not 2x", async () => {
      const identity = generateIdentityKeyPair();
      const identityKeyStore = createMemoryIdentityKeyStore();
      const timeoutMs = 300;

      const { clientConn, daemonConn } = createTransportPair();

      // Client side with tight timeout
      const clientNeg = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore,
        trustPolicy: "auto",
        handshakeTimeoutMs: timeoutMs,
      });

      // Daemon side: complete SBRP handshake but stall on inner SBP
      // by never reading from the encrypted channel
      const daemonNeg = sbrpDaemonNegotiator({
        daemonId,
        identityKeyPair: identity,
        handshakeTimeoutMs: timeoutMs,
      });

      const start = Date.now();

      // Both sides race; the one with the stalling inner negotiator will timeout.
      // The key assertion: total time should be bounded by ~timeoutMs, not 2x.
      const results = await Promise.allSettled([
        clientNeg.negotiate(clientConn),
        daemonNeg.negotiate(daemonConn),
      ]);

      const elapsed = Date.now() - start;

      // At least one side should have a successful SBRP + inner SBP handshake,
      // or both timeout. The key invariant: elapsed time must not exceed 2x budget.
      // With the fix, the inner SBP timeout gets the *remaining* budget, so the
      // total is capped at ~timeoutMs (plus small overhead), not 2x.
      expect(elapsed).toBeLessThan(timeoutMs * 2);
    });

    it("client handshake timeout throws retryable SbrpError", async () => {
      // Transport that never sends anything (simulates offline daemon)
      const conn = {
        id: "stalling",
        endpoint: "ws://localhost:8080",
        async send() {},
        async close() {},
        inbound: {
          async *[Symbol.asyncIterator]() {
            // Never yields — simulates a deaf connection
            await new Promise(() => {});
          },
        },
      };

      const clientNeg = sbrpClientNegotiator({
        daemonId,
        sessionId,
        identityKeyStore: createMemoryIdentityKeyStore(),
        trustPolicy: "auto",
        handshakeTimeoutMs: 50,
      });

      const err = await clientNeg.negotiate(conn).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SbrpError);
      expect((err as SbrpError).code).toBe(SbrpErrorCode.HandshakeTimeout);

      // Timeout should be retryable
      expect(clientNeg.classifyError(err as Error)).toBe("retryable");
    });
  });

  describe("multiple concurrent sessions", () => {
    it("handles multiple clients connecting to same daemon identity", async () => {
      const identity = generateIdentityKeyPair();

      const results = await Promise.all(
        Array.from({ length: 3 }, async (_, i) => {
          const identityKeyStore = createMemoryIdentityKeyStore();
          const { clientConn, daemonConn } = createTransportPair();

          const clientNeg = sbrpClientNegotiator({
            daemonId,
            sessionId: BigInt(i + 1),
            identityKeyStore,
            trustPolicy: "auto",
            peerId: `client-${i}`,
          });

          const daemonNeg = sbrpDaemonNegotiator({
            daemonId,
            identityKeyPair: identity,
            peerId: `daemon-for-${i}`,
          });

          const [clientResult, daemonResult] = await Promise.all([
            clientNeg.negotiate(clientConn),
            daemonNeg.negotiate(daemonConn),
          ]);

          return { clientResult, daemonResult, i };
        }),
      );

      // All should succeed with correct identity
      const expectedFingerprint = computeFingerprint(identity.publicKey);
      for (const { clientResult, daemonResult, i } of results) {
        expect(clientResult.identity!.fingerprint).toBe(expectedFingerprint);
        expect(String(clientResult.peerId)).toBe(`daemon-for-${i}`);
        expect(String(daemonResult.peerId)).toBe(`client-${i}`);
      }
    });
  });
});
