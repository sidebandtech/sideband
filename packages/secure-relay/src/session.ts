// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Session management for Sideband Relay Protocol (SBRP).
 *
 * Handles encrypted message sending/receiving with proper key selection,
 * sequence number tracking, and replay protection.
 */

import { decrypt, encrypt, extractSequence, zeroize } from "./crypto.js";
import {
  checkAndUpdateReplay,
  createReplayWindow,
  type ReplayWindow,
} from "./replay.js";
import type { ClientId, EncryptedMessage, SessionKeys } from "./types.js";
import { Direction, SbrpError, SbrpErrorCode } from "./types.js";

/** Crypto state for one direction of communication (traffic key, counters, replay) */
interface ChannelState {
  trafficKey: Uint8Array;
  sendSeq: bigint;
  recvWindow: ReplayWindow;
}

/** Client session (daemon-side state for each connected client) */
export interface ClientSession {
  clientId: ClientId;
  clientToDaemon: ChannelState;
  daemonToClient: ChannelState;
}

/** Daemon session (client-side state for communicating with daemon) */
export interface DaemonSession {
  clientToDaemon: ChannelState;
  daemonToClient: ChannelState;
}

/**
 * Create a client session (daemon side).
 *
 * Used by daemon to manage state for each connected client.
 */
export function createClientSession(
  clientId: ClientId,
  sessionKeys: SessionKeys,
): ClientSession {
  return {
    clientId,
    clientToDaemon: {
      trafficKey: sessionKeys.clientToDaemon,
      sendSeq: 0n,
      recvWindow: createReplayWindow(),
    },
    daemonToClient: {
      trafficKey: sessionKeys.daemonToClient,
      sendSeq: 0n,
      recvWindow: createReplayWindow(),
    },
  };
}

/**
 * Create a daemon session (client side).
 *
 * Used by client to communicate with daemon.
 */
export function createDaemonSession(sessionKeys: SessionKeys): DaemonSession {
  return {
    clientToDaemon: {
      trafficKey: sessionKeys.clientToDaemon,
      sendSeq: 0n,
      recvWindow: createReplayWindow(),
    },
    daemonToClient: {
      trafficKey: sessionKeys.daemonToClient,
      sendSeq: 0n,
      recvWindow: createReplayWindow(),
    },
  };
}

/**
 * Encrypt a message from client to daemon.
 */
export function encryptClientToDaemon(
  session: DaemonSession,
  plaintext: Uint8Array,
): EncryptedMessage {
  const seq = session.clientToDaemon.sendSeq++;
  const data = encrypt(
    session.clientToDaemon.trafficKey,
    Direction.ClientToDaemon,
    seq,
    plaintext,
  );

  return { type: "encrypted", seq, data };
}

/**
 * Encrypt a message from daemon to client.
 */
export function encryptDaemonToClient(
  session: ClientSession,
  plaintext: Uint8Array,
): EncryptedMessage {
  const seq = session.daemonToClient.sendSeq++;
  const data = encrypt(
    session.daemonToClient.trafficKey,
    Direction.DaemonToClient,
    seq,
    plaintext,
  );

  return { type: "encrypted", seq, data };
}

/**
 * Decrypt a message received by daemon from client.
 *
 * @throws {SbrpError} with code SequenceError if replay detected
 * @throws {SbrpError} with code DecryptFailed if decryption fails
 */
export function decryptClientToDaemon(
  session: ClientSession,
  message: EncryptedMessage,
): Uint8Array {
  // Check replay protection
  const seq = extractSequence(message.data);
  if (!checkAndUpdateReplay(seq, session.clientToDaemon.recvWindow)) {
    throw new SbrpError(
      SbrpErrorCode.SequenceError,
      "Sequence number outside valid window or replay detected",
    );
  }

  try {
    return decrypt(session.clientToDaemon.trafficKey, message.data);
  } catch {
    throw new SbrpError(
      SbrpErrorCode.DecryptFailed,
      "Message decryption failed",
    );
  }
}

/**
 * Decrypt a message received by client from daemon.
 *
 * @throws {SbrpError} with code SequenceError if replay detected
 * @throws {SbrpError} with code DecryptFailed if decryption fails
 */
export function decryptDaemonToClient(
  session: DaemonSession,
  message: EncryptedMessage,
): Uint8Array {
  // Check replay protection
  const seq = extractSequence(message.data);
  if (!checkAndUpdateReplay(seq, session.daemonToClient.recvWindow)) {
    throw new SbrpError(
      SbrpErrorCode.SequenceError,
      "Sequence number outside valid window or replay detected",
    );
  }

  try {
    return decrypt(session.daemonToClient.trafficKey, message.data);
  } catch {
    throw new SbrpError(
      SbrpErrorCode.DecryptFailed,
      "Message decryption failed",
    );
  }
}

/**
 * Clear all key material from a client session.
 *
 * Best-effort zeroization (JS/GC limitations apply).
 */
export function clearClientSession(session: ClientSession): void {
  zeroize(session.clientToDaemon.trafficKey);
  zeroize(session.daemonToClient.trafficKey);
}

/**
 * Clear all key material from a daemon session.
 *
 * Best-effort zeroization (JS/GC limitations apply).
 */
export function clearDaemonSession(session: DaemonSession): void {
  zeroize(session.clientToDaemon.trafficKey);
  zeroize(session.daemonToClient.trafficKey);
}
