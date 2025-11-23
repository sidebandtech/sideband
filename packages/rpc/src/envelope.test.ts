// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "bun:test";
import {
  createRpcRequest,
  createRpcSuccessResponse,
  createRpcErrorResponse,
  createRpcNotification,
  isRpcRequest,
  isRpcResponse,
  isRpcSuccessResponse,
  isRpcErrorResponse,
  isRpcNotification,
} from "./envelope.js";

describe("RPC Envelope", () => {
  describe("Request", () => {
    it("creates a request with method and params", () => {
      const req = createRpcRequest("getUser", { id: 42 });
      expect(req.t).toBe("r");
      expect(req.m).toBe("getUser");
      expect(req.p).toEqual({ id: 42 });
    });

    it("creates a request with no params", () => {
      const req = createRpcRequest("ping");
      expect(req.t).toBe("r");
      expect(req.m).toBe("ping");
      expect(req.p).toBeUndefined();
    });

    it("isRpcRequest identifies requests", () => {
      const req = createRpcRequest("test");
      expect(isRpcRequest(req)).toBe(true);
      expect(isRpcResponse(req)).toBe(false);
      expect(isRpcNotification(req)).toBe(false);
    });
  });

  describe("Success Response", () => {
    it("creates a response with result", () => {
      const res = createRpcSuccessResponse({ id: 42, name: "Alice" });
      expect(res.t).toBe("R");
      expect(res.result).toEqual({ id: 42, name: "Alice" });
    });

    it("creates a response with no result", () => {
      const res = createRpcSuccessResponse();
      expect(res.t).toBe("R");
      expect(res.result).toBeUndefined();
    });

    it("isRpcSuccessResponse identifies success responses", () => {
      const res = createRpcSuccessResponse({ ok: true });
      expect(isRpcResponse(res)).toBe(true);
      expect(isRpcSuccessResponse(res)).toBe(true);
      expect(isRpcErrorResponse(res)).toBe(false);
    });
  });

  describe("Error Response", () => {
    it("creates an error response", () => {
      const err = createRpcErrorResponse(500, "Internal Server Error", {
        details: "Something went wrong",
      });
      expect(err.t).toBe("E");
      expect(err.code).toBe(500);
      expect(err.message).toBe("Internal Server Error");
      expect(err.data).toEqual({ details: "Something went wrong" });
    });

    it("creates an error response without data", () => {
      const err = createRpcErrorResponse(404, "Not Found");
      expect(err.t).toBe("E");
      expect(err.code).toBe(404);
      expect(err.message).toBe("Not Found");
      expect(err.data).toBeUndefined();
    });

    it("isRpcErrorResponse identifies error responses", () => {
      const err = createRpcErrorResponse(400, "Bad Request");
      expect(isRpcResponse(err)).toBe(true);
      expect(isRpcErrorResponse(err)).toBe(true);
      expect(isRpcSuccessResponse(err)).toBe(false);
    });
  });

  describe("Notification", () => {
    it("creates a notification with event and data", () => {
      const notif = createRpcNotification("user.joined", {
        userId: "alice",
      });
      expect(notif.t).toBe("N");
      expect(notif.e).toBe("user.joined");
      expect(notif.d).toEqual({ userId: "alice" });
    });

    it("creates a notification with no data", () => {
      const notif = createRpcNotification("serverRestarted");
      expect(notif.t).toBe("N");
      expect(notif.e).toBe("serverRestarted");
      expect(notif.d).toBeUndefined();
    });

    it("isRpcNotification identifies notifications", () => {
      const notif = createRpcNotification("test.event");
      expect(isRpcNotification(notif)).toBe(true);
      expect(isRpcRequest(notif)).toBe(false);
      expect(isRpcResponse(notif)).toBe(false);
    });
  });
});
