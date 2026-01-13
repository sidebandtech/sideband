// SPDX-License-Identifier: Apache-2.0

/**
 * Conformance tests for @sideband/transport-ws.
 *
 * Tests ABI conformance, WebSocket-specific behavior, backpressure handling,
 * misuse resistance, and server functionality.
 */

import { TransportError, unsafeAsTransportEndpoint } from "@sideband/transport";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { WebSocketServer } from "ws";
import { nodeWsTransport, wsEndpoint } from "./index.js";

/**
 * Create a test server that echoes messages back.
 */
async function createEchoServer(
  port = 0,
  options?: { protocol?: string; rejectText?: boolean },
): Promise<{
  server: WebSocketServer;
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({
      port,
      handleProtocols: options?.protocol
        ? (protocols) =>
            protocols.has(options.protocol!) ? options.protocol! : false
        : undefined,
    });

    server.on("error", reject);

    server.on("listening", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;

      server.on("connection", (ws) => {
        ws.on("message", (data, isBinary) => {
          if (!isBinary && options?.rejectText !== false) {
            ws.close(1003, "Text frames not supported");
            return;
          }
          ws.send(data);
        });
      });

      resolve({
        server,
        port: actualPort,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

describe("transport-ws", () => {
  const transport = nodeWsTransport();

  describe("ABI conformance", () => {
    let echoServer: Awaited<ReturnType<typeof createEchoServer>>;

    beforeAll(async () => {
      echoServer = await createEchoServer();
    });

    afterAll(async () => {
      await echoServer?.close();
    });

    test("state transitions through lifecycle: connecting -> open -> closing -> closed", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);
      const conn = await transport.connect(endpoint);

      // After connect resolves, state should be "open"
      expect(conn.state).toBe("open");

      // Close the connection
      const closePromise = conn.close();
      // State transitions to "closing" or "closed"
      expect(["closing", "closed"]).toContain(conn.state);

      await closePromise;
      expect(conn.state).toBe("closed");
    });

    test("closed promise resolves on clean close", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);
      const conn = await transport.connect(endpoint);

      // Start consuming inbound to avoid issues
      const inboundIter = conn.inbound[Symbol.asyncIterator]();

      const closeInfo = await Promise.race([
        conn.closed,
        conn.close().then(() => conn.closed),
      ]);

      expect(closeInfo.graceful).toBe(true);
      expect(closeInfo.closeCode).toBe(1000);
      expect(closeInfo.error).toBeUndefined();

      // Clean up iterator
      await inboundIter.return?.();
    });

    test("closed promise resolves on abnormal close", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      // Use transport.listen to create a server that closes abnormally
      const listener = await transport.listen!(endpoint, async (conn) => {
        // Small delay to ensure client is ready
        await new Promise((r) => setTimeout(r, 50));
        // Close with abnormal code
        await conn.close({ closeCode: 1011, reason: "Test abnormal close" });
      });

      try {
        const clientConn = await transport.connect(listener.address);

        const closeInfo = await clientConn.closed;
        expect(closeInfo.graceful).toBe(false);
        expect(closeInfo.closeCode).toBe(1011);
        expect(closeInfo.error).toBeDefined();
      } finally {
        await listener.close();
      }
    });

    test("iterator: single-consumer enforcement throws on double consume", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);
      const conn = await transport.connect(endpoint);

      try {
        // First iterator should work (consume it so second throws)
        const _iter1 = conn.inbound[Symbol.asyncIterator]();
        void _iter1; // Silence unused variable warning

        // Second iterator should throw
        expect(() => {
          conn.inbound[Symbol.asyncIterator]();
        }).toThrow(TransportError);
      } finally {
        await conn.close();
      }
    });

    test("iterator: buffered message delivery", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);
      const conn = await transport.connect(endpoint);

      try {
        // Send a message
        const testData = new Uint8Array([1, 2, 3, 4, 5]);
        await conn.send(testData);

        // Start iterator and receive the echoed message
        const iter = conn.inbound[Symbol.asyncIterator]();
        const result = await Promise.race([
          iter.next(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 1000),
          ),
        ]);

        expect(result.done).toBe(false);
        expect(result.value).toEqual(testData);
      } finally {
        await conn.close();
      }
    });

    test("iterator: completion on close", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);
      const conn = await transport.connect(endpoint);

      const iter = conn.inbound[Symbol.asyncIterator]();

      // Close the connection
      await conn.close();

      // Iterator should complete
      const result = await iter.next();
      expect(result.done).toBe(true);
    });

    test("iterator: early break does not close connection", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);
      const conn = await transport.connect(endpoint);

      try {
        // Send a message to have something in the buffer
        const testData = new Uint8Array([1, 2, 3]);
        await conn.send(testData);

        // Start iterator and get first message, then break
        for await (const _msg of conn.inbound) {
          // Break after first message (simulating early exit)
          break;
        }

        // Connection should still be open after break
        expect(conn.state).toBe("open");

        // Should still be able to send
        await conn.send(new Uint8Array([4, 5, 6]));
        expect(conn.state).toBe("open");
      } finally {
        await conn.close();
      }
    });

    test("iterator: buffered messages drain before completion", async () => {
      // Create a server that sends multiple messages then closes
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");
      const listener = await transport.listen!(endpoint, async (serverConn) => {
        // Send multiple binary messages
        await serverConn.send(new Uint8Array([1]));
        await serverConn.send(new Uint8Array([2]));
        await serverConn.send(new Uint8Array([3]));
        // Short delay to ensure messages are delivered
        await new Promise((r) => setTimeout(r, 50));
        // Close gracefully
        await serverConn.close();
      });

      try {
        const conn = await transport.connect(listener.address);

        // Collect all messages before iterator completes
        const messages: Uint8Array[] = [];
        for await (const msg of conn.inbound) {
          messages.push(msg);
        }

        // All messages should have been delivered before completion
        expect(messages.length).toBe(3);
        expect(messages[0]).toEqual(new Uint8Array([1]));
        expect(messages[1]).toEqual(new Uint8Array([2]));
        expect(messages[2]).toEqual(new Uint8Array([3]));
      } finally {
        await listener.close();
      }
    });

    test("send ordering: concurrent sends preserve order", async () => {
      // Create a server that collects messages
      const messages: Uint8Array[] = [];
      const collectServer = new WebSocketServer({ port: 0 });
      const port = await new Promise<number>((resolve) => {
        collectServer.on("listening", () => {
          const addr = collectServer.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      collectServer.on("connection", (ws) => {
        ws.on("message", (data) => {
          messages.push(new Uint8Array(data as Buffer));
        });
      });

      try {
        const endpoint = wsEndpoint(`ws://localhost:${port}`);
        const conn = await transport.connect(endpoint);

        // Send multiple messages concurrently
        const sends = [
          conn.send(new Uint8Array([1])),
          conn.send(new Uint8Array([2])),
          conn.send(new Uint8Array([3])),
          conn.send(new Uint8Array([4])),
          conn.send(new Uint8Array([5])),
        ];

        await Promise.all(sends);

        // Wait for messages to arrive
        await new Promise((r) => setTimeout(r, 100));

        expect(messages).toHaveLength(5);
        expect(messages[0]).toEqual(new Uint8Array([1]));
        expect(messages[1]).toEqual(new Uint8Array([2]));
        expect(messages[2]).toEqual(new Uint8Array([3]));
        expect(messages[3]).toEqual(new Uint8Array([4]));
        expect(messages[4]).toEqual(new Uint8Array([5]));

        await conn.close();
      } finally {
        await new Promise<void>((r) => collectServer.close(() => r()));
      }
    });

    test("close idempotency: multiple close() calls safe", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);
      const conn = await transport.connect(endpoint);

      // Multiple close calls should not throw
      await Promise.all([conn.close(), conn.close(), conn.close()]);

      expect(conn.state).toBe("closed");

      // Additional close after closed should also be safe
      await conn.close();
      expect(conn.state).toBe("closed");
    });
  });

  describe("WebSocket-specific", () => {
    test("rejects text frames with code 1003", async () => {
      // Create a server that sends text
      const textServer = new WebSocketServer({ port: 0 });
      const port = await new Promise<number>((resolve) => {
        textServer.on("listening", () => {
          const addr = textServer.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      textServer.on("connection", (ws) => {
        // Send a text frame
        ws.send("text message");
      });

      try {
        const endpoint = wsEndpoint(`ws://localhost:${port}`);
        const conn = await transport.connect(endpoint);

        // Connection should close due to text frame
        const closeInfo = await conn.closed;
        expect(closeInfo.closeCode).toBe(1003);
        expect(closeInfo.graceful).toBe(false);
      } finally {
        await new Promise<void>((r) => textServer.close(() => r()));
      }
    });

    test("max message size enforcement closes with 1009", async () => {
      // Create a server that sends an oversized message
      const oversizeServer = new WebSocketServer({ port: 0 });
      const port = await new Promise<number>((resolve) => {
        oversizeServer.on("listening", () => {
          const addr = oversizeServer.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      oversizeServer.on("connection", (ws) => {
        // Send a message larger than the client's limit
        const oversized = new Uint8Array(2048);
        ws.send(oversized);
      });

      try {
        const endpoint = wsEndpoint(`ws://localhost:${port}`);
        // Client connects with small limit
        const conn = await transport.connect(endpoint, {
          limits: { maxMessageSize: 1024 },
        });

        // Client should close due to oversized message
        const closeInfo = await conn.closed;
        expect(closeInfo.graceful).toBe(false);
        expect(closeInfo.closeCode).toBe(1009);
      } finally {
        await new Promise<void>((r) => oversizeServer.close(() => r()));
      }
    });

    test("subprotocol selection", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      const listener = await transport.listen!(
        endpoint,
        async (conn) => {
          expect(conn.subprotocol).toBe("sideband.v1");
          await conn.close();
        },
        { subprotocols: { offer: ["sideband.v1", "sideband.v2"] } },
      );

      try {
        const conn = await transport.connect(listener.address, {
          subprotocols: { offer: ["sideband.v1"] },
        });

        expect(conn.subprotocol).toBe("sideband.v1");
        await conn.closed;
      } finally {
        await listener.close();
      }
    });

    // Note: This test is skipped because Bun's WebSocket incorrectly reports
    // ws.protocol as the first offered protocol even when server doesn't select any.
    // This is a Bun-specific behavior that differs from browser WebSocket API.
    // The requireSelection check works correctly in browsers and Node.js with ws package.
    test.skip("requireSelection enforcement rejects when no subprotocol selected", async () => {
      // This test would verify that when a server doesn't select any subprotocol,
      // the client with requireSelection: true rejects the connection.
      // However, Bun's WebSocket always sets protocol to first offered value,
      // making it impossible to detect server rejection at the transport level.
    });
  });

  describe("backpressure", () => {
    test("send buffer overflow rejects with buffer_overflow", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      // Create server that accepts but doesn't read
      const listener = await transport.listen!(
        endpoint,
        async (conn) => {
          // Don't read, just wait
          await conn.closed;
        },
        { limits: { maxSendBufferBytes: 1024 } }, // Very small buffer
      );

      try {
        const conn = await transport.connect(listener.address, {
          limits: { maxSendBufferBytes: 1024 }, // Small buffer
        });

        // Try to send more than the buffer allows
        const largeData = new Uint8Array(2048);

        try {
          await conn.send(largeData);
          expect.unreachable("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(TransportError);
          expect((err as TransportError).kind).toBe("buffer_overflow");
        }

        await conn.close();
      } finally {
        await listener.close();
      }
    });

    test("inbound buffer overflow closes connection with buffer_overflow", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      // Create server that floods client
      const listener = await transport.listen!(endpoint, async (serverConn) => {
        // Send many messages quickly to overflow client buffer
        const data = new Uint8Array(512); // 512 bytes each
        // Send 50 messages (25KB total, should overflow 1KB buffer)
        for (let i = 0; i < 50; i++) {
          try {
            await serverConn.send(data);
          } catch {
            // Server may fail to send if client disconnects
            break;
          }
        }
        await serverConn.closed;
      });

      try {
        // Client connects with very small inbound buffer
        const conn = await transport.connect(listener.address, {
          limits: { maxInboundBufferBytes: 1024 }, // 1KB buffer
        });

        // Don't consume inbound - let buffer fill up
        const closeInfo = await conn.closed;

        // Should close with buffer_overflow
        expect(closeInfo.graceful).toBe(false);
        expect(closeInfo.closeCode).toBe(1011);
        expect(closeInfo.error?.kind).toBe("buffer_overflow");
      } finally {
        await listener.close();
      }
    });

    test("message too large on send rejects with message_too_large", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      const listener = await transport.listen!(
        endpoint,
        async (conn) => {
          await conn.closed;
        },
        { limits: { maxMessageSize: 512 } },
      );

      try {
        const conn = await transport.connect(listener.address, {
          limits: { maxMessageSize: 512 },
        });

        // Try to send message larger than maxMessageSize
        const oversized = new Uint8Array(1024);

        try {
          await conn.send(oversized);
          expect.unreachable("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(TransportError);
          expect((err as TransportError).kind).toBe("message_too_large");
        }

        await conn.close();
      } finally {
        await listener.close();
      }
    });
  });

  describe("misuse resistance", () => {
    let echoServer: Awaited<ReturnType<typeof createEchoServer>>;

    beforeAll(async () => {
      echoServer = await createEchoServer();
    });

    afterAll(async () => {
      await echoServer?.close();
    });

    test("double-consume inbound iterator throws", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);
      const conn = await transport.connect(endpoint);

      try {
        // First consume (consume it so second throws)
        const _iter1 = conn.inbound[Symbol.asyncIterator]();
        void _iter1; // Silence unused variable warning

        // Second consume should throw
        expect(() => conn.inbound[Symbol.asyncIterator]()).toThrow();
      } finally {
        await conn.close();
      }
    });

    test("send-after-close rejects with transport_failure", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);
      const conn = await transport.connect(endpoint);

      await conn.close();

      try {
        await conn.send(new Uint8Array([1, 2, 3]));
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TransportError);
        expect((err as TransportError).kind).toBe("transport_failure");
      }
    });

    test("auth + advanced.headers.Authorization conflict throws", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);

      try {
        await transport.connect(endpoint, {
          auth: { token: "test-token", mode: "header" },
          advanced: { headers: { Authorization: "Bearer other" } },
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TransportError);
        expect((err as TransportError).kind).toBe("transport_failure");
        expect((err as TransportError).message).toContain("auth");
      }
    });

    test("abort during connect rejects with aborted", async () => {
      const controller = new AbortController();

      // Abort immediately
      controller.abort();

      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);

      try {
        await transport.connect(endpoint, { signal: controller.signal });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TransportError);
        expect((err as TransportError).kind).toBe("aborted");
      }
    });

    test("abort during pending connect rejects with aborted", async () => {
      const controller = new AbortController();

      // Use a non-routable IP to ensure the connection hangs
      const endpoint = wsEndpoint("ws://10.255.255.1:12345");

      const connectPromise = transport.connect(endpoint, {
        signal: controller.signal,
        timeoutMs: 5000,
      });

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50);

      try {
        await connectPromise;
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TransportError);
        // Could be aborted or timeout depending on timing
        expect(["aborted", "timeout"]).toContain((err as TransportError).kind);
      }
    });

    test("abort while awaiting inbound: iterator continues until close", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      // Server sends messages then closes
      const listener = await transport.listen!(endpoint, async (serverConn) => {
        await serverConn.send(new Uint8Array([1]));
        await serverConn.send(new Uint8Array([2]));
        // Short delay to ensure messages are queued
        await new Promise((r) => setTimeout(r, 50));
        await serverConn.close();
      });

      try {
        const controller = new AbortController();
        const conn = await transport.connect(listener.address, {
          signal: controller.signal,
        });

        // Start consuming inbound
        const messages: Uint8Array[] = [];
        const iter = conn.inbound[Symbol.asyncIterator]();

        // Abort while iterator is active - should NOT immediately terminate
        controller.abort();

        // Iterator should continue to receive queued messages until close
        for (;;) {
          const result = await iter.next();
          if (result.done) break;
          messages.push(result.value);
        }

        // Should have received both messages despite abort
        expect(messages.length).toBeGreaterThanOrEqual(1);
      } finally {
        await listener.close();
      }
    });

    test("raced aborts: abort signal during send queue drain", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      // Server that accepts but slowly reads
      const listener = await transport.listen!(endpoint, async (serverConn) => {
        // Slowly consume to allow client buffer to fill
        for await (const _msg of serverConn.inbound) {
          await new Promise((r) => setTimeout(r, 10));
        }
      });

      try {
        const controller = new AbortController();
        const conn = await transport.connect(listener.address, {
          signal: controller.signal,
        });

        // Queue multiple sends (don't await them all)
        const sends = [
          conn.send(new Uint8Array(100)),
          conn.send(new Uint8Array(100)),
          conn.send(new Uint8Array(100)),
        ];

        // Abort during send queue processing
        controller.abort();

        // Sends should either complete or reject cleanly, not corrupt
        const results = await Promise.allSettled(sends);

        // All should have completed or rejected cleanly (no stuck promises)
        for (const result of results) {
          expect(["fulfilled", "rejected"]).toContain(result.status);
        }

        // Connection should close without hanging
        await conn.close();
      } finally {
        await listener.close();
      }
    });
  });

  describe("server", () => {
    test("origin validation with 'localhost' policy", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      let connectionCount = 0;
      const listener = await transport.listen!(
        endpoint,
        async (conn) => {
          connectionCount++;
          await conn.close();
        },
        { originPolicy: "localhost" },
      );

      try {
        // Connection without Origin header should succeed (non-browser client)
        const conn = await transport.connect(listener.address);
        await conn.closed;

        expect(connectionCount).toBe(1);
      } finally {
        await listener.close();
      }
    });

    test("origin validation with 'any' policy", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      let connectionCount = 0;
      const listener = await transport.listen!(
        endpoint,
        async (conn) => {
          connectionCount++;
          await conn.close();
        },
        { originPolicy: "any" },
      );

      try {
        const conn = await transport.connect(listener.address);
        await conn.closed;

        expect(connectionCount).toBe(1);
      } finally {
        await listener.close();
      }
    });

    test("origin validation with custom callback", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      const allowedOrigins = ["http://allowed.example.com"];
      let connectionCount = 0;

      const listener = await transport.listen!(
        endpoint,
        async (conn) => {
          connectionCount++;
          await conn.close();
        },
        {
          originPolicy: (origin: string | undefined) => {
            // Allow undefined (non-browser) or specific origins
            return origin === undefined || allowedOrigins.includes(origin);
          },
        },
      );

      try {
        // Non-browser client (no Origin header) should succeed
        const conn = await transport.connect(listener.address);
        await conn.closed;

        expect(connectionCount).toBe(1);
      } finally {
        await listener.close();
      }
    });

    test("missing Origin header allowed", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      let receivedConnection = false;
      const listener = await transport.listen!(
        endpoint,
        async (conn) => {
          receivedConnection = true;
          await conn.close();
        },
        { originPolicy: "localhost" },
      );

      try {
        // Node/Bun client doesn't send Origin header
        const conn = await transport.connect(listener.address);
        await conn.closed;

        expect(receivedConnection).toBe(true);
      } finally {
        await listener.close();
      }
    });

    test("subprotocol selection via offer list", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      let serverSubprotocol: string | undefined;
      const listener = await transport.listen!(
        endpoint,
        async (conn) => {
          serverSubprotocol = conn.subprotocol;
          await conn.close();
        },
        { subprotocols: { offer: ["proto.v1", "proto.v2"] } },
      );

      try {
        const conn = await transport.connect(listener.address, {
          subprotocols: { offer: ["proto.v2", "proto.v1"] },
        });

        await conn.closed;

        // Server should select first client offer that matches server's list
        expect(conn.subprotocol).toBe("proto.v2");
        expect(serverSubprotocol).toBe("proto.v2");
      } finally {
        await listener.close();
      }
    });

    test("subprotocol selection via callback selects from client offers", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      let serverSelectedProtocol: string | undefined;
      let callbackInvoked = false;
      const listener = await transport.listen!(
        endpoint,
        async (conn) => {
          serverSelectedProtocol = conn.subprotocol;
          await conn.close();
        },
        {
          subprotocols: {
            select: (clientOffers: string[]) => {
              callbackInvoked = true;
              // Return first client offer that server supports
              if (clientOffers.includes("custom.v1")) return "custom.v1";
              return undefined;
            },
          },
        },
      );

      try {
        const conn = await transport.connect(listener.address, {
          subprotocols: { offer: ["custom.v1", "custom.v2"] },
        });

        // Wait for connection to close
        await conn.closed;

        // Callback should have been invoked
        expect(callbackInvoked).toBe(true);
        // Server callback selected custom.v1
        expect(serverSelectedProtocol).toBe("custom.v1");
        expect(conn.subprotocol).toBe("custom.v1");
      } finally {
        await listener.close();
      }
    });

    // Note: This test is skipped because Bun's native WebSocket client doesn't properly
    // receive the server's subprotocol selection when it differs from the client's offers.
    // The client-side validation (checking selected protocol against offer list) is
    // implemented in both browser.ts and node.ts, but cannot be reliably tested in Bun.
    // This works correctly in browsers and Node.js with the ws package as client.
    test.skip("subprotocol select callback returns unlisted value fails with subprotocol_mismatch", async () => {
      // Test would verify: when server's select() callback returns a protocol not in
      // client's offer list, client should reject with subprotocol_mismatch.
      // Implementation exists in browser.ts:140-149 and node.ts:257-267.
    });

    test("ephemeral port (port 0) resolution", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      const listener = await transport.listen!(endpoint, async (conn) => {
        await conn.close();
      });

      try {
        // listener.address should have the actual port, not 0
        const url = new URL(listener.address);
        const port = parseInt(url.port);

        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThan(65536);

        // Should be able to connect to the resolved address
        const conn = await transport.connect(listener.address);
        await conn.closed;
      } finally {
        await listener.close();
      }
    });

    test("subprotocol select callback throws rejects connection", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      const listener = await transport.listen!(
        endpoint,
        async (conn) => {
          // Should never be called if callback throws
          await conn.close();
        },
        {
          subprotocols: {
            select: () => {
              throw new Error("Intentional callback error");
            },
          },
        },
      );

      try {
        // Client should fail to connect because server's select callback throws
        let connectFailed = false;
        try {
          await transport.connect(listener.address, {
            subprotocols: { offer: ["test.v1"] },
          });
        } catch {
          connectFailed = true;
        }
        expect(connectFailed).toBe(true);
      } finally {
        await listener.close();
      }
    });

    test("originPolicy callback throws rejects connection", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      let handlerCalled = false;
      const listener = await transport.listen!(
        endpoint,
        async (conn) => {
          // Should never be called if originPolicy throws
          handlerCalled = true;
          await conn.close();
        },
        {
          originPolicy: () => {
            throw new Error("Intentional origin policy error");
          },
        },
      );

      try {
        // Use ws package directly to send Origin header (Node/Bun clients don't send it)
        const { WebSocket: WsClient } = await import("ws");
        const ws = new WsClient(listener.address, {
          headers: { Origin: "http://test.example.com" },
        });

        await new Promise<void>((resolve) => {
          ws.on("open", () => {
            // Connection opened - unexpected but handle gracefully
            ws.close();
          });
          ws.on("error", () => {
            // Expected - connection rejected
            resolve();
          });
          ws.on("close", () => resolve());
        });

        // The key assertion: handler should never be called when policy throws
        expect(handlerCalled).toBe(false);
      } finally {
        await listener.close();
      }
    });

    test("connection handler errors are isolated", async () => {
      const endpoint = unsafeAsTransportEndpoint("ws://localhost:0");

      let handlerCallCount = 0;
      const listener = await transport.listen!(endpoint, async (conn) => {
        handlerCallCount++;
        if (handlerCallCount === 1) {
          throw new Error("Handler error");
        }
        await conn.close();
      });

      try {
        // First connection - handler throws
        const conn1 = await transport.connect(listener.address);
        await conn1.closed;

        // Second connection should still work
        const conn2 = await transport.connect(listener.address);
        await conn2.closed;

        expect(handlerCallCount).toBe(2);
      } finally {
        await listener.close();
      }
    });
  });

  describe("connection properties", () => {
    let echoServer: Awaited<ReturnType<typeof createEchoServer>>;

    beforeAll(async () => {
      echoServer = await createEchoServer();
    });

    afterAll(async () => {
      await echoServer?.close();
    });

    test("connection has unique id", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);

      const conn1 = await transport.connect(endpoint);
      const conn2 = await transport.connect(endpoint);

      expect(conn1.id).toBeDefined();
      expect(conn2.id).toBeDefined();
      expect(conn1.id).not.toBe(conn2.id);

      await conn1.close();
      await conn2.close();
    });

    test("connection endpoint matches requested endpoint", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);
      const conn = await transport.connect(endpoint);

      expect(conn.endpoint).toBe(endpoint);

      await conn.close();
    });

    test("pendingSendBytes is accessible", async () => {
      const endpoint = wsEndpoint(`ws://localhost:${echoServer.port}`);
      const conn = await transport.connect(endpoint);

      expect(typeof conn.pendingSendBytes).toBe("number");
      expect(conn.pendingSendBytes).toBeGreaterThanOrEqual(0);

      await conn.close();
    });
  });

  describe("timeout handling", () => {
    test("connect timeout rejects with timeout error", async () => {
      // Use a non-routable IP to ensure timeout
      const endpoint = wsEndpoint("ws://10.255.255.1:12345");

      try {
        await transport.connect(endpoint, { timeoutMs: 100 });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TransportError);
        expect((err as TransportError).kind).toBe("timeout");
      }
    });
  });

  describe("wsEndpoint validation", () => {
    test("accepts ws: scheme", () => {
      const endpoint = wsEndpoint("ws://localhost:8080");
      expect(endpoint as string).toBe("ws://localhost:8080/");
    });

    test("accepts wss: scheme", () => {
      const endpoint = wsEndpoint("wss://localhost:8080");
      expect(endpoint as string).toBe("wss://localhost:8080/");
    });

    test("rejects http: scheme", () => {
      expect(() => wsEndpoint("http://localhost:8080")).toThrow();
    });

    test("rejects https: scheme", () => {
      expect(() => wsEndpoint("https://localhost:8080")).toThrow();
    });

    test("strips hash fragment", () => {
      const endpoint = wsEndpoint("ws://localhost:8080/path#hash");
      expect(endpoint as string).toBe("ws://localhost:8080/path");
    });
  });
});
