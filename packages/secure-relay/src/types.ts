// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Type definitions for Sideband Relay Protocol (SBRP).
 */

/** Branded type for daemon identifiers */
export type DaemonId = string & { readonly __brand: "DaemonId" };

/** Branded type for client session identifiers (relay-assigned) */
export type ClientId = string & { readonly __brand: "ClientId" };

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

/**
 * TOFU trust record for daemon identity.
 * Pinned on first connect, verified on reconnect to detect MITM.
 * Per-client; not synced via relay.
 */
export interface PinnedIdentity {
  daemonId: DaemonId;
  identityPublicKey: Uint8Array; // 32 bytes Ed25519 public key
  firstSeen: Date;
  lastSeen: Date;
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
export const enum Direction {
  ClientToDaemon = 1,
  DaemonToClient = 2,
}

/** SBRP error codes */
export const enum SbrpErrorCode {
  Unauthorized = "unauthorized",
  DaemonNotFound = "daemon_not_found",
  DaemonOffline = "daemon_offline",
  DaemonNotOwned = "daemon_not_owned",
  IdentityKeyChanged = "identity_key_changed",
  HandshakeFailed = "handshake_failed",
  DecryptFailed = "decrypt_failed",
  SequenceError = "sequence_error",
  RateLimited = "rate_limited",
}

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
