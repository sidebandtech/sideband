// SPDX-License-Identifier: Apache-2.0

/**
 * Error Scope Contract Tests
 *
 * These tests verify the architectural invariant from stack.md:
 * - ErrorFrame (kind=3) is connection-scoped
 * - RpcError (t="E") is request-scoped and MUST NOT trigger transport close
 *
 * See: docs/protocols/stack.md#error-scope-and-transport-authority
 */

import {
  createErrorFrame,
  ErrorCode,
  generateFrameId,
  ProtocolError,
} from "@sideband/protocol";
import {
  createRpcErrorResponse,
  createRpcSuccessResponse,
  decodeRpcEnvelope,
  RpcErrorCode,
} from "@sideband/rpc";
import { beforeEach, describe, expect, it } from "bun:test";
import { RpcCorrelationManager } from "./correlation";

describe("Error Scope Contract", () => {
  /**
   * Test A: RpcError MUST NOT close transport
   *
   * Verifies that receiving an RpcErrorResponse (t="E") is request-scoped:
   * - Routes to the originating request via cid
   * - Does NOT affect other pending requests
   * - Transport (correlation manager) continues accepting subsequent requests
   */
  describe("RpcError is request-scoped", () => {
    let manager: RpcCorrelationManager;

    beforeEach(() => {
      manager = new RpcCorrelationManager(1000);
    });

    it("RpcErrorResponse routes to single request without affecting others", async () => {
      const cid1 = generateFrameId();
      const cid2 = generateFrameId();
      const cid3 = generateFrameId();

      // Register multiple concurrent requests
      const promise1 = manager.registerRequest(cid1);
      const promise2 = manager.registerRequest(cid2);
      const promise3 = manager.registerRequest(cid3);

      // Send an error response to request 2
      const errorResponse = createRpcErrorResponse(cid2, 500, "Server Error");
      manager.matchResponse(cid2, errorResponse);

      // Error response should resolve (not reject) the promise
      const result2 = await promise2;
      expect(result2).toEqual(errorResponse);
      expect((result2 as typeof errorResponse).t).toBe("E");

      // Other requests remain pending (transport is still open)
      expect(manager.getPendingCount()).toBe(2);

      // Other requests can still receive responses
      const success1 = createRpcSuccessResponse(cid1, { value: 1 });
      const success3 = createRpcSuccessResponse(cid3, { value: 3 });
      manager.matchResponse(cid1, success1);
      manager.matchResponse(cid3, success3);

      expect(await promise1).toEqual(success1);
      expect(await promise3).toEqual(success3);
      expect(manager.getPendingCount()).toBe(0);
    });

    it("multiple RpcErrorResponses do not cascade", async () => {
      const cid0 = generateFrameId();
      const cid1 = generateFrameId();
      const cid2 = generateFrameId();
      const cid3 = generateFrameId();
      const cid4 = generateFrameId();
      const promises = [cid0, cid1, cid2, cid3, cid4].map((cid) =>
        manager.registerRequest(cid),
      );

      // Send errors to 3 requests
      manager.matchResponse(
        cid0,
        createRpcErrorResponse(cid0, 400, "Bad Request"),
      );
      manager.matchResponse(
        cid2,
        createRpcErrorResponse(cid2, 404, "Not Found"),
      );
      manager.matchResponse(
        cid4,
        createRpcErrorResponse(cid4, 500, "Server Error"),
      );

      // Remaining requests still pending
      expect(manager.getPendingCount()).toBe(2);

      // Error responses resolved correctly
      const r0 = await promises[0];
      const r2 = await promises[2];
      const r4 = await promises[4];
      expect((r0 as any).code).toBe(400);
      expect((r2 as any).code).toBe(404);
      expect((r4 as any).code).toBe(500);

      // Remaining requests can still complete
      manager.matchResponse(cid1, createRpcSuccessResponse(cid1, "ok"));
      manager.matchResponse(cid3, createRpcSuccessResponse(cid3, "ok"));

      expect(manager.getPendingCount()).toBe(0);
    });

    it("new requests can be registered after RpcError", async () => {
      const cid1 = generateFrameId();
      const promise1 = manager.registerRequest(cid1);

      // Error response
      manager.matchResponse(
        cid1,
        createRpcErrorResponse(cid1, 503, "Unavailable"),
      );
      await promise1;

      // Transport still accepts new requests
      const cid2 = generateFrameId();
      const promise2 = manager.registerRequest(cid2);
      expect(manager.getPendingCount()).toBe(1);

      manager.matchResponse(cid2, createRpcSuccessResponse(cid2, "success"));
      expect(await promise2).toEqual(createRpcSuccessResponse(cid2, "success"));
    });
  });

  /**
   * Test B: Malformed envelope → ErrorFrame emission
   *
   * Verifies that malformed/uncorrelatable envelopes are escalated to ErrorFrame.
   * From stack.md: "Errors that cannot be routed to a request are
   * connection-scoped by definition."
   */
  describe("Malformed envelope escalation", () => {
    it("malformed JSON throws ProtocolError with InvalidEnvelope code", () => {
      const malformed = new TextEncoder().encode("{not valid json");

      let error: ProtocolError | null = null;
      try {
        decodeRpcEnvelope(malformed, "json");
      } catch (err) {
        error = err as ProtocolError;
      }

      expect(error).toBeInstanceOf(ProtocolError);
      expect(error!.code).toBe(RpcErrorCode.InvalidEnvelope);
    });

    it("missing required fields throws ProtocolError with InvalidEnvelope code", () => {
      // Request missing 'm' (method)
      const noMethod = new TextEncoder().encode(
        JSON.stringify({ t: "r", cid: "0".repeat(32) }),
      );

      let error: ProtocolError | null = null;
      try {
        decodeRpcEnvelope(noMethod, "json");
      } catch (err) {
        error = err as ProtocolError;
      }

      expect(error).toBeInstanceOf(ProtocolError);
      expect(error!.code).toBe(RpcErrorCode.InvalidEnvelope);
    });

    it("invalid discriminant throws ProtocolError with InvalidEnvelope code", () => {
      const badType = new TextEncoder().encode(
        JSON.stringify({ t: "X", m: "foo" }),
      );

      let error: ProtocolError | null = null;
      try {
        decodeRpcEnvelope(badType, "json");
      } catch (err) {
        error = err as ProtocolError;
      }

      expect(error).toBeInstanceOf(ProtocolError);
      expect(error!.code).toBe(RpcErrorCode.InvalidEnvelope);
    });

    it("escalation pattern: ProtocolError → createErrorFrame", () => {
      const malformed = new TextEncoder().encode("{oops");

      // This demonstrates the correct escalation pattern for runtime handlers
      let errorFrame = null;
      try {
        decodeRpcEnvelope(malformed, "json");
      } catch (err) {
        if (err instanceof ProtocolError) {
          // Runtime should emit ErrorFrame for unroutable errors
          errorFrame = createErrorFrame(err.code, err.message);
        }
      }

      expect(errorFrame).not.toBeNull();
      expect(errorFrame!.kind).toBe(3); // FrameKind.Error
      expect(errorFrame!.code).toBe(RpcErrorCode.InvalidEnvelope);
      expect(errorFrame!.frameId).toBeDefined();
    });
  });

  /**
   * Test C: Integration - decode error → ErrorFrame → close
   *
   * Verifies the full error handling chain:
   * 1. Decoder fails on malformed envelope
   * 2. Error is unroutable (no cid or can't parse cid)
   * 3. ErrorFrame is created (connection-scoped)
   * 4. Receiver applies fatality rules
   */
  describe("Integration: unroutable error flow", () => {
    it("unroutable error creates ErrorFrame and clears pending requests", async () => {
      const manager = new RpcCorrelationManager(5000);

      // Register some pending requests
      const cid1 = generateFrameId();
      const cid2 = generateFrameId();
      const promise1 = manager.registerRequest(cid1);
      const promise2 = manager.registerRequest(cid2);

      // Simulate receiving malformed data that can't be decoded
      const malformed = new TextEncoder().encode("{invalid");
      let errorFrame = null;

      try {
        decodeRpcEnvelope(malformed, "json");
      } catch (err) {
        if (err instanceof ProtocolError) {
          // Unroutable: create ErrorFrame
          errorFrame = createErrorFrame(err.code, err.message);

          // Connection-scoped error: clear all pending requests
          // (This is what the runtime would do on fatal error)
          manager.clear();
        }
      }

      // ErrorFrame was created
      expect(errorFrame).not.toBeNull();
      expect(errorFrame!.code).toBe(RpcErrorCode.InvalidEnvelope);

      // All pending requests were rejected (connection closed)
      await expect(promise1).rejects.toThrow("disconnected");
      await expect(promise2).rejects.toThrow("disconnected");
      expect(manager.getPendingCount()).toBe(0);
    });

    it("routable RpcError does NOT clear pending requests", async () => {
      const manager = new RpcCorrelationManager(5000);

      const cid1 = generateFrameId();
      const cid2 = generateFrameId();
      const promise1 = manager.registerRequest(cid1);
      const promise2 = manager.registerRequest(cid2);

      // Valid RpcErrorResponse (routable via cid)
      const validError = createRpcErrorResponse(cid1, 500, "Internal Error");

      // Route to specific request
      manager.matchResponse(cid1, validError);

      // Only the targeted request receives the error
      const result = await promise1;
      expect((result as typeof validError).t).toBe("E");
      expect((result as typeof validError).code).toBe(500);

      // Other request remains pending (transport NOT closed)
      expect(manager.getPendingCount()).toBe(1);

      // Can still complete the other request
      manager.matchResponse(cid2, createRpcSuccessResponse(cid2, "ok"));
      await expect(promise2).resolves.toBeDefined();
    });

    it("partial decode failure with extractable cid routes to request", async () => {
      const manager = new RpcCorrelationManager(5000);

      const cid = generateFrameId();
      const promise = manager.registerRequest(cid);

      // Simulate: envelope parsed but method handler failed
      // This is an RpcError, not an ErrorFrame
      const methodError = createRpcErrorResponse(
        cid,
        RpcErrorCode.UnsupportedMethod,
        "Unknown method: foo.bar",
      );

      manager.matchResponse(cid, methodError);

      // Request receives the error, transport continues
      const result = await promise;
      expect((result as typeof methodError).code).toBe(
        RpcErrorCode.UnsupportedMethod,
      );

      // New requests can still be made
      const cid2 = generateFrameId();
      manager.registerRequest(cid2);
      expect(manager.getPendingCount()).toBe(1);
    });
  });

  /**
   * Verify ErrorFrame factory creates valid frames.
   */
  describe("createErrorFrame helper", () => {
    it("creates ErrorFrame with auto-generated frameId", () => {
      const frame = createErrorFrame(ErrorCode.ProtocolViolation, "Test error");

      expect(frame.kind).toBe(3); // FrameKind.Error
      expect(frame.code).toBe(ErrorCode.ProtocolViolation);
      expect(frame.message).toBe("Test error");
      expect(frame.frameId).toBeDefined();
      expect(frame.frameId.length).toBe(16); // 16 bytes
      expect(frame.details).toBeUndefined();
    });

    it("creates ErrorFrame with details", () => {
      const details = new TextEncoder().encode(
        JSON.stringify({ path: "/api/users" }),
      );
      const frame = createErrorFrame(
        ErrorCode.InvalidFrame,
        "Bad frame",
        details,
      );

      expect(frame.code).toBe(ErrorCode.InvalidFrame);
      expect(frame.details).toEqual(details);
    });

    it("accepts custom frameId via opts", () => {
      const customId = generateFrameId();
      const frame = createErrorFrame(1000, "Error", undefined, {
        frameId: customId,
      });

      expect(frame.frameId).toEqual(customId);
    });

    it("accepts timestamp via opts", () => {
      const now = Date.now();
      const frame = createErrorFrame(2000, "App error", undefined, {
        timestamp: now,
      });

      expect(frame.timestamp).toBe(now);
    });
  });
});
