// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @sideband/secure-relay
 *
 * Sideband Relay Protocol (SBRP) implementation for E2EE communication
 * between daemons and clients via a relay server.
 *
 * Features:
 * - Ed25519 identity signatures for MITM protection
 * - X25519 ephemeral key exchange for forward secrecy
 * - ChaCha20-Poly1305 authenticated encryption
 * - TOFU (Trust On First Use) identity pinning
 * - Bitmap-based replay protection
 *
 * @example
 * ```typescript
 * // Daemon side: generate identity keypair on first run
 * const identity = generateIdentityKeyPair();
 *
 * // Client side: create handshake init
 * const { message: init, ephemeralKeyPair } = createHandshakeInit();
 *
 * // Daemon side: process init and create accept
 * const { message: accept, result } = processHandshakeInit(init, daemonId, identity);
 * const clientSession = createClientSession(clientId, result.sessionKeys);
 *
 * // Client side: process accept (with TOFU-pinned identity)
 * const { sessionKeys } = processHandshakeAccept(accept, daemonId, pinnedKey, ephemeralKeyPair);
 * const daemonSession = createDaemonSession(sessionKeys);
 *
 * // Encrypt/decrypt messages
 * const encrypted = encryptClientToDaemon(daemonSession, plaintext);
 * const decrypted = decryptClientToDaemon(clientSession, encrypted);
 * ```
 */

// Types
export type {
  ClientId,
  DaemonId,
  EncryptedMessage,
  EphemeralKeyPair,
  HandshakeAccept,
  HandshakeInit,
  IdentityKeyPair,
  PinnedIdentity,
  SessionKeys,
} from "./types.js";

export {
  asClientId,
  asDaemonId,
  Direction,
  SbrpError,
  SbrpErrorCode,
} from "./types.js";

// Constants
export {
  AUTH_TAG_LENGTH,
  DEFAULT_REPLAY_WINDOW_SIZE,
  DIRECTION_CLIENT_TO_DAEMON,
  DIRECTION_DAEMON_TO_CLIENT,
  ED25519_PRIVATE_KEY_LENGTH,
  ED25519_PUBLIC_KEY_LENGTH,
  ED25519_SIGNATURE_LENGTH,
  NONCE_LENGTH,
  SBRP_HANDSHAKE_CONTEXT,
  SBRP_SESSION_KEYS_INFO,
  SBRP_TRANSCRIPT_CONTEXT,
  SESSION_KEYS_LENGTH,
  SYMMETRIC_KEY_LENGTH,
  X25519_PRIVATE_KEY_LENGTH,
  X25519_PUBLIC_KEY_LENGTH,
} from "./constants.js";

// Crypto primitives
export {
  computeFingerprint,
  computeSharedSecret,
  constructNonce,
  createSignaturePayload,
  createTranscriptHash,
  decrypt,
  deriveSessionKeys,
  encrypt,
  extractSequence,
  generateEphemeralKeyPair,
  generateIdentityKeyPair,
  randomBytes,
  signPayload,
  verifySignature,
  zeroize,
} from "./crypto.js";

// Handshake
export type {
  ClientHandshakeResult,
  DaemonHandshakeResult,
} from "./handshake.js";

export {
  createHandshakeInit,
  processHandshakeAccept,
  processHandshakeInit,
} from "./handshake.js";

// Replay protection
export type { ReplayWindow } from "./replay.js";

export {
  checkAndUpdateReplay,
  createReplayWindow,
  isValidSequence,
  resetReplayWindow,
} from "./replay.js";

// Session management
export type { ClientSession, DaemonSession } from "./session.js";

export {
  clearClientSession,
  clearDaemonSession,
  createClientSession,
  createDaemonSession,
  decryptClientToDaemon,
  decryptDaemonToClient,
  encryptClientToDaemon,
  encryptDaemonToClient,
} from "./session.js";
