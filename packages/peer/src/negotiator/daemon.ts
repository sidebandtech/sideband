// SPDX-License-Identifier: Apache-2.0

/**
 * SBRP daemon negotiator factory.
 *
 * Receives E2EE handshake from client, establishes encrypted channel,
 * then runs an inner SBP handshake for PeerId exchange.
 */

import { asPeerId } from "@sideband/protocol";
import type {
  NegotiationResult,
  Negotiator,
  TransportConnection,
} from "@sideband/runtime";
import { SbpNegotiator } from "@sideband/runtime";
import type { HandshakeInit, SessionId } from "@sideband/secure-relay";
import {
  FrameType,
  SbrpError,
  SbrpErrorCode,
  asClientId,
  clearClientSession,
  computeFingerprint,
  createClientSession,
  decodeControl,
  decodeFrame,
  decodeHandshakeInit,
  decryptClientToDaemon,
  encodeHandshakeAccept,
  encryptDaemonToClient,
  fromWireControlCode,
  processHandshakeInit,
} from "@sideband/secure-relay";
import { generateId } from "../id.js";
import { createSbrpChannel } from "./channel.js";
import { classifySbrpError } from "./classify.js";
import { cancellableTimeout } from "./timeout.js";
import type { SbrpDaemonOptions } from "./types.js";

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * Create a daemon-side SBRP negotiator.
 *
 * Receives SBRP HandshakeInit → creates encrypted channel → inner SBP handshake.
 * Returns a `Negotiator` compatible with `listen({ negotiator: ... })`.
 */
export function sbrpDaemonNegotiator(options: SbrpDaemonOptions): Negotiator {
  const timeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `sbrpDaemonNegotiator: handshakeTimeoutMs must be a finite positive number (got ${timeoutMs})`,
    );
  }

  return {
    async negotiate(conn: TransportConnection): Promise<NegotiationResult> {
      const startTime = Date.now();

      // 1. Receive SBRP HandshakeInit with timeout
      const timer = cancellableTimeout(timeoutMs);
      const initPromise = receiveHandshakeInit(conn);
      // Prevent unhandled rejection if timeout wins the race and
      // the connection close causes the read promise to reject
      initPromise.catch(() => {});
      const initResult = await Promise.race([
        initPromise,
        timer.promise,
      ]).finally(timer.cancel);

      if (initResult === "timeout") {
        throw new SbrpError(
          SbrpErrorCode.HandshakeTimeout,
          "SBRP handshake timed out",
        );
      }

      const { init, sessionId } = initResult;

      // 2. Process init and create accept message
      const { message: acceptMessage, sessionKeys } = processHandshakeInit(
        init,
        options.daemonId,
        options.identityKeyPair,
      );

      // 3. Send SBRP HandshakeAccept (with identity public key in wire format)
      const acceptFrame = encodeHandshakeAccept(sessionId, acceptMessage);
      await conn.send(acceptFrame);

      // 4. Create encrypted channel
      const clientSession = createClientSession(
        asClientId(generateId()),
        sessionKeys,
      );
      const channel = createSbrpChannel(conn, sessionId, {
        encrypt: (p) => encryptDaemonToClient(clientSession, p),
        decrypt: (m) => decryptClientToDaemon(clientSession, m),
        clear: () => clearClientSession(clientSession),
      });

      // 5. Run inner SBP handshake over encrypted channel
      const remainingMs = Math.max(1, timeoutMs - (Date.now() - startTime));
      const innerNegotiator = new SbpNegotiator({
        peerId: asPeerId(options.peerId ?? generateId()),
        capabilities: options.capabilities,
        handshakeTimeoutMs: remainingMs,
      });
      const innerResult = await innerNegotiator.negotiate(channel);

      // 6. Return result with identity info
      const fingerprint = computeFingerprint(options.identityKeyPair.publicKey);
      return {
        peerId: innerResult.peerId,
        identity: { type: "ed25519", fingerprint },
        capabilities: innerResult.capabilities,
        metadata: innerResult.metadata,
        channel,
      };
    },

    async terminate(conn: TransportConnection): Promise<void> {
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

async function receiveHandshakeInit(
  conn: TransportConnection,
): Promise<{ init: HandshakeInit; sessionId: SessionId }> {
  for await (const bytes of conn.inbound) {
    const frame = decodeFrame(bytes);
    if (frame.type === FrameType.HandshakeInit) {
      return {
        init: decodeHandshakeInit(frame),
        sessionId: frame.sessionId,
      };
    }
    // Relay may send Control before handshake completes
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
      `Expected HandshakeInit, got frame type 0x${frame.type.toString(16).padStart(2, "0")}`,
    );
  }
  throw new SbrpError(
    SbrpErrorCode.HandshakeFailed,
    "Connection closed before HandshakeInit received",
  );
}
