// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { TransportListener } from "./index.js";
import {
  LoopbackTransport,
  TransportError,
  isRetryable,
  unsafeAsTransportEndpoint,
} from "./index.js";

describe("LoopbackTransport", () => {
  let transport: LoopbackTransport;
  let listener: TransportListener | undefined;

  beforeEach(() => {
    transport = new LoopbackTransport();
  });

  afterEach(async () => {
    if (listener) {
      await listener.close();
      listener = undefined;
    }
  });

  describe("Lifecycle", () => {
    it("connect returns valid connection", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://test");
      listener = await transport.listen(endpoint, async () => {});

      const conn = await transport.connect(endpoint);

      expect(conn.id).toBeDefined();
      expect(conn.endpoint).toBe(endpoint);
      expect(conn.state).toBe("open");
      expect(conn.inbound).toBeDefined();
      expect(typeof conn.send).toBe("function");
      expect(typeof conn.close).toBe("function");
      expect(conn.closed).toBeInstanceOf(Promise);

      await conn.close();
    });

    it("connect rejects invalid endpoint with TransportError", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://nonexistent");

      try {
        await transport.connect(endpoint);
        expect(true).toBe(false); // Should not reach
      } catch (err) {
        expect(err).toBeInstanceOf(TransportError);
        expect((err as TransportError).kind).toBe("connection_refused");
      }
    });

    it("state transitions correctly", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://state");
      listener = await transport.listen(endpoint, async () => {});

      const conn = await transport.connect(endpoint);
      expect(conn.state).toBe("open");

      await conn.close();
      expect(conn.state).toBe("closed");
    });

    it("listen returns listener with address", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://listen-test");
      listener = await transport.listen(endpoint, async () => {});

      expect(listener.address).toBe(endpoint);
      expect(typeof listener.close).toBe("function");
    });

    it("close is idempotent", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://idempotent");
      listener = await transport.listen(endpoint, async () => {});

      const conn = await transport.connect(endpoint);

      // Multiple closes should not throw
      await conn.close();
      await conn.close();
      await conn.close();

      expect(conn.state).toBe("closed");
    });

    it("closed promise resolves with CloseInfo", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://closed-promise");
      listener = await transport.listen(endpoint, async () => {});

      const conn = await transport.connect(endpoint);
      const closePromise = conn.closed;

      await conn.close({ closeCode: 1001, reason: "test reason" });

      const closeInfo = await closePromise;
      expect(closeInfo.graceful).toBe(true);
      expect(closeInfo.closeCode).toBe(1001);
      expect(closeInfo.reason).toBe("test reason");
    });
  });

  describe("Data Transfer", () => {
    it("send delivers bytes intact", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://send");
      const received: Uint8Array[] = [];

      listener = await transport.listen(endpoint, async (conn) => {
        for await (const data of conn.inbound) {
          received.push(data);
        }
      });

      const client = await transport.connect(endpoint);
      const message = new Uint8Array([1, 2, 3, 4, 5]);
      await client.send(message);
      await client.close();

      await new Promise((r) => setTimeout(r, 10));
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(message);
    });

    it("order is preserved for sequential sends", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://order");
      const received: Uint8Array[] = [];

      listener = await transport.listen(endpoint, async (conn) => {
        for await (const data of conn.inbound) {
          received.push(data);
        }
      });

      const client = await transport.connect(endpoint);

      await client.send(new Uint8Array([1]));
      await client.send(new Uint8Array([2]));
      await client.send(new Uint8Array([3]));
      await client.close();

      await new Promise((r) => setTimeout(r, 10));
      expect(received).toHaveLength(3);
      expect(received[0]).toEqual(new Uint8Array([1]));
      expect(received[1]).toEqual(new Uint8Array([2]));
      expect(received[2]).toEqual(new Uint8Array([3]));
    });

    it("large messages (64 KB)", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://large");
      let receivedData: Uint8Array | undefined;

      listener = await transport.listen(endpoint, async (conn) => {
        for await (const data of conn.inbound) {
          receivedData = data;
          break;
        }
      });

      const client = await transport.connect(endpoint);
      const largeMessage = new Uint8Array(64 * 1024);
      for (let i = 0; i < largeMessage.length; i++) {
        largeMessage[i] = i % 256;
      }

      await client.send(largeMessage);
      await new Promise((r) => setTimeout(r, 10));

      expect(receivedData).toBeDefined();
      expect(receivedData!.length).toBe(64 * 1024);
      expect(receivedData).toEqual(largeMessage);

      await client.close();
    });

    it("max message size boundary (1 MiB)", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://max-size");
      listener = await transport.listen(endpoint, async () => {});

      const client = await transport.connect(endpoint);

      // Exactly 1 MiB should succeed
      const exactLimit = new Uint8Array(1024 * 1024);
      await client.send(exactLimit); // Should not throw

      // 1 MiB + 1 byte should fail
      const overLimit = new Uint8Array(1024 * 1024 + 1);
      try {
        await client.send(overLimit);
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(TransportError);
        expect((err as TransportError).kind).toBe("message_too_large");
      }

      await client.close();
    });

    it("buffered messages delivered post-close", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://buffered");
      const received: Uint8Array[] = [];

      let serverConn: Awaited<ReturnType<typeof transport.connect>> | undefined;
      listener = await transport.listen(endpoint, async (conn) => {
        serverConn = conn;
      });

      const client = await transport.connect(endpoint);

      // Send messages before server starts reading
      await client.send(new Uint8Array([1]));
      await client.send(new Uint8Array([2]));
      await client.close();

      // Server reads after client closes
      await new Promise((r) => setTimeout(r, 10));
      for await (const data of serverConn!.inbound) {
        received.push(data);
      }

      expect(received).toHaveLength(2);
    });
  });

  describe("Error Handling", () => {
    it("send after close rejects with TransportError", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://send-closed");
      listener = await transport.listen(endpoint, async () => {});

      const conn = await transport.connect(endpoint);
      await conn.close();

      try {
        await conn.send(new Uint8Array([1]));
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(TransportError);
        expect((err as TransportError).kind).toBe("transport_failure");
      }
    });

    it("inbound completes after graceful close", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://inbound-close");
      let iteratorCompleted = false;

      listener = await transport.listen(endpoint, async (conn) => {
        for await (const _ of conn.inbound) {
          // consume
        }
        iteratorCompleted = true;
      });

      const client = await transport.connect(endpoint);
      await client.close();

      await new Promise((r) => setTimeout(r, 10));
      expect(iteratorCompleted).toBe(true);
    });

    it("handler throw does not crash server", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://handler-throw");
      let callCount = 0;

      listener = await transport.listen(endpoint, async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Handler error");
        }
        // Second call succeeds
      });

      // First connection - handler throws (but should be isolated)
      const conn1 = await transport.connect(endpoint);
      await new Promise((r) => setTimeout(r, 10)); // Allow handler to run
      await conn1.close();

      // Second connection should still work
      const conn2 = await transport.connect(endpoint);
      await new Promise((r) => setTimeout(r, 10));
      expect(conn2.state).toBe("open");
      expect(callCount).toBe(2);
      await conn2.close();
    });

    it("reject duplicate listen on same endpoint", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://duplicate");
      listener = await transport.listen(endpoint, async () => {});

      await expect(
        transport.listen(endpoint, async () => {}),
      ).rejects.toThrow();
    });

    it("connect rejects with aborted signal", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://abort");
      listener = await transport.listen(endpoint, async () => {});

      const controller = new AbortController();
      controller.abort("test reason");

      try {
        await transport.connect(endpoint, { signal: controller.signal });
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(TransportError);
        expect((err as TransportError).kind).toBe("aborted");
      }
    });

    it("abnormal close propagates to peer", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://abnormal");
      let serverConn: Awaited<ReturnType<typeof transport.connect>> | undefined;
      let serverIteratorError: Error | undefined;

      listener = await transport.listen(endpoint, async (conn) => {
        serverConn = conn;
        try {
          for await (const _ of conn.inbound) {
            // consume
          }
        } catch (err) {
          serverIteratorError = err as Error;
        }
      });

      const client = await transport.connect(endpoint);
      await new Promise((r) => setTimeout(r, 10));

      // Client closes abnormally
      const error = new TransportError("transport_failure", "Test error");
      // Access internal method via type assertion for testing
      (
        client as unknown as {
          closeWithError(e: TransportError): Promise<void>;
        }
      ).closeWithError(error);

      await new Promise((r) => setTimeout(r, 10));

      // Server should see abnormal close
      const serverCloseInfo = await serverConn!.closed;
      expect(serverCloseInfo.graceful).toBe(false);
      expect(serverCloseInfo.error).toBeDefined();
      expect(serverCloseInfo.closeCode).toBe(1006);

      // Server iterator should have thrown
      expect(serverIteratorError).toBeInstanceOf(TransportError);
      expect((serverIteratorError as TransportError).kind).toBe(
        "abnormal_close",
      );
    });
  });

  describe("Iterator Semantics", () => {
    it("single consumer enforced", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://single-consumer");
      let serverConn: Awaited<ReturnType<typeof transport.connect>> | undefined;

      listener = await transport.listen(endpoint, async (conn) => {
        serverConn = conn;
      });

      const client = await transport.connect(endpoint);
      await new Promise((r) => setTimeout(r, 10));

      // Start first iterator
      const iter1 = serverConn!.inbound[Symbol.asyncIterator]();

      // Second iterator should throw
      try {
        serverConn!.inbound[Symbol.asyncIterator]();
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(TransportError);
        expect((err as TransportError).kind).toBe("transport_failure");
      }

      await client.close();
      await iter1.return?.();
    });

    it("early break does not close connection", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://early-break");
      let serverConn: Awaited<ReturnType<typeof transport.connect>> | undefined;

      listener = await transport.listen(endpoint, async (conn) => {
        serverConn = conn;
      });

      const client = await transport.connect(endpoint);
      await client.send(new Uint8Array([1]));
      await client.send(new Uint8Array([2]));
      await new Promise((r) => setTimeout(r, 10));

      // Break after first message
      for await (const _ of serverConn!.inbound) {
        break;
      }

      // Connection should still be open
      expect(serverConn!.state).toBe("open");

      await client.close();
      await serverConn!.close();
    });

    it("resumes and drains buffer after break", async () => {
      const endpoint = unsafeAsTransportEndpoint("loopback://resume");
      let serverConn: Awaited<ReturnType<typeof transport.connect>> | undefined;

      listener = await transport.listen(endpoint, async (conn) => {
        serverConn = conn;
      });

      const client = await transport.connect(endpoint);
      await client.send(new Uint8Array([1]));
      await client.send(new Uint8Array([2]));
      await client.send(new Uint8Array([3]));
      await new Promise((r) => setTimeout(r, 10));

      const received: number[] = [];

      // First iteration - break after one
      for await (const data of serverConn!.inbound) {
        received.push(data[0]!);
        break;
      }

      // Resume iteration - get remaining
      for await (const data of serverConn!.inbound) {
        received.push(data[0]!);
        if (received.length >= 3) break;
      }

      expect(received).toEqual([1, 2, 3]);

      await client.close();
      await serverConn!.close();
    });
  });
});

describe("TransportError helpers", () => {
  describe("isRetryable", () => {
    it("returns true for retryable errors", () => {
      expect(isRetryable("connection_refused")).toBe(true);
      expect(isRetryable("dns_failure")).toBe(true);
      expect(isRetryable("timeout")).toBe(true);
      expect(isRetryable("network_offline")).toBe(true);
      expect(isRetryable("abnormal_close")).toBe(true);
      expect(isRetryable("transport_failure")).toBe(true);
    });

    it("returns false for non-retryable errors", () => {
      expect(isRetryable("tls_failure")).toBe(false);
      expect(isRetryable("message_too_large")).toBe(false);
      expect(isRetryable("policy_violation")).toBe(false);
      expect(isRetryable("authentication_failed")).toBe(false);
      expect(isRetryable("aborted")).toBe(false);
      expect(isRetryable("subprotocol_mismatch")).toBe(false);
    });
  });
});
