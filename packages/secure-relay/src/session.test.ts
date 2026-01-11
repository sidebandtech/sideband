// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { randomBytes } from "./crypto.js";
import {
  clearClientSession,
  clearDaemonSession,
  createClientSession,
  createDaemonSession,
  decryptClientToDaemon,
  decryptDaemonToClient,
  encryptClientToDaemon,
  encryptDaemonToClient,
} from "./session.js";
import type { EncryptedMessage, SessionKeys } from "./types.js";
import { asClientId, SbrpError, SbrpErrorCode } from "./types.js";

/** Create a pair of session keys for testing */
function createTestSessionKeys(): SessionKeys {
  return {
    clientToDaemon: randomBytes(32),
    daemonToClient: randomBytes(32),
  };
}

describe("session", () => {
  describe("encrypt then decrypt roundtrip (client to daemon)", () => {
    it("decrypts to original plaintext", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-1");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const encrypted = encryptClientToDaemon(daemonSession, plaintext);
      const decrypted = decryptClientToDaemon(clientSession, encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it("works with empty plaintext", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-2");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      const plaintext = new Uint8Array(0);
      const encrypted = encryptClientToDaemon(daemonSession, plaintext);
      const decrypted = decryptClientToDaemon(clientSession, encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it("works with large plaintext", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-3");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      const plaintext = randomBytes(65536); // 64 KB
      const encrypted = encryptClientToDaemon(daemonSession, plaintext);
      const decrypted = decryptClientToDaemon(clientSession, encrypted);

      expect(decrypted).toEqual(plaintext);
    });
  });

  describe("encrypt then decrypt roundtrip (daemon to client)", () => {
    it("decrypts to original plaintext", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-4");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      const plaintext = new Uint8Array([10, 20, 30, 40, 50]);
      const encrypted = encryptDaemonToClient(clientSession, plaintext);
      const decrypted = decryptDaemonToClient(daemonSession, encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it("works with empty plaintext", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-5");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      const plaintext = new Uint8Array(0);
      const encrypted = encryptDaemonToClient(clientSession, plaintext);
      const decrypted = decryptDaemonToClient(daemonSession, encrypted);

      expect(decrypted).toEqual(plaintext);
    });
  });

  describe("sequence numbers", () => {
    it("increment correctly for client to daemon", () => {
      const sessionKeys = createTestSessionKeys();
      const daemonSession = createDaemonSession(sessionKeys);

      const msg1 = encryptClientToDaemon(daemonSession, new Uint8Array([1]));
      const msg2 = encryptClientToDaemon(daemonSession, new Uint8Array([2]));
      const msg3 = encryptClientToDaemon(daemonSession, new Uint8Array([3]));

      expect(msg1.seq).toBe(0n);
      expect(msg2.seq).toBe(1n);
      expect(msg3.seq).toBe(2n);
    });

    it("increment correctly for daemon to client", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-6");
      const clientSession = createClientSession(clientId, sessionKeys);

      const msg1 = encryptDaemonToClient(clientSession, new Uint8Array([1]));
      const msg2 = encryptDaemonToClient(clientSession, new Uint8Array([2]));
      const msg3 = encryptDaemonToClient(clientSession, new Uint8Array([3]));

      expect(msg1.seq).toBe(0n);
      expect(msg2.seq).toBe(1n);
      expect(msg3.seq).toBe(2n);
    });
  });

  describe("replay detection", () => {
    it("rejects duplicate sequence (client to daemon)", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-7");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      const plaintext = new Uint8Array([1, 2, 3]);
      const encrypted = encryptClientToDaemon(daemonSession, plaintext);

      // First decryption succeeds
      decryptClientToDaemon(clientSession, encrypted);

      // Replay attempt fails
      expect(() => decryptClientToDaemon(clientSession, encrypted)).toThrow(
        SbrpError,
      );
      try {
        decryptClientToDaemon(clientSession, encrypted);
      } catch (e) {
        expect(e).toBeInstanceOf(SbrpError);
        expect((e as SbrpError).code).toBe(SbrpErrorCode.SequenceError);
      }
    });

    it("rejects duplicate sequence (daemon to client)", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-8");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      const plaintext = new Uint8Array([4, 5, 6]);
      const encrypted = encryptDaemonToClient(clientSession, plaintext);

      // First decryption succeeds
      decryptDaemonToClient(daemonSession, encrypted);

      // Replay attempt fails
      expect(() => decryptDaemonToClient(daemonSession, encrypted)).toThrow(
        SbrpError,
      );
      try {
        decryptDaemonToClient(daemonSession, encrypted);
      } catch (e) {
        expect(e).toBeInstanceOf(SbrpError);
        expect((e as SbrpError).code).toBe(SbrpErrorCode.SequenceError);
      }
    });

    it("rejects too-old sequence (client to daemon)", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-9");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      // Encrypt 200 messages to advance the window (default window is 128)
      const messages: EncryptedMessage[] = [];
      for (let i = 0; i < 200; i++) {
        messages.push(
          encryptClientToDaemon(daemonSession, new Uint8Array([i % 256])),
        );
      }

      // Decrypt latest 128 (within window)
      for (let i = 199; i >= 72; i--) {
        decryptClientToDaemon(clientSession, messages[i]);
      }

      // Message with seq=0 is now outside the window (too old)
      expect(() => decryptClientToDaemon(clientSession, messages[0])).toThrow(
        SbrpError,
      );
      try {
        decryptClientToDaemon(clientSession, messages[0]);
      } catch (e) {
        expect(e).toBeInstanceOf(SbrpError);
        expect((e as SbrpError).code).toBe(SbrpErrorCode.SequenceError);
      }
    });

    it("rejects too-old sequence (daemon to client)", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-10");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      // Encrypt 200 messages to advance the window (default window is 128)
      const messages: EncryptedMessage[] = [];
      for (let i = 0; i < 200; i++) {
        messages.push(
          encryptDaemonToClient(clientSession, new Uint8Array([i % 256])),
        );
      }

      // Decrypt latest 128 (within window)
      for (let i = 199; i >= 72; i--) {
        decryptDaemonToClient(daemonSession, messages[i]);
      }

      // Message with seq=0 is now outside the window (too old)
      expect(() => decryptDaemonToClient(daemonSession, messages[0])).toThrow(
        SbrpError,
      );
    });

    it("accepts out-of-order within window (client to daemon)", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-11");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      const msg0 = encryptClientToDaemon(daemonSession, new Uint8Array([0]));
      const msg1 = encryptClientToDaemon(daemonSession, new Uint8Array([1]));
      const msg2 = encryptClientToDaemon(daemonSession, new Uint8Array([2]));
      const msg3 = encryptClientToDaemon(daemonSession, new Uint8Array([3]));

      // Decrypt out of order: 3, 1, 2, 0
      expect(decryptClientToDaemon(clientSession, msg3)).toEqual(
        new Uint8Array([3]),
      );
      expect(decryptClientToDaemon(clientSession, msg1)).toEqual(
        new Uint8Array([1]),
      );
      expect(decryptClientToDaemon(clientSession, msg2)).toEqual(
        new Uint8Array([2]),
      );
      expect(decryptClientToDaemon(clientSession, msg0)).toEqual(
        new Uint8Array([0]),
      );
    });

    it("accepts out-of-order within window (daemon to client)", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-12");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      const msg0 = encryptDaemonToClient(clientSession, new Uint8Array([0]));
      const msg1 = encryptDaemonToClient(clientSession, new Uint8Array([1]));
      const msg2 = encryptDaemonToClient(clientSession, new Uint8Array([2]));
      const msg3 = encryptDaemonToClient(clientSession, new Uint8Array([3]));

      // Decrypt out of order: 2, 0, 3, 1
      expect(decryptDaemonToClient(daemonSession, msg2)).toEqual(
        new Uint8Array([2]),
      );
      expect(decryptDaemonToClient(daemonSession, msg0)).toEqual(
        new Uint8Array([0]),
      );
      expect(decryptDaemonToClient(daemonSession, msg3)).toEqual(
        new Uint8Array([3]),
      );
      expect(decryptDaemonToClient(daemonSession, msg1)).toEqual(
        new Uint8Array([1]),
      );
    });
  });

  describe("decryption with wrong key", () => {
    it("fails for client to daemon direction", () => {
      const sessionKeys1 = createTestSessionKeys();
      const sessionKeys2 = createTestSessionKeys(); // Different keys
      const clientId = asClientId("test-client-13");

      // Both sides encrypt with their own keys
      const senderSession = createDaemonSession(sessionKeys1);
      const receiverSession = createClientSession(clientId, sessionKeys2);

      // First, make the receiver accept seq=0 so replay check passes
      const validMessage = encryptClientToDaemon(
        createDaemonSession(sessionKeys2),
        new Uint8Array([99]),
      );
      decryptClientToDaemon(receiverSession, validMessage);

      // Now send a message with seq=1 from sender with wrong keys
      const plaintext = new Uint8Array([1, 2, 3]);
      encryptClientToDaemon(senderSession, new Uint8Array([0])); // burn seq=0
      const encrypted = encryptClientToDaemon(senderSession, plaintext);
      expect(encrypted.seq).toBe(1n);

      // Verify decryption fails with DecryptFailed (call only once)
      let caughtError: SbrpError | null = null;
      try {
        decryptClientToDaemon(receiverSession, encrypted);
      } catch (e) {
        caughtError = e as SbrpError;
      }
      expect(caughtError).toBeInstanceOf(SbrpError);
      expect(caughtError!.code).toBe(SbrpErrorCode.DecryptFailed);
    });

    it("fails for daemon to client direction", () => {
      const sessionKeys1 = createTestSessionKeys();
      const sessionKeys2 = createTestSessionKeys(); // Different keys
      const clientId = asClientId("test-client-14");

      const senderSession = createClientSession(clientId, sessionKeys1);
      const receiverSession = createDaemonSession(sessionKeys2);

      // First, make the receiver accept seq=0 so replay check passes
      const validMessage = encryptDaemonToClient(
        createClientSession(clientId, sessionKeys2),
        new Uint8Array([99]),
      );
      decryptDaemonToClient(receiverSession, validMessage);

      // Now send a message with seq=1 from sender with wrong keys
      const plaintext = new Uint8Array([4, 5, 6]);
      encryptDaemonToClient(senderSession, new Uint8Array([0])); // burn seq=0
      const encrypted = encryptDaemonToClient(senderSession, plaintext);
      expect(encrypted.seq).toBe(1n);

      // Verify decryption fails with DecryptFailed (call only once)
      let caughtError: SbrpError | null = null;
      try {
        decryptDaemonToClient(receiverSession, encrypted);
      } catch (e) {
        caughtError = e as SbrpError;
      }
      expect(caughtError).toBeInstanceOf(SbrpError);
      expect(caughtError!.code).toBe(SbrpErrorCode.DecryptFailed);
    });
  });

  describe("tampered ciphertext", () => {
    it("fails decryption for client to daemon", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-15");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      // First accept seq=0 to advance the window
      const msg0 = encryptClientToDaemon(daemonSession, new Uint8Array([0]));
      decryptClientToDaemon(clientSession, msg0);

      // Encrypt a second message with seq=1
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = encryptClientToDaemon(daemonSession, plaintext);
      expect(encrypted.seq).toBe(1n);

      // Tamper with the ciphertext (flip a bit after nonce, in the ciphertext area)
      const tamperedData = new Uint8Array(encrypted.data);
      tamperedData[20] ^= 0xff;
      const tamperedMessage: EncryptedMessage = {
        type: "encrypted",
        seq: encrypted.seq,
        data: tamperedData,
      };

      // Verify decryption fails with DecryptFailed (call only once)
      let caughtError: SbrpError | null = null;
      try {
        decryptClientToDaemon(clientSession, tamperedMessage);
      } catch (e) {
        caughtError = e as SbrpError;
      }
      expect(caughtError).toBeInstanceOf(SbrpError);
      expect(caughtError!.code).toBe(SbrpErrorCode.DecryptFailed);
    });

    it("fails decryption for daemon to client", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-16");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      // First accept seq=0 to advance the window
      const msg0 = encryptDaemonToClient(clientSession, new Uint8Array([0]));
      decryptDaemonToClient(daemonSession, msg0);

      // Encrypt a second message with seq=1
      const plaintext = new Uint8Array([6, 7, 8, 9, 10]);
      const encrypted = encryptDaemonToClient(clientSession, plaintext);
      expect(encrypted.seq).toBe(1n);

      // Tamper with the auth tag (last 16 bytes)
      const tamperedData = new Uint8Array(encrypted.data);
      tamperedData[tamperedData.length - 1] ^= 0x01;
      const tamperedMessage: EncryptedMessage = {
        type: "encrypted",
        seq: encrypted.seq,
        data: tamperedData,
      };

      // Verify decryption fails with DecryptFailed (call only once)
      let caughtError: SbrpError | null = null;
      try {
        decryptDaemonToClient(daemonSession, tamperedMessage);
      } catch (e) {
        caughtError = e as SbrpError;
      }
      expect(caughtError).toBeInstanceOf(SbrpError);
      expect(caughtError!.code).toBe(SbrpErrorCode.DecryptFailed);
    });

    it("fails when nonce is tampered", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-17");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      // First accept seq=0 to advance the window
      const msg0 = encryptClientToDaemon(daemonSession, new Uint8Array([0]));
      decryptClientToDaemon(clientSession, msg0);

      // Encrypt a second message with seq=1
      const plaintext = new Uint8Array([11, 12, 13]);
      const encrypted = encryptClientToDaemon(daemonSession, plaintext);
      expect(encrypted.seq).toBe(1n);

      // Tamper with the direction bytes in nonce (first 4 bytes)
      // This will change the nonce used for decryption
      const tamperedData = new Uint8Array(encrypted.data);
      tamperedData[0] ^= 0xff;
      const tamperedMessage: EncryptedMessage = {
        type: "encrypted",
        seq: encrypted.seq,
        data: tamperedData,
      };

      // Nonce tampering will cause decryption to fail with DecryptFailed
      let caughtError: SbrpError | null = null;
      try {
        decryptClientToDaemon(clientSession, tamperedMessage);
      } catch (e) {
        caughtError = e as SbrpError;
      }
      expect(caughtError).toBeInstanceOf(SbrpError);
      expect(caughtError!.code).toBe(SbrpErrorCode.DecryptFailed);
    });
  });

  describe("session state tracks separate sequences per direction", () => {
    it("client and daemon sessions maintain independent sequence counters", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-18");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      // Client sends 3 messages
      const c2d1 = encryptClientToDaemon(daemonSession, new Uint8Array([1]));
      const c2d2 = encryptClientToDaemon(daemonSession, new Uint8Array([2]));
      const c2d3 = encryptClientToDaemon(daemonSession, new Uint8Array([3]));

      expect(c2d1.seq).toBe(0n);
      expect(c2d2.seq).toBe(1n);
      expect(c2d3.seq).toBe(2n);

      // Daemon sends 2 messages (independent sequence)
      const d2c1 = encryptDaemonToClient(clientSession, new Uint8Array([10]));
      const d2c2 = encryptDaemonToClient(clientSession, new Uint8Array([20]));

      expect(d2c1.seq).toBe(0n);
      expect(d2c2.seq).toBe(1n);

      // Verify decryption works for both directions
      expect(decryptClientToDaemon(clientSession, c2d1)).toEqual(
        new Uint8Array([1]),
      );
      expect(decryptClientToDaemon(clientSession, c2d2)).toEqual(
        new Uint8Array([2]),
      );
      expect(decryptClientToDaemon(clientSession, c2d3)).toEqual(
        new Uint8Array([3]),
      );

      expect(decryptDaemonToClient(daemonSession, d2c1)).toEqual(
        new Uint8Array([10]),
      );
      expect(decryptDaemonToClient(daemonSession, d2c2)).toEqual(
        new Uint8Array([20]),
      );

      // Client sends more (continues from seq=3)
      const c2d4 = encryptClientToDaemon(daemonSession, new Uint8Array([4]));
      expect(c2d4.seq).toBe(3n);
    });

    it("replay windows are independent per direction", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-19");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      // Both directions encrypt a message
      const c2d = encryptClientToDaemon(daemonSession, new Uint8Array([1]));
      const d2c = encryptDaemonToClient(clientSession, new Uint8Array([2]));

      // Both have seq=0, but different directions
      expect(c2d.seq).toBe(0n);
      expect(d2c.seq).toBe(0n);

      // Decrypt both successfully (independent windows)
      expect(decryptClientToDaemon(clientSession, c2d)).toEqual(
        new Uint8Array([1]),
      );
      expect(decryptDaemonToClient(daemonSession, d2c)).toEqual(
        new Uint8Array([2]),
      );

      // Replays still fail in their own direction
      expect(() => decryptClientToDaemon(clientSession, c2d)).toThrow(
        SbrpError,
      );
      expect(() => decryptDaemonToClient(daemonSession, d2c)).toThrow(
        SbrpError,
      );
    });
  });

  describe("clearSession zeroes key material", () => {
    it("zeroes client session keys", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-20");
      const clientSession = createClientSession(clientId, sessionKeys);

      // Verify keys are non-zero initially
      const c2dSum = clientSession.clientToDaemon.trafficKey.reduce(
        (a, b) => a + b,
        0,
      );
      const d2cSum = clientSession.daemonToClient.trafficKey.reduce(
        (a, b) => a + b,
        0,
      );
      expect(c2dSum).toBeGreaterThan(0);
      expect(d2cSum).toBeGreaterThan(0);

      clearClientSession(clientSession);

      // Keys should be zeroed
      expect(
        clientSession.clientToDaemon.trafficKey.every((b) => b === 0),
      ).toBe(true);
      expect(
        clientSession.daemonToClient.trafficKey.every((b) => b === 0),
      ).toBe(true);
    });

    it("zeroes daemon session keys", () => {
      const sessionKeys = createTestSessionKeys();
      const daemonSession = createDaemonSession(sessionKeys);

      // Verify keys are non-zero initially
      const c2dSum = daemonSession.clientToDaemon.trafficKey.reduce(
        (a, b) => a + b,
        0,
      );
      const d2cSum = daemonSession.daemonToClient.trafficKey.reduce(
        (a, b) => a + b,
        0,
      );
      expect(c2dSum).toBeGreaterThan(0);
      expect(d2cSum).toBeGreaterThan(0);

      clearDaemonSession(daemonSession);

      // Keys should be zeroed
      expect(
        daemonSession.clientToDaemon.trafficKey.every((b) => b === 0),
      ).toBe(true);
      expect(
        daemonSession.daemonToClient.trafficKey.every((b) => b === 0),
      ).toBe(true);
    });

    it("prevents successful decryption after clearing one side", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-21");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      // Encrypt two messages before clearing
      const msg0 = encryptClientToDaemon(daemonSession, new Uint8Array([1]));
      const msg1 = encryptClientToDaemon(daemonSession, new Uint8Array([2]));

      // Decrypt first message successfully
      expect(decryptClientToDaemon(clientSession, msg0)).toEqual(
        new Uint8Array([1]),
      );

      // Clear the receiver's session (client session, which decrypts client→daemon)
      clearClientSession(clientSession);

      // Trying to decrypt msg1 (encrypted before clear with valid key)
      // should fail because the receiver's key is now zeroed
      let caughtError: SbrpError | null = null;
      try {
        decryptClientToDaemon(clientSession, msg1);
      } catch (e) {
        caughtError = e as SbrpError;
      }
      expect(caughtError).toBeInstanceOf(SbrpError);
      expect(caughtError!.code).toBe(SbrpErrorCode.DecryptFailed);
    });
  });

  describe("multiple messages exchange", () => {
    it("handles bidirectional conversation", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-22");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      // Simulate a conversation
      const messages = [
        { from: "client", text: "Hello, daemon!" },
        { from: "daemon", text: "Hello, client!" },
        { from: "client", text: "How are you?" },
        { from: "daemon", text: "I'm running well, thanks!" },
        { from: "client", text: "Great to hear!" },
        { from: "daemon", text: "Anything I can help with?" },
        { from: "client", text: "Just testing encryption." },
        { from: "daemon", text: "Everything looks good!" },
      ];

      for (const msg of messages) {
        const plaintext = encoder.encode(msg.text);

        if (msg.from === "client") {
          const encrypted = encryptClientToDaemon(daemonSession, plaintext);
          const decrypted = decryptClientToDaemon(clientSession, encrypted);
          expect(decoder.decode(decrypted)).toBe(msg.text);
        } else {
          const encrypted = encryptDaemonToClient(clientSession, plaintext);
          const decrypted = decryptDaemonToClient(daemonSession, encrypted);
          expect(decoder.decode(decrypted)).toBe(msg.text);
        }
      }
    });

    it("handles high message volume", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-23");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      const messageCount = 1000;

      // Client sends many messages
      for (let i = 0; i < messageCount; i++) {
        const plaintext = new Uint8Array([i & 0xff, (i >> 8) & 0xff]);
        const encrypted = encryptClientToDaemon(daemonSession, plaintext);
        const decrypted = decryptClientToDaemon(clientSession, encrypted);
        expect(decrypted).toEqual(plaintext);
      }

      // Daemon sends many messages
      for (let i = 0; i < messageCount; i++) {
        const plaintext = new Uint8Array([i & 0xff, (i >> 8) & 0xff]);
        const encrypted = encryptDaemonToClient(clientSession, plaintext);
        const decrypted = decryptDaemonToClient(daemonSession, encrypted);
        expect(decrypted).toEqual(plaintext);
      }
    });

    it("interleaved messages work correctly", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-24");

      const daemonSession = createDaemonSession(sessionKeys);
      const clientSession = createClientSession(clientId, sessionKeys);

      // Send messages interleaved before decrypting any
      const c2dMessages: EncryptedMessage[] = [];
      const d2cMessages: EncryptedMessage[] = [];

      for (let i = 0; i < 10; i++) {
        c2dMessages.push(
          encryptClientToDaemon(daemonSession, new Uint8Array([i])),
        );
        d2cMessages.push(
          encryptDaemonToClient(clientSession, new Uint8Array([i + 100])),
        );
      }

      // Decrypt in random order
      const c2dOrder = [5, 2, 8, 0, 3, 9, 1, 6, 4, 7];
      for (const i of c2dOrder) {
        expect(decryptClientToDaemon(clientSession, c2dMessages[i])).toEqual(
          new Uint8Array([i]),
        );
      }

      const d2cOrder = [7, 4, 1, 9, 6, 3, 0, 8, 2, 5];
      for (const i of d2cOrder) {
        expect(decryptDaemonToClient(daemonSession, d2cMessages[i])).toEqual(
          new Uint8Array([i + 100]),
        );
      }
    });
  });

  describe("session creation", () => {
    it("createClientSession stores clientId", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("my-special-client");
      const clientSession = createClientSession(clientId, sessionKeys);

      expect(clientSession.clientId).toBe(clientId);
    });

    it("createClientSession initializes sequence counters to zero", () => {
      const sessionKeys = createTestSessionKeys();
      const clientId = asClientId("test-client-25");
      const clientSession = createClientSession(clientId, sessionKeys);

      expect(clientSession.clientToDaemon.sendSeq).toBe(0n);
      expect(clientSession.daemonToClient.sendSeq).toBe(0n);
    });

    it("createDaemonSession initializes sequence counters to zero", () => {
      const sessionKeys = createTestSessionKeys();
      const daemonSession = createDaemonSession(sessionKeys);

      expect(daemonSession.clientToDaemon.sendSeq).toBe(0n);
      expect(daemonSession.daemonToClient.sendSeq).toBe(0n);
    });
  });
});
