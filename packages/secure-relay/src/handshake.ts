// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * E2EE handshake protocol for Sideband Relay Protocol (SBRP).
 *
 * Implements the authenticated key exchange between client and daemon,
 * with Ed25519 signatures for MITM protection.
 */

import {
  computeSharedSecret,
  createSignaturePayload,
  createTranscriptHash,
  deriveSessionKeys,
  generateEphemeralKeyPair,
  signPayload,
  verifySignature,
  zeroize,
} from "./crypto.js";
import type {
  DaemonId,
  EphemeralKeyPair,
  HandshakeAccept,
  HandshakeInit,
  IdentityKeyPair,
  SessionKeys,
} from "./types.js";
import { SbrpError, SbrpErrorCode } from "./types.js";

/** Result of a successful daemon handshake */
export interface DaemonHandshakeResult {
  sessionKeys: SessionKeys;
  ephemeralKeyPair: EphemeralKeyPair;
  signature: Uint8Array;
}

/** Result of a successful client handshake */
export interface ClientHandshakeResult {
  sessionKeys: SessionKeys;
  ephemeralKeyPair: EphemeralKeyPair;
}

/**
 * Create a handshake init message (client side).
 *
 * Generates an ephemeral X25519 keypair for this session.
 */
export function createHandshakeInit(): {
  message: HandshakeInit;
  ephemeralKeyPair: EphemeralKeyPair;
} {
  const ephemeralKeyPair = generateEphemeralKeyPair();
  return {
    message: {
      type: "handshake.init",
      initPublicKey: ephemeralKeyPair.publicKey,
    },
    ephemeralKeyPair,
  };
}

/**
 * Process handshake init and create accept message (daemon side).
 *
 * 1. Generate ephemeral X25519 keypair
 * 2. Sign ephemeral public key with identity key (context-bound)
 * 3. Derive session keys
 */
export function processHandshakeInit(
  init: HandshakeInit,
  daemonId: DaemonId,
  identityKeyPair: IdentityKeyPair,
): { message: HandshakeAccept; result: DaemonHandshakeResult } {
  const ephemeralKeyPair = generateEphemeralKeyPair();

  // Sign ephemeral key with context binding
  const signaturePayload = createSignaturePayload(
    daemonId,
    init.initPublicKey,
    ephemeralKeyPair.publicKey,
  );
  const signature = signPayload(signaturePayload, identityKeyPair.privateKey);

  // Derive session keys
  const sharedSecret = computeSharedSecret(
    ephemeralKeyPair.privateKey,
    init.initPublicKey,
  );
  const transcriptHash = createTranscriptHash(
    daemonId,
    init.initPublicKey,
    ephemeralKeyPair.publicKey,
    signature,
  );
  const sessionKeys = deriveSessionKeys(sharedSecret, transcriptHash);

  // Best-effort zeroize shared secret
  zeroize(sharedSecret);

  return {
    message: {
      type: "handshake.accept",
      acceptPublicKey: ephemeralKeyPair.publicKey,
      signature,
    },
    result: {
      sessionKeys,
      ephemeralKeyPair,
      signature,
    },
  };
}

/**
 * Process handshake accept message (client side).
 *
 * 1. Verify signature using PINNED identity key (TOFU)
 * 2. Derive session keys using same transcript hash as daemon
 *
 * @throws {SbrpError} with code HandshakeFailed if signature verification fails
 */
export function processHandshakeAccept(
  accept: HandshakeAccept,
  daemonId: DaemonId,
  pinnedIdentityPublicKey: Uint8Array,
  ephemeralKeyPair: EphemeralKeyPair,
): ClientHandshakeResult {
  // Verify daemon signature using PINNED key (not relay-provided!)
  const signaturePayload = createSignaturePayload(
    daemonId,
    ephemeralKeyPair.publicKey,
    accept.acceptPublicKey,
  );

  const valid = verifySignature(
    signaturePayload,
    accept.signature,
    pinnedIdentityPublicKey,
  );

  if (!valid) {
    throw new SbrpError(
      SbrpErrorCode.HandshakeFailed,
      "Signature verification failed",
    );
  }

  // Derive session keys using same transcript hash as daemon
  const sharedSecret = computeSharedSecret(
    ephemeralKeyPair.privateKey,
    accept.acceptPublicKey,
  );
  const transcriptHash = createTranscriptHash(
    daemonId,
    ephemeralKeyPair.publicKey,
    accept.acceptPublicKey,
    accept.signature,
  );
  const sessionKeys = deriveSessionKeys(sharedSecret, transcriptHash);

  // Best-effort zeroize shared secret
  zeroize(sharedSecret);

  return {
    sessionKeys,
    ephemeralKeyPair,
  };
}
