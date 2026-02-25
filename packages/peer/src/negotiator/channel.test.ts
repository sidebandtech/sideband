// SPDX-License-Identifier: Apache-2.0

import {
  asClientId,
  asDaemonId,
  clearDaemonSession,
  createClientSession,
  createDaemonSession,
  createHandshakeInit,
  decryptDaemonToClient,
  encodeControl,
  encodeData,
  encodeHandshakeInit,
  encryptClientToDaemon,
  encryptDaemonToClient,
  generateIdentityKeyPair,
  processHandshakeAccept,
  processHandshakeInit,
  SbrpError,
  SbrpErrorCode,
  WireControlCode,
} from "@sideband/secure-relay";
import { describe, expect, it } from "bun:test";
import type { ChannelCrypto } from "./channel.js";
import { createSbrpChannel } from "./channel.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const daemonId = asDaemonId("test-daemon");

/** Create matched client/daemon sessions from a fresh handshake. */
function createTestSessions() {
  const identity = generateIdentityKeyPair();
  const { message: init, ephemeralKeyPair } = createHandshakeInit();
  const { message: accept, sessionKeys: daemonKeys } = processHandshakeInit(
    init,
    daemonId,
    identity,
  );
  const clientKeys = processHandshakeAccept(
    accept,
    daemonId,
    identity.publicKey,
    ephemeralKeyPair,
  );

  const clientSession = createClientSession(
    asClientId("test-client"),
    daemonKeys,
  );
  const daemonSession = createDaemonSession(clientKeys);

  return { clientSession, daemonSession, identity };
}

/** Build ChannelCrypto for the client side (encrypts client→daemon, decrypts daemon→client). */
function clientCrypto(
  daemonSession: ReturnType<typeof createDaemonSession>,
): ChannelCrypto {
  return {
    encrypt: (p) => encryptClientToDaemon(daemonSession, p),
    decrypt: (m) => decryptDaemonToClient(daemonSession, m),
    clear: () => clearDaemonSession(daemonSession),
  };
}

/** Create a mock transport with a programmable inbound message queue. */
function createMockTransport(inboundMessages: Uint8Array[] = []): {
  conn: {
    id: string;
    endpoint: string;
    send: (d: Uint8Array) => Promise<void>;
    close: () => Promise<void>;
    inbound: AsyncIterable<Uint8Array>;
  };
  sent: Uint8Array[];
} {
  const sent: Uint8Array[] = [];
  return {
    sent,
    conn: {
      id: "mock-conn",
      endpoint: "ws://localhost:8080",
      async send(data: Uint8Array) {
        sent.push(data);
      },
      async close() {},
      inbound: {
        async *[Symbol.asyncIterator]() {
          for (const msg of inboundMessages) {
            yield msg;
          }
        },
      },
    },
  };
}

describe("SbrpChannel", () => {
  const sessionId = 42n;

  describe("encrypt/decrypt round-trip", () => {
    it("sends encrypted data through raw transport and receives decrypted data", async () => {
      const { clientSession, daemonSession } = createTestSessions();

      // Create a daemon-side encrypted message to feed into the client channel's inbound
      const plaintext = textEncoder.encode("hello from daemon");
      const encrypted = encryptDaemonToClient(clientSession, plaintext);
      const dataFrame = encodeData(sessionId, encrypted);

      const { conn: rawConn, sent } = createMockTransport([dataFrame]);

      const clientChannel = createSbrpChannel(
        rawConn,
        sessionId,
        clientCrypto(daemonSession),
      );

      // Read from inbound — should decrypt the daemon's message
      const received: Uint8Array[] = [];
      for await (const data of clientChannel.inbound) {
        received.push(data);
      }

      expect(received).toHaveLength(1);
      expect(textDecoder.decode(received[0]!)).toBe("hello from daemon");
    });

    it("encrypts outbound data and sends via raw transport", async () => {
      const { daemonSession } = createTestSessions();

      const { conn: rawConn, sent } = createMockTransport();

      const clientChannel = createSbrpChannel(
        rawConn,
        sessionId,
        clientCrypto(daemonSession),
      );

      const plaintext = textEncoder.encode("hello from client");
      await clientChannel.send(plaintext);

      // The raw transport should have received an SBRP Data frame
      expect(sent).toHaveLength(1);
      expect(sent[0]!.length).toBeGreaterThan(plaintext.length);
    });
  });

  describe("control frame handling", () => {
    it("throws on terminal Control frame", async () => {
      const { daemonSession } = createTestSessions();

      // Terminal control: Unauthorized
      const controlFrame = encodeControl(
        sessionId,
        WireControlCode.Unauthorized,
        "access denied",
      );

      const { conn } = createMockTransport([controlFrame]);
      const channel = createSbrpChannel(
        conn,
        sessionId,
        clientCrypto(daemonSession),
      );

      const err = await (async () => {
        try {
          for await (const _data of channel.inbound) {
            // Should not reach here
          }
        } catch (e) {
          return e;
        }
      })();

      expect(err).toBeInstanceOf(SbrpError);
      expect((err as SbrpError).code).toBe("unauthorized");
    });

    it("skips non-terminal Control frame", async () => {
      const { clientSession, daemonSession } = createTestSessions();

      // Non-terminal control: RateLimited
      const controlFrame = encodeControl(
        sessionId,
        WireControlCode.RateLimited,
        "slow down",
      );

      // Follow with a real data frame
      const plaintext = textEncoder.encode("after rate limit");
      const encrypted = encryptDaemonToClient(clientSession, plaintext);
      const dataFrame = encodeData(sessionId, encrypted);

      const { conn } = createMockTransport([controlFrame, dataFrame]);
      const channel = createSbrpChannel(
        conn,
        sessionId,
        clientCrypto(daemonSession),
      );

      const received: string[] = [];
      for await (const data of channel.inbound) {
        received.push(textDecoder.decode(data));
      }

      expect(received).toEqual(["after rate limit"]);
    });
  });

  describe("unexpected frame type", () => {
    it("throws MalformedFrame for non-data/control/keepalive frames", async () => {
      const { daemonSession } = createTestSessions();

      // A HandshakeInit frame should never appear on an established encrypted channel
      const { message } = createHandshakeInit();
      const initFrame = encodeHandshakeInit(sessionId, message);

      const { conn } = createMockTransport([initFrame]);
      const channel = createSbrpChannel(
        conn,
        sessionId,
        clientCrypto(daemonSession),
      );

      const err = await (async () => {
        try {
          for await (const _data of channel.inbound) {
            // Should not reach here
          }
        } catch (e) {
          return e;
        }
      })();

      expect(err).toBeInstanceOf(SbrpError);
      expect((err as SbrpError).code).toBe(SbrpErrorCode.MalformedFrame);
    });
  });

  describe("close()", () => {
    it("is idempotent", async () => {
      const { daemonSession } = createTestSessions();
      const { conn } = createMockTransport();
      const channel = createSbrpChannel(
        conn,
        sessionId,
        clientCrypto(daemonSession),
      );

      await channel.close();
      await channel.close(); // Should not throw
    });

    it("send() after close throws", async () => {
      const { daemonSession } = createTestSessions();
      const { conn } = createMockTransport();
      const channel = createSbrpChannel(
        conn,
        sessionId,
        clientCrypto(daemonSession),
      );

      await channel.close();

      await expect(channel.send(new Uint8Array(1))).rejects.toThrow(/closed/);
    });
  });
});
