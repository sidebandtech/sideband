// SPDX-License-Identifier: Apache-2.0

/**
 * Integration tests for Sideband Relay Protocol (SBRP) E2EE flow.
 *
 * Tests the complete handshake and encryption/decryption cycle
 * between client and daemon, including wire format integration.
 */

import { describe, expect, it } from "bun:test";
import { generateIdentityKeyPair } from "./crypto.js";
import {
  decodeData,
  decodeFrame,
  decodeHandshakeAccept,
  decodeHandshakeInit,
  encodeData,
  encodeHandshakeAccept,
  encodeHandshakeInit,
  FrameType,
} from "./frame.js";
import {
  createHandshakeInit,
  processHandshakeAccept,
  processHandshakeInit,
} from "./handshake.js";
import {
  clearDaemonSession,
  createClientSession,
  createDaemonSession,
  decryptClientToDaemon,
  decryptDaemonToClient,
  encryptClientToDaemon,
  encryptDaemonToClient,
} from "./session.js";
import { asDaemonId, asClientId, SbrpError, SbrpErrorCode } from "./types.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

describe("SBRP E2EE integration", () => {
  describe("complete E2EE flow", () => {
    it("performs full handshake and bidirectional encryption", () => {
      // Setup: Daemon generates identity keypair
      const daemonId = asDaemonId("daemon-001");
      const daemonIdentity = generateIdentityKeyPair();

      // Step 1: Client initiates handshake
      const { message: initMessage, ephemeralKeyPair: clientEphemeral } =
        createHandshakeInit();
      expect(initMessage.type).toBe("handshake.init");
      expect(initMessage.initPublicKey.length).toBe(32);

      // Step 2: Daemon processes init and creates accept
      const { message: acceptMessage, result: daemonResult } =
        processHandshakeInit(initMessage, daemonId, daemonIdentity);
      expect(acceptMessage.type).toBe("handshake.accept");
      expect(acceptMessage.acceptPublicKey.length).toBe(32);
      expect(acceptMessage.signature.length).toBe(64);

      // Step 3: Client verifies signature and derives keys (TOFU - first connection)
      const clientResult = processHandshakeAccept(
        acceptMessage,
        daemonId,
        daemonIdentity.publicKey, // Pinned identity key
        clientEphemeral,
      );

      // Verify both sides derived the same session keys
      expect(clientResult.sessionKeys.clientToDaemon).toEqual(
        daemonResult.sessionKeys.clientToDaemon,
      );
      expect(clientResult.sessionKeys.daemonToClient).toEqual(
        daemonResult.sessionKeys.daemonToClient,
      );

      // Step 4: Create sessions
      const clientId = asClientId("client-session-001");
      const clientSession = createClientSession(
        clientId,
        daemonResult.sessionKeys,
      );
      const daemonSession = createDaemonSession(clientResult.sessionKeys);

      // Step 5: Client encrypts message to daemon
      const clientMessage = textEncoder.encode("Hello from client!");
      const encryptedFromClient = encryptClientToDaemon(
        daemonSession,
        clientMessage,
      );
      expect(encryptedFromClient.type).toBe("encrypted");
      expect(encryptedFromClient.seq).toBe(0n);

      // Step 6: Daemon decrypts client message
      const decryptedByDaemon = decryptClientToDaemon(
        clientSession,
        encryptedFromClient,
      );
      expect(textDecoder.decode(decryptedByDaemon)).toBe("Hello from client!");

      // Step 7: Daemon encrypts response to client
      const daemonMessage = textEncoder.encode("Hello from daemon!");
      const encryptedFromDaemon = encryptDaemonToClient(
        clientSession,
        daemonMessage,
      );
      expect(encryptedFromDaemon.type).toBe("encrypted");
      expect(encryptedFromDaemon.seq).toBe(0n);

      // Step 8: Client decrypts daemon message
      const decryptedByClient = decryptDaemonToClient(
        daemonSession,
        encryptedFromDaemon,
      );
      expect(textDecoder.decode(decryptedByClient)).toBe("Hello from daemon!");
    });

    it("handles multiple messages with incrementing sequence numbers", () => {
      const daemonId = asDaemonId("daemon-002");
      const daemonIdentity = generateIdentityKeyPair();
      const clientId = asClientId("client-002");

      // Complete handshake
      const { message: initMessage, ephemeralKeyPair: clientEphemeral } =
        createHandshakeInit();
      const { message: acceptMessage, result: daemonResult } =
        processHandshakeInit(initMessage, daemonId, daemonIdentity);
      const clientResult = processHandshakeAccept(
        acceptMessage,
        daemonId,
        daemonIdentity.publicKey,
        clientEphemeral,
      );

      const clientSession = createClientSession(
        clientId,
        daemonResult.sessionKeys,
      );
      const daemonSession = createDaemonSession(clientResult.sessionKeys);

      // Send multiple messages from client to daemon
      for (let i = 0; i < 5; i++) {
        const message = textEncoder.encode(`Message ${i}`);
        const encrypted = encryptClientToDaemon(daemonSession, message);
        expect(encrypted.seq).toBe(BigInt(i));

        const decrypted = decryptClientToDaemon(clientSession, encrypted);
        expect(textDecoder.decode(decrypted)).toBe(`Message ${i}`);
      }

      // Send multiple messages from daemon to client
      for (let i = 0; i < 5; i++) {
        const message = textEncoder.encode(`Response ${i}`);
        const encrypted = encryptDaemonToClient(clientSession, message);
        expect(encrypted.seq).toBe(BigInt(i));

        const decrypted = decryptDaemonToClient(daemonSession, encrypted);
        expect(textDecoder.decode(decrypted)).toBe(`Response ${i}`);
      }
    });

    it("handles empty messages", () => {
      const daemonId = asDaemonId("daemon-empty");
      const daemonIdentity = generateIdentityKeyPair();
      const clientId = asClientId("client-empty");

      const { message: initMessage, ephemeralKeyPair: clientEphemeral } =
        createHandshakeInit();
      const { message: acceptMessage, result: daemonResult } =
        processHandshakeInit(initMessage, daemonId, daemonIdentity);
      const clientResult = processHandshakeAccept(
        acceptMessage,
        daemonId,
        daemonIdentity.publicKey,
        clientEphemeral,
      );

      const clientSession = createClientSession(
        clientId,
        daemonResult.sessionKeys,
      );
      const daemonSession = createDaemonSession(clientResult.sessionKeys);

      // Empty message from client
      const emptyMessage = new Uint8Array(0);
      const encrypted = encryptClientToDaemon(daemonSession, emptyMessage);
      const decrypted = decryptClientToDaemon(clientSession, encrypted);
      expect(decrypted.length).toBe(0);
    });

    it("handles large messages", () => {
      const daemonId = asDaemonId("daemon-large");
      const daemonIdentity = generateIdentityKeyPair();
      const clientId = asClientId("client-large");

      const { message: initMessage, ephemeralKeyPair: clientEphemeral } =
        createHandshakeInit();
      const { message: acceptMessage, result: daemonResult } =
        processHandshakeInit(initMessage, daemonId, daemonIdentity);
      const clientResult = processHandshakeAccept(
        acceptMessage,
        daemonId,
        daemonIdentity.publicKey,
        clientEphemeral,
      );

      const clientSession = createClientSession(
        clientId,
        daemonResult.sessionKeys,
      );
      const daemonSession = createDaemonSession(clientResult.sessionKeys);

      // 32KB message
      const largeMessage = new Uint8Array(32 * 1024);
      for (let i = 0; i < largeMessage.length; i++) {
        largeMessage[i] = i % 256;
      }

      const encrypted = encryptClientToDaemon(daemonSession, largeMessage);
      const decrypted = decryptClientToDaemon(clientSession, encrypted);
      expect(decrypted).toEqual(largeMessage);
    });
  });

  describe("multiple sessions", () => {
    it("handles multiple clients with different session keys", () => {
      const daemonId = asDaemonId("daemon-multi");
      const daemonIdentity = generateIdentityKeyPair();

      // Client A initiates handshake
      const { message: initA, ephemeralKeyPair: ephemeralA } =
        createHandshakeInit();
      const { message: acceptA, result: daemonResultA } = processHandshakeInit(
        initA,
        daemonId,
        daemonIdentity,
      );
      const clientResultA = processHandshakeAccept(
        acceptA,
        daemonId,
        daemonIdentity.publicKey,
        ephemeralA,
      );

      // Client B initiates handshake
      const { message: initB, ephemeralKeyPair: ephemeralB } =
        createHandshakeInit();
      const { message: acceptB, result: daemonResultB } = processHandshakeInit(
        initB,
        daemonId,
        daemonIdentity,
      );
      const clientResultB = processHandshakeAccept(
        acceptB,
        daemonId,
        daemonIdentity.publicKey,
        ephemeralB,
      );

      // Verify different session keys for each client
      expect(clientResultA.sessionKeys.clientToDaemon).not.toEqual(
        clientResultB.sessionKeys.clientToDaemon,
      );
      expect(clientResultA.sessionKeys.daemonToClient).not.toEqual(
        clientResultB.sessionKeys.daemonToClient,
      );

      // Create sessions
      const clientSessionA = createClientSession(
        asClientId("client-A"),
        daemonResultA.sessionKeys,
      );
      const clientSessionB = createClientSession(
        asClientId("client-B"),
        daemonResultB.sessionKeys,
      );
      const daemonSessionA = createDaemonSession(clientResultA.sessionKeys);
      const daemonSessionB = createDaemonSession(clientResultB.sessionKeys);

      // Client A sends message
      const messageA = textEncoder.encode("From client A");
      const encryptedA = encryptClientToDaemon(daemonSessionA, messageA);

      // Client B sends message
      const messageB = textEncoder.encode("From client B");
      const encryptedB = encryptClientToDaemon(daemonSessionB, messageB);

      // Daemon decrypts each with correct session
      const decryptedA = decryptClientToDaemon(clientSessionA, encryptedA);
      const decryptedB = decryptClientToDaemon(clientSessionB, encryptedB);

      expect(textDecoder.decode(decryptedA)).toBe("From client A");
      expect(textDecoder.decode(decryptedB)).toBe("From client B");
    });

    it("prevents message cross-session decryption", () => {
      const daemonId = asDaemonId("daemon-cross");
      const daemonIdentity = generateIdentityKeyPair();

      // Two separate sessions
      const { message: init1, ephemeralKeyPair: eph1 } = createHandshakeInit();
      const { message: accept1, result: daemonResult1 } = processHandshakeInit(
        init1,
        daemonId,
        daemonIdentity,
      );
      const clientResult1 = processHandshakeAccept(
        accept1,
        daemonId,
        daemonIdentity.publicKey,
        eph1,
      );

      const { message: init2, ephemeralKeyPair: eph2 } = createHandshakeInit();
      const { message: accept2, result: daemonResult2 } = processHandshakeInit(
        init2,
        daemonId,
        daemonIdentity,
      );
      const clientResult2 = processHandshakeAccept(
        accept2,
        daemonId,
        daemonIdentity.publicKey,
        eph2,
      );

      const clientSession1 = createClientSession(
        asClientId("session-1"),
        daemonResult1.sessionKeys,
      );
      const clientSession2 = createClientSession(
        asClientId("session-2"),
        daemonResult2.sessionKeys,
      );
      const daemonSession1 = createDaemonSession(clientResult1.sessionKeys);

      // Encrypt with session 1
      const message = textEncoder.encode("Secret message");
      const encrypted = encryptClientToDaemon(daemonSession1, message);

      // Attempt to decrypt with session 2 should fail
      expect(() => decryptClientToDaemon(clientSession2, encrypted)).toThrow(
        SbrpError,
      );
    });
  });

  describe("wire format integration", () => {
    it("performs full roundtrip through wire format", () => {
      const sessionId = 12345n;
      const daemonId = asDaemonId("daemon-wire");
      const daemonIdentity = generateIdentityKeyPair();

      // Step 1: Client creates HandshakeInit and encodes to wire
      const { message: initMessage, ephemeralKeyPair: clientEphemeral } =
        createHandshakeInit();
      const initWireFrame = encodeHandshakeInit(sessionId, initMessage);

      // Simulate relay: decode and re-encode (or just forward)
      const initFrame = decodeFrame(initWireFrame);
      expect(initFrame.type).toBe(FrameType.HandshakeInit);
      expect(initFrame.sessionId).toBe(sessionId);

      const decodedInit = decodeHandshakeInit(initFrame);
      expect(decodedInit.initPublicKey).toEqual(initMessage.initPublicKey);

      // Step 2: Daemon receives wire frame, processes, creates accept
      const { message: acceptMessage, result: daemonResult } =
        processHandshakeInit(decodedInit, daemonId, daemonIdentity);
      const acceptWireFrame = encodeHandshakeAccept(sessionId, acceptMessage);

      // Simulate relay forward
      const acceptFrame = decodeFrame(acceptWireFrame);
      expect(acceptFrame.type).toBe(FrameType.HandshakeAccept);
      expect(acceptFrame.sessionId).toBe(sessionId);

      const decodedAccept = decodeHandshakeAccept(acceptFrame);

      // Step 3: Client receives accept, verifies, derives keys
      const clientResult = processHandshakeAccept(
        decodedAccept,
        daemonId,
        daemonIdentity.publicKey,
        clientEphemeral,
      );

      // Create sessions
      const clientSession = createClientSession(
        asClientId("wire-client"),
        daemonResult.sessionKeys,
      );
      const daemonSession = createDaemonSession(clientResult.sessionKeys);

      // Step 4: Client sends encrypted data frame
      const clientMessage = textEncoder.encode("Wire format test!");
      const encryptedFromClient = encryptClientToDaemon(
        daemonSession,
        clientMessage,
      );
      const dataWireFrame = encodeData(sessionId, encryptedFromClient);

      // Simulate relay forward
      const dataFrame = decodeFrame(dataWireFrame);
      expect(dataFrame.type).toBe(FrameType.Data);
      expect(dataFrame.sessionId).toBe(sessionId);

      const decodedData = decodeData(dataFrame);
      expect(decodedData.seq).toBe(0n);

      // Step 5: Daemon decrypts
      const decryptedByDaemon = decryptClientToDaemon(
        clientSession,
        decodedData,
      );
      expect(textDecoder.decode(decryptedByDaemon)).toBe("Wire format test!");

      // Step 6: Daemon responds
      const daemonMessage = textEncoder.encode("Wire format reply!");
      const encryptedFromDaemon = encryptDaemonToClient(
        clientSession,
        daemonMessage,
      );
      const replyWireFrame = encodeData(sessionId, encryptedFromDaemon);

      const replyFrame = decodeFrame(replyWireFrame);
      const decodedReply = decodeData(replyFrame);

      // Step 7: Client decrypts
      const decryptedByClient = decryptDaemonToClient(
        daemonSession,
        decodedReply,
      );
      expect(textDecoder.decode(decryptedByClient)).toBe("Wire format reply!");
    });

    it("handles wire format with different session IDs", () => {
      const daemonId = asDaemonId("daemon-multi-wire");
      const daemonIdentity = generateIdentityKeyPair();

      // Session 1 with sessionId 100
      const { message: init1, ephemeralKeyPair: eph1 } = createHandshakeInit();
      const initWire1 = encodeHandshakeInit(100n, init1);
      const initFrame1 = decodeFrame(initWire1);
      expect(initFrame1.sessionId).toBe(100n);

      // Session 2 with sessionId 200
      const { message: init2, ephemeralKeyPair: eph2 } = createHandshakeInit();
      const initWire2 = encodeHandshakeInit(200n, init2);
      const initFrame2 = decodeFrame(initWire2);
      expect(initFrame2.sessionId).toBe(200n);

      // Different sessionIds mean different routing at relay level
      expect(initFrame1.sessionId).not.toBe(initFrame2.sessionId);

      // Process both handshakes
      const { message: accept1, result: dr1 } = processHandshakeInit(
        decodeHandshakeInit(initFrame1),
        daemonId,
        daemonIdentity,
      );
      const { message: accept2, result: dr2 } = processHandshakeInit(
        decodeHandshakeInit(initFrame2),
        daemonId,
        daemonIdentity,
      );

      const cr1 = processHandshakeAccept(
        accept1,
        daemonId,
        daemonIdentity.publicKey,
        eph1,
      );
      const cr2 = processHandshakeAccept(
        accept2,
        daemonId,
        daemonIdentity.publicKey,
        eph2,
      );

      // Create sessions
      const cs1 = createClientSession(asClientId("c1"), dr1.sessionKeys);
      const cs2 = createClientSession(asClientId("c2"), dr2.sessionKeys);
      const ds1 = createDaemonSession(cr1.sessionKeys);
      const ds2 = createDaemonSession(cr2.sessionKeys);

      // Messages on session 100
      const msg1 = encryptClientToDaemon(
        ds1,
        textEncoder.encode("Session 100"),
      );
      const wire1 = encodeData(100n, msg1);
      const frame1 = decodeFrame(wire1);
      expect(frame1.sessionId).toBe(100n);

      // Messages on session 200
      const msg2 = encryptClientToDaemon(
        ds2,
        textEncoder.encode("Session 200"),
      );
      const wire2 = encodeData(200n, msg2);
      const frame2 = decodeFrame(wire2);
      expect(frame2.sessionId).toBe(200n);

      // Decrypt with correct sessions
      const dec1 = decryptClientToDaemon(cs1, decodeData(frame1));
      const dec2 = decryptClientToDaemon(cs2, decodeData(frame2));
      expect(textDecoder.decode(dec1)).toBe("Session 100");
      expect(textDecoder.decode(dec2)).toBe("Session 200");
    });
  });

  describe("TOFU identity verification", () => {
    it("accepts same identity key on reconnect", () => {
      const daemonId = asDaemonId("daemon-tofu");
      const daemonIdentity = generateIdentityKeyPair();

      // First connection: Pin identity key
      const { message: init1, ephemeralKeyPair: eph1 } = createHandshakeInit();
      const { message: accept1 } = processHandshakeInit(
        init1,
        daemonId,
        daemonIdentity,
      );
      const pinnedKey = daemonIdentity.publicKey;

      // Verify first connection succeeds
      expect(() =>
        processHandshakeAccept(accept1, daemonId, pinnedKey, eph1),
      ).not.toThrow();

      // Second connection with same identity (simulating reconnect)
      const { message: init2, ephemeralKeyPair: eph2 } = createHandshakeInit();
      const { message: accept2 } = processHandshakeInit(
        init2,
        daemonId,
        daemonIdentity, // Same identity keypair
      );

      // Verify with pinned key from first connection
      expect(() =>
        processHandshakeAccept(accept2, daemonId, pinnedKey, eph2),
      ).not.toThrow();
    });

    it("rejects different identity key (MITM detection)", () => {
      const daemonId = asDaemonId("daemon-mitm");
      const realDaemonIdentity = generateIdentityKeyPair();
      const attackerIdentity = generateIdentityKeyPair();

      // First connection: Client pins real daemon's identity key
      const { message: init1, ephemeralKeyPair: eph1 } = createHandshakeInit();
      const { message: accept1 } = processHandshakeInit(
        init1,
        daemonId,
        realDaemonIdentity,
      );
      const pinnedKey = realDaemonIdentity.publicKey;

      // Verify first connection succeeds
      const result1 = processHandshakeAccept(
        accept1,
        daemonId,
        pinnedKey,
        eph1,
      );
      expect(result1.sessionKeys).toBeDefined();

      // Second connection: Attacker tries to impersonate daemon
      const { message: init2, ephemeralKeyPair: eph2 } = createHandshakeInit();
      const { message: attackerAccept } = processHandshakeInit(
        init2,
        daemonId,
        attackerIdentity, // Different identity!
      );

      // Verify with original pinned key should FAIL
      expect(() =>
        processHandshakeAccept(attackerAccept, daemonId, pinnedKey, eph2),
      ).toThrow(SbrpError);
      expect(() =>
        processHandshakeAccept(attackerAccept, daemonId, pinnedKey, eph2),
      ).toThrow(/Signature verification failed/);
    });

    it("detects identity key change scenario", () => {
      const daemonId = asDaemonId("daemon-keychange");

      // Original daemon identity
      const originalIdentity = generateIdentityKeyPair();
      const { message: init1, ephemeralKeyPair: eph1 } = createHandshakeInit();
      const { message: accept1 } = processHandshakeInit(
        init1,
        daemonId,
        originalIdentity,
      );
      const pinnedKey = originalIdentity.publicKey;

      // First connection succeeds and pins key
      processHandshakeAccept(accept1, daemonId, pinnedKey, eph1);

      // Later: Daemon regenerates identity (key rotation or compromise)
      const newIdentity = generateIdentityKeyPair();
      const { message: init2, ephemeralKeyPair: eph2 } = createHandshakeInit();
      const { message: accept2 } = processHandshakeInit(
        init2,
        daemonId,
        newIdentity,
      );

      // Client still has old pinned key - verification fails
      // This is the "identity_key_changed" scenario
      expect(() =>
        processHandshakeAccept(accept2, daemonId, pinnedKey, eph2),
      ).toThrow(SbrpError);
    });
  });

  describe("session resumption state", () => {
    it("fails decryption after session cleared", () => {
      const daemonId = asDaemonId("daemon-clear");
      const daemonIdentity = generateIdentityKeyPair();

      const { message: init, ephemeralKeyPair } = createHandshakeInit();
      const { message: accept, result: daemonResult } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );
      const clientResult = processHandshakeAccept(
        accept,
        daemonId,
        daemonIdentity.publicKey,
        ephemeralKeyPair,
      );

      const clientSession = createClientSession(
        asClientId("clear-test"),
        daemonResult.sessionKeys,
      );
      const daemonSession = createDaemonSession(clientResult.sessionKeys);

      // Encrypt before clearing
      const message = textEncoder.encode("Before clear");
      const encrypted = encryptClientToDaemon(daemonSession, message);

      // Clear daemon session (simulates session expiration or cleanup)
      clearDaemonSession(daemonSession);

      // Old encrypted messages can still be decrypted by daemon
      // because clientSession wasn't cleared
      const decrypted = decryptClientToDaemon(clientSession, encrypted);
      expect(textDecoder.decode(decrypted)).toBe("Before clear");

      // But new messages from cleared session fail (keys zeroed)
      const newMessage = textEncoder.encode("After clear");
      // Encryption will produce garbage since keys are zeroed
      const garbageEncrypted = encryptClientToDaemon(daemonSession, newMessage);

      // Decryption should fail with invalid auth tag
      expect(() =>
        decryptClientToDaemon(clientSession, garbageEncrypted),
      ).toThrow(SbrpError);
    });

    it("requires new handshake after session clear", () => {
      const daemonId = asDaemonId("daemon-newhs");
      const daemonIdentity = generateIdentityKeyPair();

      // First session
      const { message: init1, ephemeralKeyPair: eph1 } = createHandshakeInit();
      const { message: accept1, result: dr1 } = processHandshakeInit(
        init1,
        daemonId,
        daemonIdentity,
      );
      const cr1 = processHandshakeAccept(
        accept1,
        daemonId,
        daemonIdentity.publicKey,
        eph1,
      );

      const clientSession1 = createClientSession(
        asClientId("session-old"),
        dr1.sessionKeys,
      );
      const daemonSession1 = createDaemonSession(cr1.sessionKeys);

      // Clear sessions
      clearDaemonSession(daemonSession1);

      // New handshake creates new session with new keys
      const { message: init2, ephemeralKeyPair: eph2 } = createHandshakeInit();
      const { message: accept2, result: dr2 } = processHandshakeInit(
        init2,
        daemonId,
        daemonIdentity,
      );
      const cr2 = processHandshakeAccept(
        accept2,
        daemonId,
        daemonIdentity.publicKey,
        eph2,
      );

      const clientSession2 = createClientSession(
        asClientId("session-new"),
        dr2.sessionKeys,
      );
      const daemonSession2 = createDaemonSession(cr2.sessionKeys);

      // New session works
      const message = textEncoder.encode("New session message");
      const encrypted = encryptClientToDaemon(daemonSession2, message);
      const decrypted = decryptClientToDaemon(clientSession2, encrypted);
      expect(textDecoder.decode(decrypted)).toBe("New session message");

      // But old session cannot decrypt new messages
      expect(() => decryptClientToDaemon(clientSession1, encrypted)).toThrow(
        SbrpError,
      );
    });
  });

  describe("error scenarios", () => {
    it("rejects MITM with modified ephemeral key", () => {
      const daemonId = asDaemonId("daemon-mitm-eph");
      const daemonIdentity = generateIdentityKeyPair();

      const { message: init, ephemeralKeyPair } = createHandshakeInit();
      const { message: accept } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );

      // Attacker modifies the accept's ephemeral public key
      const modifiedAccept = {
        ...accept,
        acceptPublicKey: new Uint8Array(32).fill(0xaa), // Fake key
      };

      // Signature verification fails because signature was over original key
      expect(() =>
        processHandshakeAccept(
          modifiedAccept,
          daemonId,
          daemonIdentity.publicKey,
          ephemeralKeyPair,
        ),
      ).toThrow(SbrpError);
      expect(() =>
        processHandshakeAccept(
          modifiedAccept,
          daemonId,
          daemonIdentity.publicKey,
          ephemeralKeyPair,
        ),
      ).toThrow(/Signature verification failed/);
    });

    it("rejects MITM with modified signature", () => {
      const daemonId = asDaemonId("daemon-mitm-sig");
      const daemonIdentity = generateIdentityKeyPair();

      const { message: init, ephemeralKeyPair } = createHandshakeInit();
      const { message: accept } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );

      // Attacker modifies the signature
      const modifiedAccept = {
        ...accept,
        signature: new Uint8Array(64).fill(0xbb), // Fake signature
      };

      expect(() =>
        processHandshakeAccept(
          modifiedAccept,
          daemonId,
          daemonIdentity.publicKey,
          ephemeralKeyPair,
        ),
      ).toThrow(SbrpError);
    });

    it("detects replay attack on data frames", () => {
      const daemonId = asDaemonId("daemon-replay");
      const daemonIdentity = generateIdentityKeyPair();

      const { message: init, ephemeralKeyPair } = createHandshakeInit();
      const { message: accept, result: daemonResult } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );
      const clientResult = processHandshakeAccept(
        accept,
        daemonId,
        daemonIdentity.publicKey,
        ephemeralKeyPair,
      );

      const clientSession = createClientSession(
        asClientId("replay-test"),
        daemonResult.sessionKeys,
      );
      const daemonSession = createDaemonSession(clientResult.sessionKeys);

      // Send legitimate message
      const message = textEncoder.encode("Original message");
      const encrypted = encryptClientToDaemon(daemonSession, message);

      // First decryption succeeds
      const decrypted = decryptClientToDaemon(clientSession, encrypted);
      expect(textDecoder.decode(decrypted)).toBe("Original message");

      // Replay same message - should be rejected
      expect(() => decryptClientToDaemon(clientSession, encrypted)).toThrow(
        SbrpError,
      );
      expect(() => decryptClientToDaemon(clientSession, encrypted)).toThrow(
        /replay detected/,
      );
    });

    it("rejects message encrypted with wrong session keys", () => {
      const daemonId = asDaemonId("daemon-wrongkey");
      const daemonIdentity = generateIdentityKeyPair();

      // Session A
      const { message: initA, ephemeralKeyPair: ephA } = createHandshakeInit();
      const { message: acceptA, result: drA } = processHandshakeInit(
        initA,
        daemonId,
        daemonIdentity,
      );
      const crA = processHandshakeAccept(
        acceptA,
        daemonId,
        daemonIdentity.publicKey,
        ephA,
      );

      // Session B
      const { message: initB, ephemeralKeyPair: ephB } = createHandshakeInit();
      const { message: acceptB, result: drB } = processHandshakeInit(
        initB,
        daemonId,
        daemonIdentity,
      );
      const crB = processHandshakeAccept(
        acceptB,
        daemonId,
        daemonIdentity.publicKey,
        ephB,
      );

      const clientSessionA = createClientSession(
        asClientId("A"),
        drA.sessionKeys,
      );
      const clientSessionB = createClientSession(
        asClientId("B"),
        drB.sessionKeys,
      );
      const daemonSessionB = createDaemonSession(crB.sessionKeys);

      // Encrypt with session B keys
      const message = textEncoder.encode("Wrong session test");
      const encryptedB = encryptClientToDaemon(daemonSessionB, message);

      // Try to decrypt with session A - should fail (wrong keys cause auth failure)
      expect(() => decryptClientToDaemon(clientSessionA, encryptedB)).toThrow(
        SbrpError,
      );

      // Decrypting with correct session works
      const decrypted = decryptClientToDaemon(clientSessionB, encryptedB);
      expect(textDecoder.decode(decrypted)).toBe("Wrong session test");
    });

    it("rejects tampered ciphertext", () => {
      const daemonId = asDaemonId("daemon-tamper");
      const daemonIdentity = generateIdentityKeyPair();

      const { message: init, ephemeralKeyPair } = createHandshakeInit();
      const { message: accept, result: daemonResult } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );
      const clientResult = processHandshakeAccept(
        accept,
        daemonId,
        daemonIdentity.publicKey,
        ephemeralKeyPair,
      );

      const clientSession = createClientSession(
        asClientId("tamper-test"),
        daemonResult.sessionKeys,
      );
      const daemonSession = createDaemonSession(clientResult.sessionKeys);

      const message = textEncoder.encode("Tamper test");
      const encrypted = encryptClientToDaemon(daemonSession, message);

      // Tamper with ciphertext (flip a bit in the middle)
      const tamperedData = new Uint8Array(encrypted.data);
      tamperedData[20] ^= 0x01; // Flip a bit

      const tamperedMessage = {
        ...encrypted,
        data: tamperedData,
      };

      // Poly1305 auth tag verification fails
      expect(() =>
        decryptClientToDaemon(clientSession, tamperedMessage),
      ).toThrow(SbrpError);
    });

    it("rejects wrong direction key usage", () => {
      const daemonId = asDaemonId("daemon-direction");
      const daemonIdentity = generateIdentityKeyPair();

      const { message: init, ephemeralKeyPair } = createHandshakeInit();
      const { message: accept, result: daemonResult } = processHandshakeInit(
        init,
        daemonId,
        daemonIdentity,
      );
      const clientResult = processHandshakeAccept(
        accept,
        daemonId,
        daemonIdentity.publicKey,
        ephemeralKeyPair,
      );

      const clientSession = createClientSession(
        asClientId("direction-test"),
        daemonResult.sessionKeys,
      );
      const daemonSession = createDaemonSession(clientResult.sessionKeys);

      // Client sends to daemon
      const clientMessage = textEncoder.encode("Client to daemon");
      const encryptedC2D = encryptClientToDaemon(daemonSession, clientMessage);

      // Try to decrypt client-to-daemon message as if it were daemon-to-client
      // This should fail because different keys and direction bytes are used
      expect(() => decryptDaemonToClient(daemonSession, encryptedC2D)).toThrow(
        SbrpError,
      );
    });
  });

  describe("concurrent sessions stress test", () => {
    it("handles many concurrent sessions", () => {
      const daemonId = asDaemonId("daemon-stress");
      const daemonIdentity = generateIdentityKeyPair();
      const numSessions = 50;

      type SessionPair = {
        clientSession: ReturnType<typeof createClientSession>;
        daemonSession: ReturnType<typeof createDaemonSession>;
        id: number;
      };

      const sessions: SessionPair[] = [];

      // Create many sessions
      for (let i = 0; i < numSessions; i++) {
        const { message: init, ephemeralKeyPair } = createHandshakeInit();
        const { message: accept, result: daemonResult } = processHandshakeInit(
          init,
          daemonId,
          daemonIdentity,
        );
        const clientResult = processHandshakeAccept(
          accept,
          daemonId,
          daemonIdentity.publicKey,
          ephemeralKeyPair,
        );

        sessions.push({
          clientSession: createClientSession(
            asClientId(`stress-${i}`),
            daemonResult.sessionKeys,
          ),
          daemonSession: createDaemonSession(clientResult.sessionKeys),
          id: i,
        });
      }

      // Exchange messages on all sessions
      for (const session of sessions) {
        const message = textEncoder.encode(
          `Message from session ${session.id}`,
        );
        const encrypted = encryptClientToDaemon(session.daemonSession, message);
        const decrypted = decryptClientToDaemon(
          session.clientSession,
          encrypted,
        );
        expect(textDecoder.decode(decrypted)).toBe(
          `Message from session ${session.id}`,
        );
      }

      // Verify session isolation - try to decrypt with wrong session
      const msg0 = encryptClientToDaemon(
        sessions[0].daemonSession,
        textEncoder.encode("Session 0"),
      );
      expect(() =>
        decryptClientToDaemon(sessions[1].clientSession, msg0),
      ).toThrow(SbrpError);
    });
  });
});
