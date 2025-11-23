// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "bun:test";
import { generateFrameId, frameIdToHex } from "@sideband/protocol";
import { encodeRpcEnvelope, decodeRpcEnvelope } from "./codec.js";
import {
  createRpcRequest,
  createRpcSuccessResponse,
  createRpcErrorResponse,
  createRpcNotification,
  type RpcEnvelope,
} from "./envelope.js";
import { ProtocolError, ErrorCode } from "@sideband/protocol";

describe("RPC Codec", () => {
  describe("JSON encoding", () => {
    it("encodes a request with cid as hex", () => {
      const cid = generateFrameId();
      const req = createRpcRequest("getUser", cid, { id: 42 });
      const bytes = encodeRpcEnvelope(req, "json");
      expect(bytes).toBeInstanceOf(Uint8Array);
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect(decoded.t).toBe("r");
      expect(decoded.m).toBe("getUser");
      expect(decoded.p).toEqual({ id: 42 });
      // cid should be hex string in JSON
      expect(decoded.cid).toBe(frameIdToHex(cid));
    });

    it("encodes a success response with cid", () => {
      const cid = generateFrameId();
      const res = createRpcSuccessResponse(cid, { id: 42, name: "Alice" });
      const bytes = encodeRpcEnvelope(res, "json");
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect(decoded.t).toBe("R");
      expect(decoded.result).toEqual({ id: 42, name: "Alice" });
      expect(decoded.cid).toBe(frameIdToHex(cid));
    });

    it("encodes an error response with cid", () => {
      const cid = generateFrameId();
      const err = createRpcErrorResponse(cid, 500, "Server Error");
      const bytes = encodeRpcEnvelope(err, "json");
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect(decoded.t).toBe("E");
      expect(decoded.code).toBe(500);
      expect(decoded.message).toBe("Server Error");
      expect(decoded.cid).toBe(frameIdToHex(cid));
    });

    it("encodes a notification without cid", () => {
      const notif = createRpcNotification("user.joined", { userId: "bob" });
      const bytes = encodeRpcEnvelope(notif, "json");
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect(decoded.t).toBe("N");
      expect(decoded.e).toBe("user.joined");
      expect(decoded.d).toEqual({ userId: "bob" });
      expect("cid" in decoded).toBe(false);
    });

    it("omits undefined fields in request", () => {
      const cid = generateFrameId();
      const req = createRpcRequest("ping", cid);
      const bytes = encodeRpcEnvelope(req, "json");
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect("p" in decoded).toBe(false);
      expect("cid" in decoded).toBe(true); // cid is always present
    });
  });

  describe("JSON decoding", () => {
    it("decodes a request with cid", () => {
      const cid = generateFrameId();
      const req = createRpcRequest("getUser", cid, { id: 42 });
      const bytes = encodeRpcEnvelope(req, "json");
      const decoded = decodeRpcEnvelope(bytes, "json") as any;
      expect(decoded.t).toBe("r");
      expect(decoded.m).toBe("getUser");
      expect(decoded.p).toEqual({ id: 42 });
      expect(decoded.cid).toEqual(cid); // Should be restored as FrameId
    });

    it("decodes a success response with cid", () => {
      const cid = generateFrameId();
      const res = createRpcSuccessResponse(cid, { value: 123 });
      const bytes = encodeRpcEnvelope(res, "json");
      const decoded = decodeRpcEnvelope(bytes, "json") as any;
      expect(decoded.t).toBe("R");
      expect(decoded.result).toEqual({ value: 123 });
      expect(decoded.cid).toEqual(cid);
    });

    it("decodes an error response with cid", () => {
      const cid = generateFrameId();
      const err = createRpcErrorResponse(cid, 404, "Not Found", {
        path: "/users/1",
      });
      const bytes = encodeRpcEnvelope(err, "json");
      const decoded = decodeRpcEnvelope(bytes, "json") as any;
      expect(decoded.t).toBe("E");
      expect(decoded.code).toBe(404);
      expect(decoded.message).toBe("Not Found");
      expect(decoded.data).toEqual({ path: "/users/1" });
      expect(decoded.cid).toEqual(cid);
    });

    it("decodes a notification without cid", () => {
      const notif = createRpcNotification("server.ready", { version: "1.0" });
      const bytes = encodeRpcEnvelope(notif, "json");
      const decoded = decodeRpcEnvelope(bytes, "json") as any;
      expect(decoded.t).toBe("N");
      expect(decoded.e).toBe("server.ready");
      expect(decoded.d).toEqual({ version: "1.0" });
      expect("cid" in decoded).toBe(false);
    });

    it("accepts Uint8Array", () => {
      const cid = generateFrameId();
      const req = createRpcRequest("test", cid);
      const bytes = encodeRpcEnvelope(req, "json");
      const decoded = decodeRpcEnvelope(bytes, "json");
      expect(decoded.t).toBe("r");
    });

    it("throws on missing cid in request", () => {
      const badJson = JSON.stringify({ t: "r", m: "test" });
      const bytes = new TextEncoder().encode(badJson);
      expect(() => decodeRpcEnvelope(bytes, "json")).toThrow(ProtocolError);
    });

    it("throws on missing cid in response", () => {
      const badJson = JSON.stringify({ t: "R", result: "ok" });
      const bytes = new TextEncoder().encode(badJson);
      expect(() => decodeRpcEnvelope(bytes, "json")).toThrow(ProtocolError);
    });

    it("throws on invalid cid format", () => {
      const badJson = JSON.stringify({ t: "r", m: "test", cid: "not-hex" });
      const bytes = new TextEncoder().encode(badJson);
      expect(() => decodeRpcEnvelope(bytes, "json")).toThrow(ProtocolError);
    });

    it("throws on missing method in request", () => {
      const cid = generateFrameId();
      const badJson = JSON.stringify({ t: "r", cid: frameIdToHex(cid) });
      const bytes = new TextEncoder().encode(badJson);
      expect(() => decodeRpcEnvelope(bytes, "json")).toThrow(ProtocolError);
    });

    it("throws on missing code in error response", () => {
      const cid = generateFrameId();
      const badJson = JSON.stringify({
        t: "E",
        cid: frameIdToHex(cid),
        message: "Error",
      });
      const bytes = new TextEncoder().encode(badJson);
      expect(() => decodeRpcEnvelope(bytes, "json")).toThrow(ProtocolError);
    });

    it("throws on missing event in notification", () => {
      const badJson = JSON.stringify({ t: "N" });
      const bytes = new TextEncoder().encode(badJson);
      expect(() => decodeRpcEnvelope(bytes, "json")).toThrow(ProtocolError);
    });

    it("throws on invalid discriminant", () => {
      const cid = generateFrameId();
      const badJson = JSON.stringify({
        t: "X",
        m: "foo",
        cid: frameIdToHex(cid),
      });
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
    it("survives request round-trip with cid", () => {
      const cid = generateFrameId();
      const original = createRpcRequest("complexMethod", cid, {
        nested: { array: [1, 2, 3], bool: true, null: null },
      });
      const bytes = encodeRpcEnvelope(original, "json");
      const decoded = decodeRpcEnvelope(bytes, "json") as any;
      expect(decoded.m).toBe(original.m);
      expect(decoded.p).toEqual(original.p);
      expect(decoded.cid).toEqual(original.cid);
    });

    it("survives response round-trip with cid", () => {
      const cid = generateFrameId();
      const original = createRpcSuccessResponse(cid, {
        items: ["a", "b", "c"],
        count: 3,
      });
      const bytes = encodeRpcEnvelope(original, "json");
      const decoded = decodeRpcEnvelope(bytes, "json") as any;
      expect(decoded.result).toEqual(original.result);
      expect(decoded.cid).toEqual(original.cid);
    });

    it("survives error round-trip with cid", () => {
      const cid = generateFrameId();
      const original = createRpcErrorResponse(cid, 503, "Service Unavailable", {
        retryAfter: 60,
      });
      const bytes = encodeRpcEnvelope(original, "json");
      const decoded = decodeRpcEnvelope(bytes, "json") as any;
      expect(decoded.code).toBe(original.code);
      expect(decoded.message).toBe(original.message);
      expect(decoded.data).toEqual(original.data);
      expect(decoded.cid).toEqual(original.cid);
    });
  });

  describe("Unsupported formats", () => {
    it("throws on unsupported encoding format", () => {
      const cid = generateFrameId();
      const req = createRpcRequest("test", cid);
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
