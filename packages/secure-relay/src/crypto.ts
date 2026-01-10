// SPDX-License-Identifier: Apache-2.0

/**
 * Cryptographic primitives for Sideband Relay Protocol (SBRP).
 *
 * Uses @noble/curves for Ed25519/X25519, @noble/ciphers for ChaCha20-Poly1305,
 * and @noble/hashes for SHA-256/HKDF.
 */

import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { ed25519 } from "@noble/curves/ed25519";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { concatBytes, randomBytes } from "@noble/hashes/utils";
import {
  AUTH_TAG_LENGTH,
  DIRECTION_CLIENT_TO_DAEMON,
  DIRECTION_DAEMON_TO_CLIENT,
  NONCE_LENGTH,
  SBRP_HANDSHAKE_CONTEXT,
  SBRP_SESSION_KEYS_INFO,
  SBRP_TRANSCRIPT_CONTEXT,
  SESSION_KEYS_LENGTH,
  SYMMETRIC_KEY_LENGTH,
} from "./constants.js";
import type {
  DaemonId,
  EphemeralKeyPair,
  IdentityKeyPair,
  SessionKeys,
} from "./types.js";
import { Direction } from "./types.js";

const textEncoder = new TextEncoder();

/** Generate a new Ed25519 identity keypair */
export function generateIdentityKeyPair(): IdentityKeyPair {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

/** Generate a new X25519 ephemeral keypair */
export function generateEphemeralKeyPair(): EphemeralKeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

/** Compute SHA-256 fingerprint of an identity public key */
export function computeFingerprint(identityPublicKey: Uint8Array): string {
  const hash = sha256(identityPublicKey);
  const hex = Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(":");
  return `SHA256:${hex}`;
}

/**
 * Create the signature payload for handshake authentication.
 *
 * payload = SHA256("sbrp-v1-handshake" || daemonId || clientPublicKey || daemonEphemeralPublicKey)
 */
export function createSignaturePayload(
  daemonId: DaemonId,
  clientPublicKey: Uint8Array,
  daemonEphemeralPublicKey: Uint8Array,
): Uint8Array {
  return sha256(
    concatBytes(
      textEncoder.encode(SBRP_HANDSHAKE_CONTEXT),
      textEncoder.encode(daemonId),
      clientPublicKey,
      daemonEphemeralPublicKey,
    ),
  );
}

/** Sign a payload with an Ed25519 identity private key */
export function signPayload(
  payload: Uint8Array,
  identityPrivateKey: Uint8Array,
): Uint8Array {
  return ed25519.sign(payload, identityPrivateKey);
}

/** Verify an Ed25519 signature */
export function verifySignature(
  payload: Uint8Array,
  signature: Uint8Array,
  identityPublicKey: Uint8Array,
): boolean {
  return ed25519.verify(signature, payload, identityPublicKey);
}

/** Compute X25519 shared secret */
export function computeSharedSecret(
  myPrivateKey: Uint8Array,
  peerPublicKey: Uint8Array,
): Uint8Array {
  return x25519.getSharedSecret(myPrivateKey, peerPublicKey);
}

/**
 * Create the transcript hash for key derivation.
 *
 * transcript = SHA256("sbrp-v1-transcript" || daemonId || clientPublicKey || daemonPublicKey || signature)
 */
export function createTranscriptHash(
  daemonId: DaemonId,
  clientPublicKey: Uint8Array,
  daemonPublicKey: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  return sha256(
    concatBytes(
      textEncoder.encode(SBRP_TRANSCRIPT_CONTEXT),
      textEncoder.encode(daemonId),
      clientPublicKey,
      daemonPublicKey,
      signature,
    ),
  );
}

/**
 * Derive session keys using HKDF-SHA256.
 *
 * Keys are derived with transcript hash as salt to bind to the authenticated session.
 */
export function deriveSessionKeys(
  sharedSecret: Uint8Array,
  transcriptHash: Uint8Array,
): SessionKeys {
  const keys = hkdf(
    sha256,
    sharedSecret,
    transcriptHash,
    SBRP_SESSION_KEYS_INFO,
    SESSION_KEYS_LENGTH,
  );

  return {
    clientToDaemon: keys.slice(0, SYMMETRIC_KEY_LENGTH),
    daemonToClient: keys.slice(SYMMETRIC_KEY_LENGTH, SESSION_KEYS_LENGTH),
  };
}

/**
 * Construct a nonce for ChaCha20-Poly1305.
 *
 * Nonce format (12 bytes):
 * - Bytes 0-3: Direction (0x00000001 = client→daemon, 0x00000002 = daemon→client)
 * - Bytes 4-11: Sequence number (big-endian uint64)
 */
export function constructNonce(direction: Direction, seq: bigint): Uint8Array {
  const nonce = new Uint8Array(NONCE_LENGTH);
  const directionBytes =
    direction === Direction.ClientToDaemon
      ? DIRECTION_CLIENT_TO_DAEMON
      : DIRECTION_DAEMON_TO_CLIENT;

  nonce.set(directionBytes, 0);

  // Write sequence number as big-endian uint64 (bytes 4-11)
  const view = new DataView(nonce.buffer);
  view.setBigUint64(4, seq, false); // false = big-endian

  return nonce;
}

/**
 * Encrypt a message using ChaCha20-Poly1305.
 *
 * Returns: nonce (12 bytes) || ciphertext || authTag (16 bytes)
 */
export function encrypt(
  key: Uint8Array,
  direction: Direction,
  seq: bigint,
  plaintext: Uint8Array,
): Uint8Array {
  const nonce = constructNonce(direction, seq);
  const cipher = chacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(plaintext);

  return concatBytes(nonce, ciphertext);
}

/**
 * Decrypt a message using ChaCha20-Poly1305.
 *
 * Input format: nonce (12 bytes) || ciphertext || authTag (16 bytes)
 * Returns the plaintext, or throws on decryption failure.
 */
export function decrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < NONCE_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted message: too short");
  }

  const nonce = data.slice(0, NONCE_LENGTH);
  const ciphertext = data.slice(NONCE_LENGTH);

  const cipher = chacha20poly1305(key, nonce);
  return cipher.decrypt(ciphertext);
}

/**
 * Extract sequence number from encrypted message data.
 *
 * Reads bytes 4-11 of the nonce as big-endian uint64.
 */
export function extractSequence(data: Uint8Array): bigint {
  if (data.length < NONCE_LENGTH) {
    throw new Error("Invalid encrypted message: too short");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(4, false); // false = big-endian
}

/**
 * Best-effort zeroization of sensitive key material.
 *
 * Note: JavaScript/GC limitations mean this is not guaranteed to prevent
 * key material from remaining in memory.
 */
export function zeroize(data: Uint8Array): void {
  data.fill(0);
}

/** Generate random bytes */
export { randomBytes };
