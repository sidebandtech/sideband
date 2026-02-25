// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import {
  ED25519_PUBLIC_KEY_LENGTH,
  ED25519_SIGNATURE_LENGTH,
  NONCE_LENGTH,
  SYMMETRIC_KEY_LENGTH,
  X25519_PUBLIC_KEY_LENGTH,
} from "./constants.js";
import {
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
  signPayload,
  verifySignature,
  zeroize,
} from "./crypto.js";
import { asDaemonId, Direction } from "./types.js";

describe("crypto", () => {
  describe("generateIdentityKeyPair", () => {
    it("produces 32-byte public key", () => {
      const { publicKey } = generateIdentityKeyPair();
      expect(publicKey.length).toBe(ED25519_PUBLIC_KEY_LENGTH);
    });

    it("produces 32-byte private key (seed)", () => {
      const { privateKey } = generateIdentityKeyPair();
      expect(privateKey.length).toBe(32);
    });

    it("generates unique keypairs", () => {
      const kp1 = generateIdentityKeyPair();
      const kp2 = generateIdentityKeyPair();
      expect(kp1.publicKey).not.toEqual(kp2.publicKey);
      expect(kp1.privateKey).not.toEqual(kp2.privateKey);
    });
  });

  describe("generateEphemeralKeyPair", () => {
    it("produces 32-byte public key", () => {
      const { publicKey } = generateEphemeralKeyPair();
      expect(publicKey.length).toBe(X25519_PUBLIC_KEY_LENGTH);
    });

    it("produces 32-byte private key", () => {
      const { privateKey } = generateEphemeralKeyPair();
      expect(privateKey.length).toBe(32);
    });

    it("generates unique keypairs", () => {
      const kp1 = generateEphemeralKeyPair();
      const kp2 = generateEphemeralKeyPair();
      expect(kp1.publicKey).not.toEqual(kp2.publicKey);
      expect(kp1.privateKey).not.toEqual(kp2.privateKey);
    });
  });

  describe("computeFingerprint", () => {
    it("produces SHA256:XX:XX:... format", () => {
      const { publicKey } = generateIdentityKeyPair();
      const fingerprint = computeFingerprint(publicKey);
      expect(fingerprint.startsWith("SHA256:")).toBe(true);
    });

    it("produces uppercase hex with colons", () => {
      const { publicKey } = generateIdentityKeyPair();
      const fingerprint = computeFingerprint(publicKey);
      // SHA256: prefix + 32 bytes as hex with colons (64 hex chars + 31 colons)
      expect(fingerprint.length).toBe(7 + 64 + 31); // "SHA256:" + "XX:XX:..."
      const hexPart = fingerprint.slice(7);
      expect(hexPart).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    });

    it("produces consistent fingerprint for same key", () => {
      const { publicKey } = generateIdentityKeyPair();
      const fp1 = computeFingerprint(publicKey);
      const fp2 = computeFingerprint(publicKey);
      expect(fp1).toBe(fp2);
    });

    it("produces different fingerprints for different keys", () => {
      const kp1 = generateIdentityKeyPair();
      const kp2 = generateIdentityKeyPair();
      const fp1 = computeFingerprint(kp1.publicKey);
      const fp2 = computeFingerprint(kp2.publicKey);
      expect(fp1).not.toBe(fp2);
    });
  });

  describe("createSignaturePayload", () => {
    it("returns 32-byte SHA-256 hash", () => {
      const daemonId = asDaemonId("test-daemon");
      const clientPub = new Uint8Array(32).fill(0xaa);
      const daemonEphPub = new Uint8Array(32).fill(0xbb);

      const payload = createSignaturePayload(daemonId, clientPub, daemonEphPub);
      expect(payload.length).toBe(32);
    });

    it("produces consistent hash for same inputs", () => {
      const daemonId = asDaemonId("test-daemon");
      const clientPub = new Uint8Array(32).fill(0xaa);
      const daemonEphPub = new Uint8Array(32).fill(0xbb);

      const p1 = createSignaturePayload(daemonId, clientPub, daemonEphPub);
      const p2 = createSignaturePayload(daemonId, clientPub, daemonEphPub);
      expect(p1).toEqual(p2);
    });

    it("produces different hash for different inputs", () => {
      const clientPub = new Uint8Array(32).fill(0xaa);
      const daemonEphPub = new Uint8Array(32).fill(0xbb);

      const p1 = createSignaturePayload(
        asDaemonId("daemon-1"),
        clientPub,
        daemonEphPub,
      );
      const p2 = createSignaturePayload(
        asDaemonId("daemon-2"),
        clientPub,
        daemonEphPub,
      );
      expect(p1).not.toEqual(p2);
    });
  });

  describe("signPayload / verifySignature", () => {
    it("produces valid signature that verifies", () => {
      const { publicKey, privateKey } = generateIdentityKeyPair();
      const payload = new Uint8Array(32).fill(0x42);

      const signature = signPayload(payload, privateKey);
      expect(signature.length).toBe(ED25519_SIGNATURE_LENGTH);

      const valid = verifySignature(payload, signature, publicKey);
      expect(valid).toBe(true);
    });

    it("rejects tampered signature", () => {
      const { publicKey, privateKey } = generateIdentityKeyPair();
      const payload = new Uint8Array(32).fill(0x42);

      const signature = signPayload(payload, privateKey);
      // Tamper with signature
      signature[0] = signature[0]! ^ 0xff;

      const valid = verifySignature(payload, signature, publicKey);
      expect(valid).toBe(false);
    });

    it("rejects signature from wrong key", () => {
      const kp1 = generateIdentityKeyPair();
      const kp2 = generateIdentityKeyPair();
      const payload = new Uint8Array(32).fill(0x42);

      const signature = signPayload(payload, kp1.privateKey);
      const valid = verifySignature(payload, signature, kp2.publicKey);
      expect(valid).toBe(false);
    });

    it("rejects signature for different payload", () => {
      const { publicKey, privateKey } = generateIdentityKeyPair();
      const payload1 = new Uint8Array(32).fill(0x42);
      const payload2 = new Uint8Array(32).fill(0x43);

      const signature = signPayload(payload1, privateKey);
      const valid = verifySignature(payload2, signature, publicKey);
      expect(valid).toBe(false);
    });
  });

  describe("computeSharedSecret", () => {
    it("produces 32-byte shared secret", () => {
      const alice = generateEphemeralKeyPair();
      const bob = generateEphemeralKeyPair();

      const secretA = computeSharedSecret(alice.privateKey, bob.publicKey);
      expect(secretA.length).toBe(32);
    });

    it("produces same secret from both sides (Diffie-Hellman)", () => {
      const alice = generateEphemeralKeyPair();
      const bob = generateEphemeralKeyPair();

      const secretA = computeSharedSecret(alice.privateKey, bob.publicKey);
      const secretB = computeSharedSecret(bob.privateKey, alice.publicKey);
      expect(secretA).toEqual(secretB);
    });

    it("produces different secrets with different peers", () => {
      const alice = generateEphemeralKeyPair();
      const bob = generateEphemeralKeyPair();
      const charlie = generateEphemeralKeyPair();

      const secretAB = computeSharedSecret(alice.privateKey, bob.publicKey);
      const secretAC = computeSharedSecret(alice.privateKey, charlie.publicKey);
      expect(secretAB).not.toEqual(secretAC);
    });
  });

  describe("createTranscriptHash", () => {
    it("returns 32-byte SHA-256 hash", () => {
      const daemonId = asDaemonId("test-daemon");
      const clientPub = new Uint8Array(32).fill(0xaa);
      const daemonPub = new Uint8Array(32).fill(0xbb);
      const signature = new Uint8Array(64).fill(0xcc);

      const hash = createTranscriptHash(
        daemonId,
        clientPub,
        daemonPub,
        signature,
      );
      expect(hash.length).toBe(32);
    });

    it("produces consistent hash for same inputs", () => {
      const daemonId = asDaemonId("test-daemon");
      const clientPub = new Uint8Array(32).fill(0xaa);
      const daemonPub = new Uint8Array(32).fill(0xbb);
      const signature = new Uint8Array(64).fill(0xcc);

      const h1 = createTranscriptHash(
        daemonId,
        clientPub,
        daemonPub,
        signature,
      );
      const h2 = createTranscriptHash(
        daemonId,
        clientPub,
        daemonPub,
        signature,
      );
      expect(h1).toEqual(h2);
    });

    it("produces different hash for different signatures", () => {
      const daemonId = asDaemonId("test-daemon");
      const clientPub = new Uint8Array(32).fill(0xaa);
      const daemonPub = new Uint8Array(32).fill(0xbb);
      const sig1 = new Uint8Array(64).fill(0xcc);
      const sig2 = new Uint8Array(64).fill(0xdd);

      const h1 = createTranscriptHash(daemonId, clientPub, daemonPub, sig1);
      const h2 = createTranscriptHash(daemonId, clientPub, daemonPub, sig2);
      expect(h1).not.toEqual(h2);
    });
  });

  describe("deriveSessionKeys", () => {
    it("produces two 32-byte keys", () => {
      const sharedSecret = new Uint8Array(32).fill(0x42);
      const transcriptHash = new Uint8Array(32).fill(0x43);

      const keys = deriveSessionKeys(sharedSecret, transcriptHash);
      expect(keys.clientToDaemon.length).toBe(SYMMETRIC_KEY_LENGTH);
      expect(keys.daemonToClient.length).toBe(SYMMETRIC_KEY_LENGTH);
    });

    it("produces different keys for each direction", () => {
      const sharedSecret = new Uint8Array(32).fill(0x42);
      const transcriptHash = new Uint8Array(32).fill(0x43);

      const keys = deriveSessionKeys(sharedSecret, transcriptHash);
      expect(keys.clientToDaemon).not.toEqual(keys.daemonToClient);
    });

    it("produces consistent keys for same inputs", () => {
      const sharedSecret = new Uint8Array(32).fill(0x42);
      const transcriptHash = new Uint8Array(32).fill(0x43);

      const keys1 = deriveSessionKeys(sharedSecret, transcriptHash);
      const keys2 = deriveSessionKeys(sharedSecret, transcriptHash);
      expect(keys1.clientToDaemon).toEqual(keys2.clientToDaemon);
      expect(keys1.daemonToClient).toEqual(keys2.daemonToClient);
    });

    it("produces different keys for different shared secrets", () => {
      const transcriptHash = new Uint8Array(32).fill(0x43);
      const secret1 = new Uint8Array(32).fill(0x42);
      const secret2 = new Uint8Array(32).fill(0x44);

      const keys1 = deriveSessionKeys(secret1, transcriptHash);
      const keys2 = deriveSessionKeys(secret2, transcriptHash);
      expect(keys1.clientToDaemon).not.toEqual(keys2.clientToDaemon);
      expect(keys1.daemonToClient).not.toEqual(keys2.daemonToClient);
    });

    it("produces different keys for different transcript hashes", () => {
      const sharedSecret = new Uint8Array(32).fill(0x42);
      const hash1 = new Uint8Array(32).fill(0x43);
      const hash2 = new Uint8Array(32).fill(0x44);

      const keys1 = deriveSessionKeys(sharedSecret, hash1);
      const keys2 = deriveSessionKeys(sharedSecret, hash2);
      expect(keys1.clientToDaemon).not.toEqual(keys2.clientToDaemon);
    });
  });

  describe("constructNonce", () => {
    it("produces 12-byte nonce", () => {
      const nonce = constructNonce(Direction.ClientToDaemon, 0n);
      expect(nonce.length).toBe(NONCE_LENGTH);
    });

    it("encodes client→daemon direction as 0x00000001", () => {
      const nonce = constructNonce(Direction.ClientToDaemon, 0n);
      expect(nonce[0]).toBe(0);
      expect(nonce[1]).toBe(0);
      expect(nonce[2]).toBe(0);
      expect(nonce[3]).toBe(1);
    });

    it("encodes daemon→client direction as 0x00000002", () => {
      const nonce = constructNonce(Direction.DaemonToClient, 0n);
      expect(nonce[0]).toBe(0);
      expect(nonce[1]).toBe(0);
      expect(nonce[2]).toBe(0);
      expect(nonce[3]).toBe(2);
    });

    it("encodes sequence number in big-endian (bytes 4-11)", () => {
      const nonce = constructNonce(
        Direction.ClientToDaemon,
        0x0102030405060708n,
      );
      expect(nonce[4]).toBe(0x01);
      expect(nonce[5]).toBe(0x02);
      expect(nonce[6]).toBe(0x03);
      expect(nonce[7]).toBe(0x04);
      expect(nonce[8]).toBe(0x05);
      expect(nonce[9]).toBe(0x06);
      expect(nonce[10]).toBe(0x07);
      expect(nonce[11]).toBe(0x08);
    });

    it("handles sequence number 0", () => {
      const nonce = constructNonce(Direction.ClientToDaemon, 0n);
      const view = new DataView(nonce.buffer, nonce.byteOffset);
      expect(view.getBigUint64(4, false)).toBe(0n);
    });

    it("handles max sequence number", () => {
      const maxSeq = 0xffff_ffff_ffff_ffffn;
      const nonce = constructNonce(Direction.ClientToDaemon, maxSeq);
      const view = new DataView(nonce.buffer, nonce.byteOffset);
      expect(view.getBigUint64(4, false)).toBe(maxSeq);
    });
  });

  describe("encrypt / decrypt", () => {
    it("roundtrips plaintext correctly", () => {
      const key = new Uint8Array(32).fill(0x42);
      const plaintext = new TextEncoder().encode("Hello, SBRP!");

      const encrypted = encrypt(key, Direction.ClientToDaemon, 1n, plaintext);
      const decrypted = decrypt(key, encrypted);
      expect(decrypted).toEqual(plaintext);
    });

    it("produces different ciphertext for different sequences", () => {
      const key = new Uint8Array(32).fill(0x42);
      const plaintext = new Uint8Array(16).fill(0xaa);

      const enc1 = encrypt(key, Direction.ClientToDaemon, 1n, plaintext);
      const enc2 = encrypt(key, Direction.ClientToDaemon, 2n, plaintext);
      // Nonces differ, so ciphertext differs
      expect(enc1).not.toEqual(enc2);
    });

    it("produces different ciphertext for different directions", () => {
      const key = new Uint8Array(32).fill(0x42);
      const plaintext = new Uint8Array(16).fill(0xaa);

      const enc1 = encrypt(key, Direction.ClientToDaemon, 1n, plaintext);
      const enc2 = encrypt(key, Direction.DaemonToClient, 1n, plaintext);
      expect(enc1).not.toEqual(enc2);
    });

    it("includes nonce as prefix in output", () => {
      const key = new Uint8Array(32).fill(0x42);
      const plaintext = new Uint8Array(16).fill(0xaa);

      const encrypted = encrypt(key, Direction.ClientToDaemon, 42n, plaintext);
      // First 12 bytes should be the nonce
      expect(encrypted.length).toBeGreaterThanOrEqual(NONCE_LENGTH + 16); // nonce + authTag
      const nonce = encrypted.slice(0, NONCE_LENGTH);
      const expected = constructNonce(Direction.ClientToDaemon, 42n);
      expect(Array.from(nonce)).toEqual(Array.from(expected));
    });

    it("decryption fails with wrong key", () => {
      const key1 = new Uint8Array(32).fill(0x42);
      const key2 = new Uint8Array(32).fill(0x43);
      const plaintext = new TextEncoder().encode("secret");

      const encrypted = encrypt(key1, Direction.ClientToDaemon, 1n, plaintext);
      expect(() => decrypt(key2, encrypted)).toThrow();
    });

    it("decryption fails with tampered ciphertext", () => {
      const key = new Uint8Array(32).fill(0x42);
      const plaintext = new TextEncoder().encode("secret");

      const encrypted = encrypt(key, Direction.ClientToDaemon, 1n, plaintext);
      // Tamper with ciphertext (after nonce)
      encrypted[NONCE_LENGTH + 1] = encrypted[NONCE_LENGTH + 1]! ^ 0xff;

      expect(() => decrypt(key, encrypted)).toThrow();
    });

    it("decryption fails with tampered auth tag", () => {
      const key = new Uint8Array(32).fill(0x42);
      const plaintext = new TextEncoder().encode("secret");

      const encrypted = encrypt(key, Direction.ClientToDaemon, 1n, plaintext);
      // Tamper with last byte (auth tag)
      encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 0xff;

      expect(() => decrypt(key, encrypted)).toThrow();
    });

    it("decryption fails with tampered nonce", () => {
      const key = new Uint8Array(32).fill(0x42);
      const plaintext = new TextEncoder().encode("secret");

      const encrypted = encrypt(key, Direction.ClientToDaemon, 1n, plaintext);
      // Tamper with nonce
      encrypted[0] = encrypted[0]! ^ 0xff;

      expect(() => decrypt(key, encrypted)).toThrow();
    });

    it("rejects message too short", () => {
      const key = new Uint8Array(32).fill(0x42);
      const tooShort = new Uint8Array(NONCE_LENGTH + 15); // 27 bytes, need 28

      expect(() => decrypt(key, tooShort)).toThrow(/too short/);
    });

    it("handles empty plaintext", () => {
      const key = new Uint8Array(32).fill(0x42);
      const plaintext = new Uint8Array(0);

      const encrypted = encrypt(key, Direction.ClientToDaemon, 1n, plaintext);
      const decrypted = decrypt(key, encrypted);
      expect(decrypted.length).toBe(0);
    });

    it("handles large plaintext", () => {
      const key = new Uint8Array(32).fill(0x42);
      const plaintext = new Uint8Array(65536).fill(0xab);

      const encrypted = encrypt(key, Direction.ClientToDaemon, 1n, plaintext);
      const decrypted = decrypt(key, encrypted);
      expect(decrypted).toEqual(plaintext);
    });
  });

  describe("extractSequence", () => {
    it("extracts sequence from encrypted message", () => {
      const key = new Uint8Array(32).fill(0x42);
      const plaintext = new Uint8Array(16);

      const encrypted = encrypt(
        key,
        Direction.ClientToDaemon,
        12345n,
        plaintext,
      );
      const seq = extractSequence(encrypted);
      expect(seq).toBe(12345n);
    });

    it("extracts zero sequence", () => {
      const key = new Uint8Array(32).fill(0x42);
      const plaintext = new Uint8Array(16);

      const encrypted = encrypt(key, Direction.ClientToDaemon, 0n, plaintext);
      const seq = extractSequence(encrypted);
      expect(seq).toBe(0n);
    });

    it("extracts max sequence", () => {
      const key = new Uint8Array(32).fill(0x42);
      const plaintext = new Uint8Array(16);
      const maxSeq = 0xffff_ffff_ffff_ffffn;

      const encrypted = encrypt(
        key,
        Direction.ClientToDaemon,
        maxSeq,
        plaintext,
      );
      const seq = extractSequence(encrypted);
      expect(seq).toBe(maxSeq);
    });

    it("rejects data too short for nonce", () => {
      const tooShort = new Uint8Array(11); // Need at least 12 bytes
      expect(() => extractSequence(tooShort)).toThrow(/too short/);
    });

    it("works with minimum-length encrypted data", () => {
      const nonce = constructNonce(Direction.ClientToDaemon, 42n);
      const seq = extractSequence(nonce);
      expect(seq).toBe(42n);
    });
  });

  describe("zeroize", () => {
    it("fills array with zeros", () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      zeroize(data);
      expect(data).toEqual(new Uint8Array(8));
    });

    it("handles empty array", () => {
      const data = new Uint8Array(0);
      zeroize(data);
      expect(data.length).toBe(0);
    });

    it("handles large array", () => {
      const data = new Uint8Array(1024).fill(0xff);
      zeroize(data);
      expect(data.every((b) => b === 0)).toBe(true);
    });

    it("zeroizes key material", () => {
      const { privateKey } = generateIdentityKeyPair();
      expect(privateKey.some((b) => b !== 0)).toBe(true);

      zeroize(privateKey);
      expect(privateKey.every((b) => b === 0)).toBe(true);
    });
  });

  describe("end-to-end handshake flow", () => {
    it("client and daemon derive same session keys", () => {
      const daemonId = asDaemonId("test-daemon");
      const daemonIdentity = generateIdentityKeyPair();

      // Client generates ephemeral keypair
      const clientEphemeral = generateEphemeralKeyPair();

      // Daemon generates ephemeral keypair
      const daemonEphemeral = generateEphemeralKeyPair();

      // Daemon creates and signs payload
      const payload = createSignaturePayload(
        daemonId,
        clientEphemeral.publicKey,
        daemonEphemeral.publicKey,
      );
      const signature = signPayload(payload, daemonIdentity.privateKey);

      // Client verifies signature
      const valid = verifySignature(
        payload,
        signature,
        daemonIdentity.publicKey,
      );
      expect(valid).toBe(true);

      // Both sides compute shared secret
      const clientSecret = computeSharedSecret(
        clientEphemeral.privateKey,
        daemonEphemeral.publicKey,
      );
      const daemonSecret = computeSharedSecret(
        daemonEphemeral.privateKey,
        clientEphemeral.publicKey,
      );
      expect(clientSecret).toEqual(daemonSecret);

      // Both sides compute transcript hash
      const clientTranscript = createTranscriptHash(
        daemonId,
        clientEphemeral.publicKey,
        daemonEphemeral.publicKey,
        signature,
      );
      const daemonTranscript = createTranscriptHash(
        daemonId,
        clientEphemeral.publicKey,
        daemonEphemeral.publicKey,
        signature,
      );
      expect(clientTranscript).toEqual(daemonTranscript);

      // Both sides derive session keys
      const clientKeys = deriveSessionKeys(clientSecret, clientTranscript);
      const daemonKeys = deriveSessionKeys(daemonSecret, daemonTranscript);
      expect(clientKeys.clientToDaemon).toEqual(daemonKeys.clientToDaemon);
      expect(clientKeys.daemonToClient).toEqual(daemonKeys.daemonToClient);
    });

    it("client can encrypt and daemon can decrypt (and vice versa)", () => {
      const sharedSecret = new Uint8Array(32).fill(0x42);
      const transcriptHash = new Uint8Array(32).fill(0x43);
      const keys = deriveSessionKeys(sharedSecret, transcriptHash);

      const clientMessage = new TextEncoder().encode("Hello from client");
      const daemonMessage = new TextEncoder().encode("Hello from daemon");

      // Client encrypts with clientToDaemon key
      const clientEncrypted = encrypt(
        keys.clientToDaemon,
        Direction.ClientToDaemon,
        1n,
        clientMessage,
      );

      // Daemon decrypts with same key
      const clientDecrypted = decrypt(keys.clientToDaemon, clientEncrypted);
      expect(clientDecrypted).toEqual(clientMessage);

      // Daemon encrypts with daemonToClient key
      const daemonEncrypted = encrypt(
        keys.daemonToClient,
        Direction.DaemonToClient,
        1n,
        daemonMessage,
      );

      // Client decrypts with same key
      const daemonDecrypted = decrypt(keys.daemonToClient, daemonEncrypted);
      expect(daemonDecrypted).toEqual(daemonMessage);
    });
  });
});
