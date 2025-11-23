// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "bun:test";
import { encodeRpcEnvelope, decodeRpcEnvelope } from "./codec.js";
import {
  createRpcRequest,
  createRpcSuccessResponse,
  createRpcErrorResponse,
  createRpcNotification,
  type RpcEnvelope,
} from "./envelope.js";
import { ProtocolViolation } from "./subject.js";
import { ProtocolError, ErrorCode } from "@sideband/protocol";

describe("RPC Codec", () => {
  describe("JSON encoding", () => {
    it("encodes a request", () => {
      const req = createRpcRequest("getUser", { id: 42 });
      const bytes = encodeRpcEnvelope(req, "json");
      expect(bytes).toBeInstanceOf(Uint8Array);
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect(decoded.t).toBe("r");
      expect(decoded.m).toBe("getUser");
      expect(decoded.p).toEqual({ id: 42 });
    });

    it("encodes a success response", () => {
      const res = createRpcSuccessResponse({ id: 42, name: "Alice" });
      const bytes = encodeRpcEnvelope(res, "json");
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect(decoded.t).toBe("R");
      expect(decoded.result).toEqual({ id: 42, name: "Alice" });
    });

    it("encodes an error response", () => {
      const err = createRpcErrorResponse(500, "Server Error");
      const bytes = encodeRpcEnvelope(err, "json");
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect(decoded.t).toBe("E");
      expect(decoded.code).toBe(500);
      expect(decoded.message).toBe("Server Error");
    });

    it("encodes a notification", () => {
      const notif = createRpcNotification("user.joined", { userId: "bob" });
      const bytes = encodeRpcEnvelope(notif, "json");
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect(decoded.t).toBe("N");
      expect(decoded.e).toBe("user.joined");
      expect(decoded.d).toEqual({ userId: "bob" });
    });

    it("omits undefined fields", () => {
      const req = createRpcRequest("ping");
      const bytes = encodeRpcEnvelope(req, "json");
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect("p" in decoded).toBe(false);
    });
  });

  describe("JSON decoding", () => {
    it("decodes a request", () => {
      const req = createRpcRequest("getUser", { id: 42 });
      const bytes = encodeRpcEnvelope(req, "json");
      const decoded = decodeRpcEnvelope(bytes, "json");
      expect(decoded.t).toBe("r");
      expect((decoded as any).m).toBe("getUser");
      expect((decoded as any).p).toEqual({ id: 42 });
    });

    it("decodes a success response", () => {
      const res = createRpcSuccessResponse({ value: 123 });
      const bytes = encodeRpcEnvelope(res, "json");
      const decoded = decodeRpcEnvelope(bytes, "json");
      expect(decoded.t).toBe("R");
      expect((decoded as any).result).toEqual({ value: 123 });
    });

    it("decodes an error response", () => {
      const err = createRpcErrorResponse(404, "Not Found", {
        path: "/users/1",
      });
      const bytes = encodeRpcEnvelope(err, "json");
      const decoded = decodeRpcEnvelope(bytes, "json");
      expect(decoded.t).toBe("E");
      expect((decoded as any).code).toBe(404);
      expect((decoded as any).message).toBe("Not Found");
      expect((decoded as any).data).toEqual({ path: "/users/1" });
    });

    it("decodes a notification", () => {
      const notif = createRpcNotification("server.ready", { version: "1.0" });
      const bytes = encodeRpcEnvelope(notif, "json");
      const decoded = decodeRpcEnvelope(bytes, "json");
      expect(decoded.t).toBe("N");
      expect((decoded as any).e).toBe("server.ready");
      expect((decoded as any).d).toEqual({ version: "1.0" });
    });

    it("accepts Uint8Array", () => {
      const req = createRpcRequest("test");
      const bytes = encodeRpcEnvelope(req, "json");
      const decoded = decodeRpcEnvelope(bytes, "json");
      expect(decoded.t).toBe("r");
    });

    it("throws on missing method in request", () => {
      const badJson = JSON.stringify({ t: "r" });
      const bytes = new TextEncoder().encode(badJson);
      expect(() => decodeRpcEnvelope(bytes, "json")).toThrow(ProtocolError);
    });

    it("throws on missing code in error response", () => {
      const badJson = JSON.stringify({ t: "E", message: "Error" });
      const bytes = new TextEncoder().encode(badJson);
      expect(() => decodeRpcEnvelope(bytes, "json")).toThrow(ProtocolError);
    });

    it("throws on missing event in notification", () => {
      const badJson = JSON.stringify({ t: "N" });
      const bytes = new TextEncoder().encode(badJson);
      expect(() => decodeRpcEnvelope(bytes, "json")).toThrow(ProtocolError);
    });

    it("throws on invalid discriminant", () => {
      const badJson = JSON.stringify({ t: "X", m: "foo" });
      const bytes = new TextEncoder().encode(badJson);
      expect(() => decodeRpcEnvelope(bytes, "json")).toThrow(ProtocolError);
    });

    it("throws on non-object input", () => {
      const badJson = JSON.stringify("not an object");
      const bytes = new TextEncoder().encode(badJson);
      expect(() => decodeRpcEnvelope(bytes, "json")).toThrow(ProtocolError);
    });

    it("throws on malformed JSON", () => {
      const badBytes = new TextEncoder().encode("{invalid json");
      expect(() => decodeRpcEnvelope(badBytes, "json")).toThrow(ProtocolError);
    });
  });

  describe("Round-trip", () => {
    it("survives request round-trip", () => {
      const original = createRpcRequest("complexMethod", {
        nested: { array: [1, 2, 3], bool: true, null: null },
      });
      const bytes = encodeRpcEnvelope(original, "json");
      const decoded = decodeRpcEnvelope(bytes, "json") as any;
      expect(decoded.m).toBe(original.m);
      expect(decoded.p).toEqual(original.p);
    });

    it("survives response round-trip", () => {
      const original = createRpcSuccessResponse({
        items: ["a", "b", "c"],
        count: 3,
      });
      const bytes = encodeRpcEnvelope(original, "json");
      const decoded = decodeRpcEnvelope(bytes, "json") as any;
      expect(decoded.result).toEqual(original.result);
    });

    it("survives error round-trip", () => {
      const original = createRpcErrorResponse(503, "Service Unavailable", {
        retryAfter: 60,
      });
      const bytes = encodeRpcEnvelope(original, "json");
      const decoded = decodeRpcEnvelope(bytes, "json") as any;
      expect(decoded.code).toBe(original.code);
      expect(decoded.message).toBe(original.message);
      expect(decoded.data).toEqual(original.data);
    });
  });

  describe("Unsupported formats", () => {
    it("throws on unsupported encoding format", () => {
      const req = createRpcRequest("test");
      expect(() => encodeRpcEnvelope(req, "cbor" as any)).toThrow(
        ProtocolError,
      );
    });

    it("throws on unsupported decoding format", () => {
      const bytes = new Uint8Array([1, 2, 3]);
      expect(() => decodeRpcEnvelope(bytes, "cbor" as any)).toThrow(
        ProtocolError,
      );
    });
  });
});
