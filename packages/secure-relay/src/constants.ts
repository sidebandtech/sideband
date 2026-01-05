// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Protocol constants for Sideband Relay Protocol (SBRP).
 */

/** Domain separation context for handshake signature payload */
export const SBRP_HANDSHAKE_CONTEXT = "sbrp-v1-handshake";

/** Domain separation context for transcript hash (HKDF salt) */
export const SBRP_TRANSCRIPT_CONTEXT = "sbrp-v1-transcript";

/** HKDF info string for session key derivation */
export const SBRP_SESSION_KEYS_INFO = "sbrp-session-keys";

/** Length of session keys in bytes (browserToDaemon + daemonToBrowser) */
export const SESSION_KEYS_LENGTH = 64;

/** Length of a single symmetric key in bytes */
export const SYMMETRIC_KEY_LENGTH = 32;

/** Length of Ed25519 public key in bytes */
export const ED25519_PUBLIC_KEY_LENGTH = 32;

/** Length of Ed25519 private key seed in bytes */
export const ED25519_PRIVATE_KEY_LENGTH = 32;

/** Length of Ed25519 signature in bytes */
export const ED25519_SIGNATURE_LENGTH = 64;

/** Length of X25519 public key in bytes */
export const X25519_PUBLIC_KEY_LENGTH = 32;

/** Length of X25519 private key in bytes */
export const X25519_PRIVATE_KEY_LENGTH = 32;

/** Length of ChaCha20-Poly1305 nonce in bytes */
export const NONCE_LENGTH = 12;

/** Length of Poly1305 auth tag in bytes */
export const AUTH_TAG_LENGTH = 16;

/** Default replay window size (bits) */
export const DEFAULT_REPLAY_WINDOW_SIZE = 64n;

/** Direction bytes in nonce (4 bytes, big-endian) */
export const DIRECTION_CLIENT_TO_DAEMON = new Uint8Array([0, 0, 0, 1]);
export const DIRECTION_DAEMON_TO_CLIENT = new Uint8Array([0, 0, 0, 2]);
