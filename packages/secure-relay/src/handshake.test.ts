// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { generateIdentityKeyPair } from "./crypto.js";
import {
  createHandshakeInit,
  processHandshakeAccept,
  processHandshakeInit,
} from "./handshake.js";
import { asDaemonId, SbrpError, SbrpErrorCode } from "./types.js";

describe("handshake", () => {
  const daemonId = asDaemonId("test-daemon-123");

  describe("full handshake flow", () => {
    it("completes handshake between client and daemon", () => {
      const daemonIdentity = generateIdentityKeyPair();

      // Client creates init
      const { message: init, ephemeralKeyPair: clientEphemeral } =
        createHandshakeInit();

      // Daemon processes init and creates accept
      const { message: accept, result: daemonResult } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );

      // Client processes accept
      const clientResult = processHandshakeAccept(
        accept,
        daemonId,
        daemonIdentity.publicKey,
        clientEphemeral,
      );

      // Both should have valid session keys
      expect(clientResult.sessionKeys).toBeDefined();
      expect(daemonResult.sessionKeys).toBeDefined();
    });
  });

  describe("session key derivation", () => {
    it("derives identical session keys on both sides", () => {
      const daemonIdentity = generateIdentityKeyPair();

      const { message: init, ephemeralKeyPair: clientEphemeral } =
        createHandshakeInit();
      const { message: accept, result: daemonResult } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );
      const clientResult = processHandshakeAccept(
        accept,
        daemonId,
        daemonIdentity.publicKey,
        clientEphemeral,
      );

      // Keys should be byte-for-byte identical
      expect(clientResult.sessionKeys.clientToDaemon).toEqual(
        daemonResult.sessionKeys.clientToDaemon,
      );
      expect(clientResult.sessionKeys.daemonToClient).toEqual(
        daemonResult.sessionKeys.daemonToClient,
      );
    });

    it("derives directional keys (clientToDaemon != daemonToClient)", () => {
      const daemonIdentity = generateIdentityKeyPair();

      const { message: init, ephemeralKeyPair: clientEphemeral } =
        createHandshakeInit();
      const { message: accept, result: daemonResult } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );
      const clientResult = processHandshakeAccept(
        accept,
        daemonId,
        daemonIdentity.publicKey,
        clientEphemeral,
      );

      // Directional keys must differ to prevent reflection attacks
      expect(clientResult.sessionKeys.clientToDaemon).not.toEqual(
        clientResult.sessionKeys.daemonToClient,
      );
      expect(daemonResult.sessionKeys.clientToDaemon).not.toEqual(
        daemonResult.sessionKeys.daemonToClient,
      );
    });

    it("produces different keys for different handshakes (ephemeral randomness)", () => {
      const daemonIdentity = generateIdentityKeyPair();

      // First handshake
      const { message: init1, ephemeralKeyPair: clientEphemeral1 } =
        createHandshakeInit();
      const { message: accept1 } = processHandshakeInit(
        init1,
        daemonId,
        daemonIdentity,
      );
      const result1 = processHandshakeAccept(
        accept1,
        daemonId,
        daemonIdentity.publicKey,
        clientEphemeral1,
      );

      // Second handshake
      const { message: init2, ephemeralKeyPair: clientEphemeral2 } =
        createHandshakeInit();
      const { message: accept2 } = processHandshakeInit(
        init2,
        daemonId,
        daemonIdentity,
      );
      const result2 = processHandshakeAccept(
        accept2,
        daemonId,
        daemonIdentity.publicKey,
        clientEphemeral2,
      );

      // Keys from different handshakes should differ
      expect(result1.sessionKeys.clientToDaemon).not.toEqual(
        result2.sessionKeys.clientToDaemon,
      );
      expect(result1.sessionKeys.daemonToClient).not.toEqual(
        result2.sessionKeys.daemonToClient,
      );
    });
  });

  describe("signature verification", () => {
    it("fails with wrong identity key (throws SbrpError with HandshakeFailed)", () => {
      const daemonIdentity = generateIdentityKeyPair();
      const wrongIdentity = generateIdentityKeyPair();

      const { message: init, ephemeralKeyPair: clientEphemeral } =
        createHandshakeInit();
      const { message: accept } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );

      // Client tries to verify with wrong identity key
      expect(() =>
        processHandshakeAccept(
          accept,
          daemonId,
          wrongIdentity.publicKey, // wrong key!
          clientEphemeral,
        ),
      ).toThrow(SbrpError);

      try {
        processHandshakeAccept(
          accept,
          daemonId,
          wrongIdentity.publicKey,
          clientEphemeral,
        );
      } catch (err) {
        expect(err).toBeInstanceOf(SbrpError);
        expect((err as SbrpError).code).toBe(SbrpErrorCode.HandshakeFailed);
      }
    });

    it("fails with tampered signature", () => {
      const daemonIdentity = generateIdentityKeyPair();

      const { message: init, ephemeralKeyPair: clientEphemeral } =
        createHandshakeInit();
      const { message: accept } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );

      // Tamper with the signature
      const tamperedAccept = {
        ...accept,
        signature: new Uint8Array(accept.signature),
      };
      tamperedAccept.signature[0] ^= 0xff; // flip bits

      expect(() =>
        processHandshakeAccept(
          tamperedAccept,
          daemonId,
          daemonIdentity.publicKey,
          clientEphemeral,
        ),
      ).toThrow(SbrpError);
    });

    it("fails with wrong daemon ID in verification", () => {
      const daemonIdentity = generateIdentityKeyPair();
      const wrongDaemonId = asDaemonId("wrong-daemon-456");

      const { message: init, ephemeralKeyPair: clientEphemeral } =
        createHandshakeInit();
      const { message: accept } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );

      // Client tries to verify with wrong daemon ID
      expect(() =>
        processHandshakeAccept(
          accept,
          wrongDaemonId, // wrong daemon ID!
          daemonIdentity.publicKey,
          clientEphemeral,
        ),
      ).toThrow(SbrpError);

      try {
        processHandshakeAccept(
          accept,
          wrongDaemonId,
          daemonIdentity.publicKey,
          clientEphemeral,
        );
      } catch (err) {
        expect(err).toBeInstanceOf(SbrpError);
        expect((err as SbrpError).code).toBe(SbrpErrorCode.HandshakeFailed);
      }
    });
  });

  describe("createHandshakeInit", () => {
    it("returns 32-byte ephemeral public key", () => {
      const { message, ephemeralKeyPair } = createHandshakeInit();

      expect(message.type).toBe("handshake.init");
      expect(message.initPublicKey).toBeInstanceOf(Uint8Array);
      expect(message.initPublicKey.length).toBe(32);
      expect(ephemeralKeyPair.publicKey).toEqual(message.initPublicKey);
      expect(ephemeralKeyPair.privateKey.length).toBe(32);
    });

    it("generates different ephemeral keys each time", () => {
      const result1 = createHandshakeInit();
      const result2 = createHandshakeInit();

      expect(result1.message.initPublicKey).not.toEqual(
        result2.message.initPublicKey,
      );
      expect(result1.ephemeralKeyPair.privateKey).not.toEqual(
        result2.ephemeralKeyPair.privateKey,
      );
    });
  });

  describe("processHandshakeInit", () => {
    it("returns 64-byte signature and 32-byte ephemeral key", () => {
      const daemonIdentity = generateIdentityKeyPair();
      const { message: init } = createHandshakeInit();

      const { message: accept, result } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );

      expect(accept.type).toBe("handshake.accept");
      expect(accept.acceptPublicKey).toBeInstanceOf(Uint8Array);
      expect(accept.acceptPublicKey.length).toBe(32);
      expect(accept.signature).toBeInstanceOf(Uint8Array);
      expect(accept.signature.length).toBe(64);
      expect(result.signature).toEqual(accept.signature);
      expect(result.ephemeralKeyPair.publicKey).toEqual(accept.acceptPublicKey);
    });

    it("generates different ephemeral keys and signatures each time", () => {
      const daemonIdentity = generateIdentityKeyPair();
      const { message: init } = createHandshakeInit();

      const result1 = processHandshakeInit(init, daemonId, daemonIdentity);
      const result2 = processHandshakeInit(init, daemonId, daemonIdentity);

      // Different ephemeral keys
      expect(result1.message.acceptPublicKey).not.toEqual(
        result2.message.acceptPublicKey,
      );

      // Different signatures (due to different ephemeral keys in payload)
      expect(result1.message.signature).not.toEqual(result2.message.signature);
    });
  });

  describe("session key properties", () => {
    it("derives 32-byte symmetric keys", () => {
      const daemonIdentity = generateIdentityKeyPair();

      const { message: init, ephemeralKeyPair: clientEphemeral } =
        createHandshakeInit();
      const { message: accept, result: daemonResult } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );
      const clientResult = processHandshakeAccept(
        accept,
        daemonId,
        daemonIdentity.publicKey,
        clientEphemeral,
      );

      expect(clientResult.sessionKeys.clientToDaemon.length).toBe(32);
      expect(clientResult.sessionKeys.daemonToClient.length).toBe(32);
      expect(daemonResult.sessionKeys.clientToDaemon.length).toBe(32);
      expect(daemonResult.sessionKeys.daemonToClient.length).toBe(32);
    });
  });
});
