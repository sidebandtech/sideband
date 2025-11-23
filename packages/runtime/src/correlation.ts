// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RPC Request/Response correlation handler.
 *
 * Manages pending RPC requests and matches incoming responses via `cid` (correlation ID).
 * See ADR-010 for correlation semantics.
 */

import type { FrameId } from "@sideband/protocol";

/**
 * Represents a pending RPC request waiting for a response.
 */
interface PendingRequest {
  /** Promise that resolves when a response is received */
  promise: Promise<unknown>;
  /** Function to resolve the promise when a response arrives */
  resolve: (value: unknown) => void;
  /** Function to reject the promise on error or timeout */
  reject: (reason?: unknown) => void;
  /** Timeout handle for auto-cleanup */
  timeoutHandle: ReturnType<typeof setTimeout>;
}

/**
 * Manages RPC request/response correlation using `cid` (correlation ID).
 *
 * When a request is sent:
 * 1. Create a request with `cid = frameId`
 * 2. Register the pending request: `registerRequest(cid)`
 * 3. Send the request frame
 *
 * When a response arrives:
 * 1. Extract the response envelope
 * 2. Get the `cid` from the response
 * 3. Match it to a pending request: `matchResponse(cid, response)`
 * 4. Promise resolves/rejects with the response
 *
 * Example:
 * ```ts
 * const correlator = new RpcCorrelationManager(30_000); // 30s timeout
 *
 * // Sending a request
 * const requestCid = generateFrameId();
 * const responsePromise = correlator.registerRequest(requestCid);
 *
 * // ... send request frame ...
 *
 * // Receiving a response
 * const responseEnvelope = decodeRpcEnvelope(frame.data);
 * correlator.matchResponse(responseEnvelope.cid, responseEnvelope);
 *
 * // Wait for response
 * try {
 *   const result = await responsePromise;
 *   console.log("Success:", result);
 * } catch (error) {
 *   console.error("RPC failed:", error);
 * }
 * ```
 */
export class RpcCorrelationManager {
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private readonly timeoutMs: number;

  /**
   * Create a new RPC correlation manager.
   *
   * @param timeoutMs Request timeout in milliseconds (default: 30000 = 30s)
   */
  constructor(timeoutMs: number = 30_000) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Register a pending request and return a promise for the response.
   *
   * @param cid The correlation ID (request frame's frameId)
   * @returns Promise that resolves when a matching response is received
   * @throws Error if a request with this cid is already registered
   */
  registerRequest(cid: FrameId): Promise<unknown> {
    const cidHex = this.cidToKey(cid);

    if (this.pendingRequests.has(cidHex)) {
      throw new Error(`Request with cid ${cidHex} already registered`);
    }

    let resolve: (value: unknown) => void;
    let reject: (reason?: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const timeoutHandle = setTimeout(() => {
      this.pendingRequests.delete(cidHex);
      reject(new Error(`RPC request timeout after ${this.timeoutMs}ms`));
    }, this.timeoutMs);

    this.pendingRequests.set(cidHex, {
      promise,
      resolve: resolve!,
      reject: reject!,
      timeoutHandle,
    });

    return promise;
  }

  /**
   * Match an incoming response to a pending request.
   *
   * If a matching request is found:
   * - Clears the timeout
   * - Removes the pending request
   * - Resolves the promise with the response
   *
   * If no matching request is found, throws an error.
   *
   * @param cid The correlation ID from the response envelope
   * @param response The response envelope (or error object)
   * @throws Error if no pending request matches this cid
   */
  matchResponse(cid: FrameId, response: unknown): void {
    const cidHex = this.cidToKey(cid);
    const pending = this.pendingRequests.get(cidHex);

    if (!pending) {
      throw new Error(`No pending request with cid ${cidHex}`);
    }

    clearTimeout(pending.timeoutHandle);
    this.pendingRequests.delete(cidHex);
    pending.resolve(response);
  }

  /**
   * Reject a pending request by cid (e.g., on connection error).
   *
   * @param cid The correlation ID to reject
   * @param reason The rejection reason
   * @throws Error if no pending request matches this cid
   */
  rejectRequest(cid: FrameId, reason: unknown): void {
    const cidHex = this.cidToKey(cid);
    const pending = this.pendingRequests.get(cidHex);

    if (!pending) {
      throw new Error(`No pending request with cid ${cidHex}`);
    }

    clearTimeout(pending.timeoutHandle);
    this.pendingRequests.delete(cidHex);
    pending.reject(reason);
  }

  /**
   * Clean up all pending requests (e.g., on peer disconnect).
   * All pending promises will be rejected with a disconnect error.
   */
  clear(): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error("Peer disconnected"));
    }
    this.pendingRequests.clear();
  }

  /**
   * Get the number of pending requests.
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Convert a FrameId to a string key for the map.
   * Uses the raw binary representation as a string (lossy but works for Map keys).
   */
  private cidToKey(cid: FrameId): string {
    // FrameId is a Uint8Array, we can use it as-is or convert to a string
    // For Map keys, we'll use a string representation to avoid reference issues
    return Buffer.from(cid).toString("hex");
  }
}
