// SPDX-License-Identifier: Apache-2.0

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

/** Default replay window size (bits). Spec requires ≥64, recommends ≥128. */
export const DEFAULT_REPLAY_WINDOW_SIZE = 128n;

/** Direction bytes in nonce (4 bytes, big-endian) */
export const DIRECTION_CLIENT_TO_DAEMON = new Uint8Array([0, 0, 0, 1]);
export const DIRECTION_DAEMON_TO_CLIENT = new Uint8Array([0, 0, 0, 2]);

// Wire format constants (§13)

/** Frame header size: type (1) + length (4) + sessionId (8) */
export const FRAME_HEADER_SIZE = 13;

/** Maximum payload size in bytes (64 KB) */
export const MAX_PAYLOAD_SIZE = 65536;

/** HandshakeInit payload: X25519 ephemeral public key */
export const HANDSHAKE_INIT_PAYLOAD_SIZE = 32;

/** HandshakeAccept payload: X25519 ephemeral (32) + Ed25519 signature (64) */
export const HANDSHAKE_ACCEPT_PAYLOAD_SIZE = 96;

/** Minimum encrypted payload: nonce (12) + authTag (16), no plaintext */
export const MIN_ENCRYPTED_PAYLOAD_SIZE = NONCE_LENGTH + AUTH_TAG_LENGTH;

/** Control payload minimum: code (2 bytes) */
export const MIN_CONTROL_PAYLOAD_SIZE = 2;

/** Signal payload size: signal (1) + reason (1) */
export const SIGNAL_PAYLOAD_SIZE = 2;

/** Maximum Ping/Pong payload size (0-8 bytes for RTT nonce) */
export const MAX_PING_PAYLOAD_SIZE = 8;
