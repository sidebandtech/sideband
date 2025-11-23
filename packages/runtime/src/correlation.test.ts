// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from "bun:test";
import { generateFrameId } from "@sideband/protocol";
import {
  createRpcRequest,
  createRpcSuccessResponse,
  createRpcErrorResponse,
} from "@sideband/rpc";
import { RpcCorrelationManager } from "./correlation";

describe("RpcCorrelationManager", () => {
  let manager: RpcCorrelationManager;

  beforeEach(() => {
    manager = new RpcCorrelationManager(1000); // 1s timeout for tests
  });

  it("should register a request and match a success response", async () => {
    const cid = generateFrameId();
    const request = createRpcRequest("user.get", cid, { id: 123 });

    // Verify request has cid
    expect(request.cid).toBe(cid);

    // Register the request
    const responsePromise = manager.registerRequest(cid);

    // Create a response with the same cid
    const response = createRpcSuccessResponse(cid, { name: "John" });

    // Match the response
    manager.matchResponse(cid, response);

    // Wait for the promise
    const result = await responsePromise;
    expect(result).toEqual(response);
  });

  it("should handle error responses", async () => {
    const cid = generateFrameId();
    const responsePromise = manager.registerRequest(cid);

    const errorResponse = createRpcErrorResponse(cid, 404, "User not found");

    manager.matchResponse(cid, errorResponse);

    const result = await responsePromise;
    expect(result).toEqual(errorResponse);
  });

  it("should reject requests on timeout", async () => {
    const testManager = new RpcCorrelationManager(50); // 50ms timeout for faster test
    const cid = generateFrameId();
    const responsePromise = testManager.registerRequest(cid);

    // Attach a handler immediately to prevent unhandled rejection detection
    responsePromise.catch(() => {});

    // Wait past the timeout
    await new Promise((resolve) => setTimeout(resolve, 100));

    let error: unknown = null;
    try {
      await responsePromise;
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("timeout");
  });

  it("should handle multiple concurrent requests", async () => {
    const cid1 = generateFrameId();
    const cid2 = generateFrameId();
    const cid3 = generateFrameId();

    const promise1 = manager.registerRequest(cid1);
    const promise2 = manager.registerRequest(cid2);
    const promise3 = manager.registerRequest(cid3);

    expect(manager.getPendingCount()).toBe(3);

    // Respond to some in different order
    manager.matchResponse(cid2, { t: "R", cid: cid2, result: "two" });
    manager.matchResponse(cid1, { t: "R", cid: cid1, result: "one" });

    expect(await promise1).toEqual({ t: "R", cid: cid1, result: "one" });
    expect(await promise2).toEqual({ t: "R", cid: cid2, result: "two" });

    expect(manager.getPendingCount()).toBe(1);

    // Respond to the last one
    manager.matchResponse(cid3, { t: "R", cid: cid3, result: "three" });
    expect(await promise3).toEqual({ t: "R", cid: cid3, result: "three" });

    expect(manager.getPendingCount()).toBe(0);
  });

  it("should reject all pending requests on clear()", async () => {
    const cid1 = generateFrameId();
    const cid2 = generateFrameId();

    const promise1 = manager.registerRequest(cid1);
    const promise2 = manager.registerRequest(cid2);

    manager.clear();

    try {
      await promise1;
      throw new Error("Should have been rejected");
    } catch (err) {
      expect((err as Error).message).toContain("disconnected");
    }

    try {
      await promise2;
      throw new Error("Should have been rejected");
    } catch (err) {
      expect((err as Error).message).toContain("disconnected");
    }
  });

  it("should reject request manually", async () => {
    const cid = generateFrameId();
    const responsePromise = manager.registerRequest(cid);

    const reason = new Error("Connection lost");
    manager.rejectRequest(cid, reason);

    try {
      await responsePromise;
      throw new Error("Should have been rejected");
    } catch (err) {
      expect(err).toBe(reason);
    }
  });

  it("should throw when registering duplicate cid", () => {
    const cid = generateFrameId();
    manager.registerRequest(cid);

    expect(() => {
      manager.registerRequest(cid);
    }).toThrow("already registered");
  });

  it("should throw when matching unknown cid", () => {
    const cid = generateFrameId();
    expect(() => {
      manager.matchResponse(cid, { result: "test" });
    }).toThrow("No pending request");
  });
});
