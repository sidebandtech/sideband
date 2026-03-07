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
import { createSbrpChannel, createSignalReplayer } from "./channel.js";
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
export function relayClientNegotiator(options: SbrpClientOptions): Negotiator {
  const trustPolicy = options.trustPolicy ?? "prompt";

  // Fail-fast: unknown trustPolicy is a programming error (catches renamed values like "strict")
  if (
    trustPolicy !== "auto" &&
    trustPolicy !== "prompt" &&
    trustPolicy !== "pinned-only"
  ) {
    throw new Error(
      `relayClientNegotiator: unknown trustPolicy "${trustPolicy as string}"`,
    );
  }

  // Fail-fast: "prompt" without callbacks is a programming error
  if (trustPolicy === "prompt" && !options.onFirstConnection) {
    throw new Error(
      'relayClientNegotiator: trustPolicy "prompt" requires onFirstConnection callback',
    );
  }
  if (trustPolicy === "prompt" && !options.onIdentityMismatch) {
    throw new Error(
      'relayClientNegotiator: trustPolicy "prompt" requires onIdentityMismatch callback',
    );
  }

  const timeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `relayClientNegotiator: handshakeTimeoutMs must be a finite positive number (got ${timeoutMs})`,
    );
  }
  const sessionId: SessionId =
    "sessionToken" in options && options.sessionToken !== undefined
      ? extractSessionId(options.sessionToken)
      : (options.sessionId as bigint);

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
            const mismatchMsg = `Daemon identity key changed (pinned: ${pinnedFingerprint}, received: ${wireFingerprint})`;

            if (trustPolicy === "pinned-only") {
              throw new SbrpError(
                SbrpErrorCode.IdentityKeyChanged,
                mismatchMsg,
              );
            }

            if (trustPolicy === "prompt") {
              const accepted = await options.onIdentityMismatch?.({
                expectedFingerprint: pinnedFingerprint,
                receivedFingerprint: wireFingerprint,
              });
              if (!accepted) {
                throw new SbrpError(
                  SbrpErrorCode.IdentityKeyChanged,
                  mismatchMsg,
                );
              }
            }

            // "auto" falls through: silently accept + re-pin (standard TOFU rotation)
            await options.identityKeyStore.set(
              options.daemonId,
              wireIdentityKey,
            );
          }
        } else {
          // No pinned key — first connection
          if (trustPolicy === "pinned-only") {
            throw new SbrpError(
              SbrpErrorCode.HandshakeFailed,
              `No pinned identity key for daemon "${options.daemonId}" (pinned-only mode)`,
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

          // "auto" falls through: pin the identity key without prompting
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

        // 6. Create encrypted channel with signal forwarding
        // Signals arriving during the inner SBP handshake (before the caller
        // invokes subscribeSignals) are buffered and replayed on first subscribe.
        const signals = createSignalReplayer();
        const daemonSession = createDaemonSession(sessionKeys);
        const channel = createSbrpChannel(
          conn,
          sessionId,
          {
            encrypt: (p) => encryptClientToDaemon(daemonSession, p),
            decrypt: (m) => decryptDaemonToClient(daemonSession, m),
            zeroize: () => clearDaemonSession(daemonSession),
          },
          { onSignal: signals.onSignal },
        );

        // 7. Run inner SBP handshake over encrypted channel for PeerId exchange
        const remainingMs = Math.max(1, timeoutMs - (Date.now() - startTime));
        const innerNegotiator = new SbpNegotiator({
          peerId: asPeerId(options.peerId ?? generateId()),
          capabilities: options.capabilities,
          handshakeTimeoutMs: remainingMs,
        });
        const innerResult = await innerNegotiator.negotiate(channel);

        // 8. Return result with identity info and signal subscription
        return {
          peerId: innerResult.peerId,
          identity: { type: "ed25519", fingerprint: wireFingerprint },
          capabilities: innerResult.capabilities,
          metadata: innerResult.metadata,
          channel,
          subscribeSignals: signals.subscribeSignals,
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

/**
 * Extract and validate the `sessionId` (uint64) from a relay session JWT.
 *
 * The relay encodes `sid` as base64url(uint64 ≠ 0) in the JWT payload.
 * We decode without signature verification — the relay validates the full JWT
 * at WebSocket upgrade time.
 *
 * Validation (§4.2 of cloud-relay spec):
 * 1. Split on `.`, take segment [1] (payload), base64url-decode to bytes
 * 2. Parse JSON, extract `sid` string
 * 3. Base64url-decode `sid` to bytes — must be exactly 8 bytes
 * 4. `DataView.getBigUint64(0, false)` — must not be 0n
 *    (DataView avoids Number precision loss for large uint64 values)
 */
function extractSessionId(sessionToken: string): SessionId {
  const fail = (msg: string): never => {
    throw new SbrpError(
      SbrpErrorCode.HandshakeFailed,
      `Invalid session token: ${msg}`,
    );
  };

  const parts = sessionToken.split(".");
  if (parts.length !== 3) fail("not a JWT (expected 3 segments)");

  let payload: Record<string, unknown>;
  try {
    const payloadBytes = base64urlDecode(parts[1]!);
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<
      string,
      unknown
    >;
  } catch {
    fail("payload is not valid base64url JSON");
  }

  const sid = payload!["sid"];
  if (typeof sid !== "string" || sid === "") fail("missing or empty sid claim");

  let sidBytes: Uint8Array;
  try {
    sidBytes = base64urlDecode(sid as string);
  } catch {
    fail("sid is not valid base64url");
  }

  if (sidBytes!.length !== 8) {
    fail(`sid must decode to exactly 8 bytes, got ${sidBytes!.length}`);
  }

  const value = new DataView(
    sidBytes!.buffer,
    sidBytes!.byteOffset,
    8,
  ).getBigUint64(0, false);

  if (value === 0n) fail("sid must not be zero");

  return value;
}

/** Decode a base64url string to bytes (no padding required). */
function base64urlDecode(input: string): Uint8Array {
  // Convert base64url to standard base64
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
