// SPDX-License-Identifier: Apache-2.0

/**
 * Type definitions for Sideband Relay Protocol (SBRP).
 */

/** Branded type for daemon identifiers */
export type DaemonId = string & { readonly __brand: "DaemonId" };

/** Branded type for client session identifiers (relay-assigned) */
export type ClientId = string & { readonly __brand: "ClientId" };

/**
 * Session identifier (uint64).
 * Assigned by control plane, encoded in JWT `sid` claim as base64url(uint64).
 * Used in frame headers for routing.
 */
export type SessionId = bigint;

/** Ed25519 identity keypair for daemon authentication */
export interface IdentityKeyPair {
  publicKey: Uint8Array; // 32 bytes
  privateKey: Uint8Array; // 32 bytes (seed) or 64 bytes (expanded)
}

/** X25519 ephemeral keypair for key exchange */
export interface EphemeralKeyPair {
  publicKey: Uint8Array; // 32 bytes
  privateKey: Uint8Array; // 32 bytes
}

/** Session keys derived from handshake (directional symmetric keys) */
export interface SessionKeys {
  /** Key for encrypting client→daemon messages */
  clientToDaemon: Uint8Array; // 32 bytes
  /** Key for encrypting daemon→client messages */
  daemonToClient: Uint8Array; // 32 bytes
}

/** Handshake init message (client → daemon) */
export interface HandshakeInit {
  type: "handshake.init";
  initPublicKey: Uint8Array; // X25519 ephemeral public key
}

/** Handshake accept message (daemon → client) */
export interface HandshakeAccept {
  type: "handshake.accept";
  identityPublicKey: Uint8Array; // Ed25519 identity public key (for TOFU)
  acceptPublicKey: Uint8Array; // X25519 ephemeral public key
  signature: Uint8Array; // Ed25519 signature
}

/** Encrypted message envelope */
export interface EncryptedMessage {
  type: "encrypted";
  seq: bigint;
  data: Uint8Array; // nonce || ciphertext || authTag
}

/** Direction of message flow (used in nonce construction) */
export const Direction = {
  ClientToDaemon: 1,
  DaemonToClient: 2,
} as const;

export type Direction = (typeof Direction)[keyof typeof Direction];

/**
 * SBRP error codes (string constants for SDK use).
 *
 * Wire codes use numeric values in Control frames (see frame.ts).
 * These string constants provide type-safe SDK-level error handling.
 */
export const SbrpErrorCode = {
  // Authentication (0x01xx) - Terminal
  Unauthorized: "unauthorized",
  Forbidden: "forbidden",

  // Routing (0x02xx) - Terminal
  DaemonNotFound: "daemon_not_found",
  DaemonOffline: "daemon_offline",

  // Session (0x03xx) - Terminal
  SessionNotFound: "session_not_found",
  SessionExpired: "session_expired",

  // Wire Format (0x04xx) - Terminal
  MalformedFrame: "malformed_frame",
  PayloadTooLarge: "payload_too_large",
  InvalidFrameType: "invalid_frame_type",
  InvalidSessionId: "invalid_session_id",
  DisallowedSender: "disallowed_sender",

  // Internal (0x06xx) - Terminal
  InternalError: "internal_error",

  // Throttling (0x09xx) - Varies (rate_limited=N, backpressure=T)
  RateLimited: "rate_limited",
  Backpressure: "backpressure",

  // Session State (0x10xx) - Non-terminal
  SessionPaused: "session_paused",
  SessionResumed: "session_resumed",
  SessionEnded: "session_ended",
  SessionPending: "session_pending",

  // Endpoint-only (0xExxx) - Never on wire
  IdentityKeyChanged: "identity_key_changed",
  HandshakeFailed: "handshake_failed",
  HandshakeTimeout: "handshake_timeout",
  DecryptFailed: "decrypt_failed",
  SequenceError: "sequence_error",
} as const;

export type SbrpErrorCode = (typeof SbrpErrorCode)[keyof typeof SbrpErrorCode];

/** Signal codes for Signal frame (0x04) */
export const SignalCode = {
  Ready: 0x00,
  Close: 0x01,
} as const;

export type SignalCode = (typeof SignalCode)[keyof typeof SignalCode];

/** Reason codes for Signal frames (§13.4) */
export const SignalReason = {
  /** No specific reason (default for ready signal) */
  None: 0x00,
  /** Process restart, memory cleared */
  StateLost: 0x01,
  /** Graceful daemon shutdown */
  Shutdown: 0x02,
  /** Internal policy denial */
  Policy: 0x03,
  /** Internal daemon error */
  Error: 0x04,
} as const;

export type SignalReason = (typeof SignalReason)[keyof typeof SignalReason];

/** SBRP-specific error */
export class SbrpError extends Error {
  constructor(
    public readonly code: SbrpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SbrpError";
  }
}

/** Brand a string as DaemonId (no validation) */
export function asDaemonId(value: string): DaemonId {
  return value as DaemonId;
}

/** Brand a string as ClientId (no validation) */
export function asClientId(value: string): ClientId {
  return value as ClientId;
}
