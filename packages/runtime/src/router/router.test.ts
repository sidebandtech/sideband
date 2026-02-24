// SPDX-License-Identifier: Apache-2.0

import {
  type MessageFrame,
  asPeerId,
  asSubject,
  createMessageFrame,
  decodeFrame,
  ErrorCode,
  frameIdToHex,
  FrameKind,
  generateFrameId,
} from "@sideband/protocol";
import {
  createRpcNotification,
  createRpcRequest,
  decodeRpcEnvelope,
  encodeRpcEnvelope,
  RpcErrorCode,
} from "@sideband/rpc";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createRouter, Router } from "./router.js";
import type { InboundMessage, SessionLike } from "./types.js";

// Helper to create mock session
function createMockSession(peerId: string = "peer-1"): SessionLike & {
  sentData: Uint8Array[];
  clearSentData(): void;
} {
  const session = {
    peerId: asPeerId(peerId),
    sentData: [] as Uint8Array[],
    send: null as any,
    clearSentData() {
      this.sentData = [];
    },
  };
  session.send = mock(async (data: Uint8Array) => {
    session.sentData.push(data);
  });
  return session;
}

// Helper to create RPC request frame
function createRpcRequestFrame(method: string, params?: unknown): MessageFrame {
  const cid = generateFrameId();
  const envelope = createRpcRequest(method, cid, params);
  const data = encodeRpcEnvelope(envelope);
  return createMessageFrame(asSubject("rpc"), data);
}

// Helper to create notification frame
function createNotificationFrame(event: string, data?: unknown): MessageFrame {
  const envelope = createRpcNotification(event, data);
  const payload = encodeRpcEnvelope(envelope);
  return createMessageFrame(asSubject("event"), payload);
}

// Helper to create custom message frame
function createCustomFrame(subject: string, data: Uint8Array): MessageFrame {
  return createMessageFrame(asSubject(subject), data);
}

describe("Router", () => {
  let router: Router;
  let session: SessionLike & { sentData: Uint8Array[]; clearSentData(): void };

  beforeEach(() => {
    router = createRouter();
    session = createMockSession();
  });

  describe("route registration", () => {
    it("registers exact match handler for channel", () => {
      const handler = mock(async () => {});
      const unsub = router.route("rpc", handler);

      expect(typeof unsub).toBe("function");
    });

    it("registers prefix handler for app/", () => {
      const handler = mock(async () => {});
      const unsub = router.routePrefix("app/", handler);

      expect(typeof unsub).toBe("function");
    });

    it("rejects invalid subject", () => {
      const handler = mock(async () => {});

      expect(() => router.route("invalid/subject", handler)).toThrow(
        /Invalid subject/,
      );
    });

    it("rejects invalid prefix", () => {
      const handler = mock(async () => {});

      expect(() => router.routePrefix("invalid/", handler)).toThrow(
        /Invalid prefix/,
      );
    });

    it("rejects reserved channel (stream)", () => {
      const handler = mock(async () => {});

      expect(() => router.route("stream", handler)).toThrow(
        /Unsupported feature/,
      );
    });

    it("unsubscribe removes handler", async () => {
      let callCount = 0;
      const handler = mock(async (msg: InboundMessage) => {
        callCount++;
        await msg.rpc?.reply("ok");
      });

      const unsub = router.route("rpc", handler);
      const frame = createRpcRequestFrame("test");

      // First dispatch - handler called
      await router.dispatch(frame, session);
      expect(callCount).toBe(1);

      // Unsubscribe
      unsub();

      // Second dispatch - no handler, UnsupportedMethod response
      session.clearSentData();
      await router.dispatch(frame, session);

      // Should get UnsupportedMethod error response
      expect(session.sentData).toHaveLength(1);
      const responseFrame = decodeFrame(session.sentData[0]!);
      expect(responseFrame.kind).toBe(FrameKind.Message);
      const responseEnvelope = decodeRpcEnvelope(
        (responseFrame as MessageFrame).data,
      );
      expect(responseEnvelope.t).toBe("E");
      expect((responseEnvelope as any).code).toBe(
        RpcErrorCode.UnsupportedMethod,
      );
    });

    it("unroute removes all handlers for subject", async () => {
      const h1 = mock(async () => {});
      const h2 = mock(async () => {});

      router.route("rpc", h1);
      router.route("rpc", h2);

      router.unroute("rpc");

      const frame = createRpcRequestFrame("test");
      await router.dispatch(frame, session);

      // Should get UnsupportedMethod since no handlers
      expect(session.sentData).toHaveLength(1);
      const responseFrame = decodeFrame(session.sentData[0]!);
      const responseEnvelope = decodeRpcEnvelope(
        (responseFrame as MessageFrame).data,
      );
      expect((responseEnvelope as any).code).toBe(
        RpcErrorCode.UnsupportedMethod,
      );
    });

    it("clear removes all handlers", async () => {
      router.route("rpc", async () => {});
      router.routePrefix("app/", async () => {});

      router.clear();

      const frame = createRpcRequestFrame("a");
      await router.dispatch(frame, session);

      expect(session.sentData).toHaveLength(1);
      const responseFrame = decodeFrame(session.sentData[0]!);
      const responseEnvelope = decodeRpcEnvelope(
        (responseFrame as MessageFrame).data,
      );
      expect((responseEnvelope as any).code).toBe(
        RpcErrorCode.UnsupportedMethod,
      );
    });
  });

  describe("RPC dispatch", () => {
    it("dispatches to handler and allows reply", async () => {
      const handler = mock(async (msg: InboundMessage) => {
        expect(msg.rpc).toBeDefined();
        expect(msg.rpc!.method).toBe("getUser");
        expect(msg.rpc!.params).toEqual({ id: 123 });
        await msg.rpc!.reply({ name: "Alice" });
      });

      router.route("rpc", handler);

      const cid = generateFrameId();
      const envelope = createRpcRequest("getUser", cid, { id: 123 });
      const frame = createMessageFrame(
        asSubject("rpc"),
        encodeRpcEnvelope(envelope),
      );

      await router.dispatch(frame, session);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(session.sentData).toHaveLength(1);

      const responseFrame = decodeFrame(session.sentData[0]!);
      expect(responseFrame.kind).toBe(FrameKind.Message);
      const responseEnvelope = decodeRpcEnvelope(
        (responseFrame as MessageFrame).data,
      );
      expect(responseEnvelope.t).toBe("R");
      expect((responseEnvelope as any).result).toEqual({ name: "Alice" });
    });

    it("dispatches to handler and allows error reply", async () => {
      const handler = mock(async (msg: InboundMessage) => {
        await msg.rpc!.error(2001, "User not found", { userId: 123 });
      });

      router.route("rpc", handler);
      const frame = createRpcRequestFrame("getUser", { id: 123 });

      await router.dispatch(frame, session);

      expect(session.sentData).toHaveLength(1);
      const responseFrame = decodeFrame(session.sentData[0]!);
      const responseEnvelope = decodeRpcEnvelope(
        (responseFrame as MessageFrame).data,
      );
      expect(responseEnvelope.t).toBe("E");
      expect((responseEnvelope as any).code).toBe(2001);
      expect((responseEnvelope as any).message).toBe("User not found");
    });

    it("returns UnsupportedMethod when no handler", async () => {
      const frame = createRpcRequestFrame("unknownMethod");

      await router.dispatch(frame, session);

      expect(session.sentData).toHaveLength(1);
      const responseFrame = decodeFrame(session.sentData[0]!);
      const responseEnvelope = decodeRpcEnvelope(
        (responseFrame as MessageFrame).data,
      );
      expect(responseEnvelope.t).toBe("E");
      expect((responseEnvelope as any).code).toBe(
        RpcErrorCode.UnsupportedMethod,
      );
      expect((responseEnvelope as any).message).toBe("Method not found");
    });

    it("returns error when handler throws", async () => {
      const handler = mock(async () => {
        throw new Error("Database connection failed");
      });

      router.route("rpc", handler);
      const frame = createRpcRequestFrame("test");

      await router.dispatch(frame, session);

      expect(session.sentData).toHaveLength(1);
      const responseFrame = decodeFrame(session.sentData[0]!);
      const responseEnvelope = decodeRpcEnvelope(
        (responseFrame as MessageFrame).data,
      );
      expect(responseEnvelope.t).toBe("E");
      expect((responseEnvelope as any).code).toBe(2000);
      expect((responseEnvelope as any).message).toBe(
        "Database connection failed",
      );
    });

    it("uses custom error mapper", async () => {
      class ValidationError extends Error {
        code = 2001;
        details = { field: "email" };
      }

      const customRouter = createRouter({
        errorMapper: (error) => {
          if (error instanceof ValidationError) {
            return {
              code: error.code,
              message: error.message,
              data: error.details,
            };
          }
          return { code: 2000, message: error.message };
        },
      });

      customRouter.route("rpc", async () => {
        throw new ValidationError("Invalid email");
      });

      const frame = createRpcRequestFrame("test");
      await customRouter.dispatch(frame, session);

      const responseFrame = decodeFrame(session.sentData[0]!);
      const responseEnvelope = decodeRpcEnvelope(
        (responseFrame as MessageFrame).data,
      );
      expect((responseEnvelope as any).code).toBe(2001);
      expect((responseEnvelope as any).data).toEqual({ field: "email" });
    });

    it("returns timeout error when handler exceeds timeout", async () => {
      const shortTimeoutRouter = createRouter({ rpcTimeoutMs: 50 });

      shortTimeoutRouter.route("rpc", async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      const frame = createRpcRequestFrame("test");
      await shortTimeoutRouter.dispatch(frame, session);

      expect(session.sentData).toHaveLength(1);
      const responseFrame = decodeFrame(session.sentData[0]!);
      const responseEnvelope = decodeRpcEnvelope(
        (responseFrame as MessageFrame).data,
      );
      expect(responseEnvelope.t).toBe("E");
      expect((responseEnvelope as any).code).toBe(RpcErrorCode.Timeout);
      expect((responseEnvelope as any).message).toBe("Handler timeout");
    });

    it("returns ErrorFrame for malformed envelope", async () => {
      router.route("rpc", async () => {});

      // Create frame with invalid envelope data
      const frame = createMessageFrame(
        asSubject("rpc"),
        new TextEncoder().encode("not valid json {{{"),
      );

      const result = await router.dispatch(frame, session);

      expect(result).not.toBeNull();
      const errorFrame = decodeFrame(result!);
      expect(errorFrame.kind).toBe(FrameKind.Error);
      expect((errorFrame as any).code).toBe(ErrorCode.InvalidFrame);
      expect((errorFrame as any).message).toBe("Malformed RPC envelope");
    });

    it("ignores RPC responses (handled by correlation manager)", async () => {
      router.route("rpc", async () => {});

      // Create a response envelope instead of request
      // Use hex-encoded cid for proper JSON serialization
      const cid = generateFrameId();
      const responseEnvelope = { t: "R", cid: frameIdToHex(cid), result: "ok" };
      const frame = createMessageFrame(
        asSubject("rpc"),
        new TextEncoder().encode(JSON.stringify(responseEnvelope)),
      );

      const result = await router.dispatch(frame, session);

      expect(result).toBeNull();
      expect(session.sentData).toHaveLength(0);
    });
  });

  describe("event dispatch", () => {
    it("broadcasts to all handlers", async () => {
      const h1 = mock(async () => {});
      const h2 = mock(async () => {});

      router.route("event", h1);
      router.route("event", h2);

      const frame = createNotificationFrame("user.joined", { userId: 1 });

      await router.dispatch(frame, session);

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it("continues dispatching when handler throws", async () => {
      const h1 = mock(async () => {
        throw new Error("Handler 1 failed");
      });
      const h2 = mock(async () => {});

      router.route("event", h1);
      router.route("event", h2);

      const frame = createNotificationFrame("user.joined");

      // Should not throw, should continue to h2
      await router.dispatch(frame, session);

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it("drops event with invalid envelope (no ErrorFrame)", async () => {
      const handler = mock(async () => {});
      router.route("event", handler);

      // Create frame with invalid envelope
      const frame = createMessageFrame(
        asSubject("event"),
        new TextEncoder().encode("invalid json"),
      );

      const result = await router.dispatch(frame, session);

      expect(result).toBeNull();
      expect(handler).not.toHaveBeenCalled();
      expect(session.sentData).toHaveLength(0);
    });

    it("drops event with non-notification envelope", async () => {
      const handler = mock(async () => {});
      router.route("event", handler);

      // Create frame with request envelope instead of notification
      const cid = generateFrameId();
      const requestEnvelope = createRpcRequest("test", cid);
      const frame = createMessageFrame(
        asSubject("event"),
        encodeRpcEnvelope(requestEnvelope),
      );

      const result = await router.dispatch(frame, session);

      expect(result).toBeNull();
      expect(handler).not.toHaveBeenCalled();
    });

    it("does not provide rpc context for events", async () => {
      let receivedMsg: InboundMessage | null = null;
      router.route("event", async (msg) => {
        receivedMsg = msg;
      });

      const frame = createNotificationFrame("test");
      await router.dispatch(frame, session);

      expect(receivedMsg).not.toBeNull();
      expect(receivedMsg!.rpc).toBeUndefined();
    });
  });

  describe("custom dispatch", () => {
    it("broadcasts to all handlers for app/ subjects", async () => {
      const h1 = mock(async () => {});
      const h2 = mock(async () => {});

      router.route("app/custom", h1);
      router.route("app/custom", h2);

      const frame = createCustomFrame("app/custom", new Uint8Array([1, 2, 3]));

      await router.dispatch(frame, session);

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it("continues on handler error", async () => {
      const h1 = mock(async () => {
        throw new Error("Failed");
      });
      const h2 = mock(async () => {});

      router.route("app/custom", h1);
      router.route("app/custom", h2);

      const frame = createCustomFrame("app/custom", new Uint8Array([1, 2, 3]));

      await router.dispatch(frame, session);

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });
  });

  describe("subject validation", () => {
    it("returns ErrorFrame for reserved channel (stream)", async () => {
      // We cannot route stream, but we can dispatch to it to test validation
      const frame = createCustomFrame("stream", new Uint8Array([1]));

      const result = await router.dispatch(frame, session);

      expect(result).not.toBeNull();
      const errorFrame = decodeFrame(result!);
      expect(errorFrame.kind).toBe(FrameKind.Error);
      expect((errorFrame as any).code).toBe(ErrorCode.UnsupportedFeature);
    });
  });

  describe("InboundMessage", () => {
    it("provides correct properties", async () => {
      let receivedMsg: InboundMessage | null = null;
      router.route("rpc", async (msg) => {
        receivedMsg = msg;
        await msg.rpc!.reply("ok");
      });

      const frame = createRpcRequestFrame("test", { foo: "bar" });
      await router.dispatch(frame, session);

      expect(receivedMsg).not.toBeNull();
      expect(receivedMsg!.subject).toBe(asSubject("rpc"));
      expect(receivedMsg!.peerId).toBe(session.peerId);
      expect(receivedMsg!.session).toBe(session);
      expect(receivedMsg!.frame).toBeDefined();
      expect(receivedMsg!.frame.frameId).toEqual(frame.frameId);
    });

    it("frame is readonly", async () => {
      let receivedMsg: InboundMessage | null = null;
      router.route("rpc", async (msg) => {
        receivedMsg = msg;
        await msg.rpc!.reply("ok");
      });

      const frame = createRpcRequestFrame("test");
      await router.dispatch(frame, session);

      expect(receivedMsg).not.toBeNull();
      expect(Object.isFrozen(receivedMsg!.frame)).toBe(true);
    });

    it("send() generates new frameId", async () => {
      router.route("rpc", async (msg) => {
        await msg.send(asSubject("app/response"), new Uint8Array([1, 2, 3]));
        await msg.rpc!.reply("ok");
      });

      const frame = createRpcRequestFrame("test");
      await router.dispatch(frame, session);

      // Should have sent response via send() and via reply()
      expect(session.sentData).toHaveLength(2);

      const sentFrame = decodeFrame(session.sentData[0]!);
      expect(sentFrame.kind).toBe(FrameKind.Message);
      // New frameId should be different from original
      expect(sentFrame.frameId).not.toEqual(frame.frameId);
    });
  });

  describe("createRouter factory", () => {
    it("creates router with default config", () => {
      const r = createRouter();
      expect(r).toBeInstanceOf(Router);
    });

    it("creates router with custom config", () => {
      const r = createRouter({ rpcTimeoutMs: 5000 });
      expect(r).toBeInstanceOf(Router);
    });

    it("creates router with custom subject policy", () => {
      const customPolicy = {
        allowedChannels: ["rpc", "event", "debug"],
        reservedChannels: ["stream"],
        allowedPrefixes: ["app/"],
      };
      const r = createRouter({}, customPolicy);

      // Should allow debug channel
      const handler = mock(async () => {});
      expect(() => r.route("debug", handler)).not.toThrow();
    });
  });
});
