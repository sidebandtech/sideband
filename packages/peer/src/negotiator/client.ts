// SPDX-License-Identifier: Apache-2.0

/**
 * SBRP client negotiator factory.
 *
 * Performs E2EE handshake with TOFU identity verification, then runs
 * an inner SBP handshake over the encrypted channel for PeerId exchange.
 */

import { asPeerId } from "@sideband/protocol";
import type {
  NegotiationResult,
  Negotiator,
  TransportConnection,
} from "@sideband/runtime";
import { SbpNegotiator } from "@sideband/runtime";
import type { SessionId } from "@sideband/secure-relay";
import {
  FrameType,
  SbrpError,
  SbrpErrorCode,
  clearDaemonSession,
  computeFingerprint,
  createDaemonSession,
  createHandshakeInit,
  decodeControl,
  decodeFrame,
  decodeHandshakeAccept,
  decryptDaemonToClient,
  encodeHandshakeInit,
  encryptClientToDaemon,
  fromWireControlCode,
  processHandshakeAccept,
  zeroize,
} from "@sideband/secure-relay";
import { generateId } from "../id.js";
import { createSbrpChannel } from "./channel.js";
import { classifySbrpError } from "./classify.js";
import { cancellableTimeout } from "./timeout.js";
import type { SbrpClientOptions } from "./types.js";

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * Create a client-side SBRP negotiator.
 *
 * Performs SBRP E2EE handshake → TOFU verification → inner SBP handshake.
 * Returns a `Negotiator` compatible with `createPeer({ negotiator: ... })`.
 */
export function sbrpClientNegotiator(options: SbrpClientOptions): Negotiator {
  const trustPolicy = options.trustPolicy ?? "prompt";

  // Fail-fast: "prompt" without callback is a programming error
  if (trustPolicy === "prompt" && !options.onFirstConnection) {
    throw new Error(
      'sbrpClientNegotiator: trustPolicy "prompt" requires onFirstConnection callback',
    );
  }

  const timeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `sbrpClientNegotiator: handshakeTimeoutMs must be a finite positive number (got ${timeoutMs})`,
    );
  }
  const sessionId: SessionId = options.sessionId;

  return {
    async negotiate(conn: TransportConnection): Promise<NegotiationResult> {
      const startTime = Date.now();

      // 1. Create and send SBRP HandshakeInit
      const { message: initMessage, ephemeralKeyPair } = createHandshakeInit();

      try {
        const initFrame = encodeHandshakeInit(sessionId, initMessage);
        await conn.send(initFrame);

        // 2. Receive SBRP HandshakeAccept with timeout
        const timer = cancellableTimeout(timeoutMs);
        const acceptPromise = receiveHandshakeAccept(conn);
        // Prevent unhandled rejection if timeout wins the race and
        // the connection close causes the read promise to reject
        acceptPromise.catch(() => {});
        const acceptResult = await Promise.race([
          acceptPromise,
          timer.promise,
        ]).finally(timer.cancel);

        if (acceptResult === "timeout") {
          throw new SbrpError(
            SbrpErrorCode.HandshakeTimeout,
            "SBRP handshake timed out",
          );
        }

        const accept = acceptResult;

        // 3. Extract daemon's identity public key from wire message
        const wireIdentityKey = accept.identityPublicKey;
        const wireFingerprint = computeFingerprint(wireIdentityKey);

        // 4. TOFU check
        const pinnedKey = await options.identityKeyStore.get(options.daemonId);

        if (pinnedKey) {
          // Key exists — verify it matches
          if (!uint8Equal(pinnedKey, wireIdentityKey)) {
            const pinnedFingerprint = computeFingerprint(pinnedKey);

            if (trustPolicy === "strict") {
              throw new SbrpError(
                SbrpErrorCode.IdentityKeyChanged,
                `Daemon identity key changed (pinned: ${pinnedFingerprint}, received: ${wireFingerprint})`,
              );
            }

            // Ask user via callback (if no callback, reject by default)
            const accepted = await options.onIdentityMismatch?.({
              expectedFingerprint: pinnedFingerprint,
              receivedFingerprint: wireFingerprint,
            });

            if (!accepted) {
              throw new SbrpError(
                SbrpErrorCode.IdentityKeyChanged,
                `Daemon identity key changed (pinned: ${pinnedFingerprint}, received: ${wireFingerprint})`,
              );
            }

            // User accepted the new key — update pin
            await options.identityKeyStore.set(
              options.daemonId,
              wireIdentityKey,
            );
          }
        } else {
          // No pinned key — first connection
          if (trustPolicy === "strict") {
            throw new SbrpError(
              SbrpErrorCode.HandshakeFailed,
              `No pinned identity key for daemon "${options.daemonId}" (strict mode)`,
            );
          }

          if (trustPolicy === "prompt") {
            const accepted = await options.onFirstConnection!({
              fingerprint: wireFingerprint,
            });
            if (!accepted) {
              throw new SbrpError(
                SbrpErrorCode.HandshakeFailed,
                "First connection rejected by user",
              );
            }
          }

          // Pin the identity key ("auto" accepts without callback)
          await options.identityKeyStore.set(options.daemonId, wireIdentityKey);
        }

        // 5. Verify signature and derive session keys
        // (processHandshakeAccept zeroizes ephemeralKeyPair.privateKey on success)
        const sessionKeys = processHandshakeAccept(
          accept,
          options.daemonId,
          wireIdentityKey,
          ephemeralKeyPair,
        );

        // 6. Create encrypted channel
        const daemonSession = createDaemonSession(sessionKeys);
        const channel = createSbrpChannel(conn, sessionId, {
          encrypt: (p) => encryptClientToDaemon(daemonSession, p),
          decrypt: (m) => decryptDaemonToClient(daemonSession, m),
          clear: () => clearDaemonSession(daemonSession),
        });

        // 7. Run inner SBP handshake over encrypted channel for PeerId exchange
        const remainingMs = Math.max(1, timeoutMs - (Date.now() - startTime));
        const innerNegotiator = new SbpNegotiator({
          peerId: asPeerId(options.peerId ?? generateId()),
          capabilities: options.capabilities,
          handshakeTimeoutMs: remainingMs,
        });
        const innerResult = await innerNegotiator.negotiate(channel);

        // 8. Return result with identity info
        return {
          peerId: innerResult.peerId,
          identity: { type: "ed25519", fingerprint: wireFingerprint },
          capabilities: innerResult.capabilities,
          metadata: innerResult.metadata,
          channel,
        };
      } finally {
        // Zeroize ephemeral private key if not already cleared by processHandshakeAccept
        zeroize(ephemeralKeyPair.privateKey);
      }
    },

    async terminate(conn: TransportConnection): Promise<void> {
      // Best-effort close signaling via raw transport (not encrypted channel)
      try {
        await conn.close();
      } catch {
        // Ignore errors during terminate
      }
    },

    classifyError: classifySbrpError,
  };
}

// ────────────────────────────────────────────────────────────────────────────

async function receiveHandshakeAccept(conn: TransportConnection) {
  for await (const bytes of conn.inbound) {
    const frame = decodeFrame(bytes);
    if (frame.type === FrameType.HandshakeAccept) {
      return decodeHandshakeAccept(frame);
    }
    // Relay may send Control before handshake completes (e.g. daemon_offline)
    if (frame.type === FrameType.Control) {
      const control = decodeControl(frame);
      throw new SbrpError(
        fromWireControlCode(control.code),
        control.message || `Relay control during handshake`,
      );
    }
    // Skip keepalive frames (relay may send these at any time)
    if (frame.type === FrameType.Ping || frame.type === FrameType.Pong) {
      continue;
    }
    throw new SbrpError(
      SbrpErrorCode.HandshakeFailed,
      `Expected HandshakeAccept, got frame type 0x${frame.type.toString(16).padStart(2, "0")}`,
    );
  }
  throw new SbrpError(
    SbrpErrorCode.HandshakeFailed,
    "Connection closed before HandshakeAccept received",
  );
}

function uint8Equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
