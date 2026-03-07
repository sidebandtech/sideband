// SPDX-License-Identifier: Apache-2.0

/**
 * Bidirectional RPC implementation.
 *
 * Handles:
 *   - Outgoing calls: creates RpcRequest frames, tracks correlation, handles
 *     timeouts and AbortSignal cancellation.
 *   - Incoming requests: dispatches to registered handlers and sends responses.
 *   - Buffer management: queues calls when `onDisconnect: "pause"` and peer is
 *     temporarily unavailable.
 */

import {
  createMessageFrame,
  encodeFrame,
  frameIdToHex,
  generateFrameId,
  type MessageFrame,
} from "@sideband/protocol";
import {
  createRpcErrorResponse,
  createRpcRequest,
  createRpcSuccessResponse,
  decodeRpcEnvelope,
  encodeRpcEnvelope,
  isRpcErrorResponse,
  isRpcRequest,
  isRpcResponse,
  RpcErrorCode,
  type RpcEnvelope,
  type RpcSuccessResponse,
} from "@sideband/rpc";
import { PeerError, PeerErrorCode, RpcPeerError } from "./errors.js";
import type {
  PeerState,
  RpcCallOptions,
  RpcInterface,
  RpcPolicy,
  TryCallResult,
  TypedRpcClient,
  Unsubscribe,
} from "./types.js";

/** Minimal interface the RPC node needs from the hosting peer. */
export interface RpcHost {
  readonly state: PeerState;
  readonly connectionPolicy: { onDisconnect: "fail" | "pause" };
  readonly rpcPolicy: RpcPolicy;
  sendRaw(data: Uint8Array): Promise<void>;
  onUnhandledError(err: Error): void;
}

interface PendingCall {
  resolve(response: RpcEnvelope): void;
  reject(err: Error): void;
  timer?: ReturnType<typeof setTimeout>;
}

interface QueuedCall {
  method: string;
  params: unknown;
  options: RpcCallOptions | undefined;
  resolve(value: unknown): void;
  reject(err: Error): void;
  byteSize: number;
  onAbort?: () => void; // AbortSignal listener attached while queued
}

// Protocol-defined channel subjects — not user-configurable.
export const RPC_SUBJECT = "rpc";

// Handler execution errors use code 2000 (application-layer range, above the
// 1100–1199 RPC protocol codes). Hidden from callers behind PeerErrorCode.RpcError.
const HANDLER_ERROR_CODE = 2000;

/** RPC implementation shared by PeerImpl and ConnectedPeerImpl. */
export class RpcImpl implements RpcInterface {
  // Outgoing calls waiting for a response, keyed by cid hex
  private pending = new Map<string, PendingCall>();
  // Server-side handlers, keyed by method name
  private handlers = new Map<string, (params: unknown) => unknown>();
  // Buffered calls (onDisconnect: "pause")
  private queue: QueuedCall[] = [];
  private queuedBytes = 0;
  // Cached proxy — same object every call so referential equality holds
  private _proxy?: TypedRpcClient<unknown>;

  constructor(private readonly host: RpcHost) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Public RpcInterface

  call<R = unknown>(
    method: string,
    params?: unknown,
    options?: RpcCallOptions,
  ): Promise<R> {
    return this.doCall(method, params, options) as Promise<R>;
  }

  async tryCall<R = unknown>(
    method: string,
    params?: unknown,
    options?: RpcCallOptions,
  ): Promise<TryCallResult<R>> {
    // Record whether peer was ready when the call started so we can report
    // whether the call was buffered and completed after a reconnect.
    const startedReady = this.host.state === "active";
    try {
      const value = await this.doCall(method, params, options);
      // If the call started while not ready but succeeded, it must have
      // survived a reconnect — no need to check current state afterward.
      return { ok: true, value: value as R, reconnected: !startedReady };
    } catch (err) {
      const error =
        err instanceof PeerError
          ? err
          : new PeerError(
              PeerErrorCode.RpcError,
              err instanceof Error ? err.message : String(err),
            );
      // A failed call never "reconnected" — it didn't complete successfully.
      return { ok: false, error, reconnected: false };
    }
  }

  handle<P = unknown, R = unknown>(
    method: string,
    handler: (params: P) => R | Promise<R>,
  ): Unsubscribe {
    if (this.handlers.has(method)) {
      throw new RpcPeerError(
        PeerErrorCode.RpcMethodAlreadyRegistered,
        `RPC method "${method}" already has a registered handler`,
      );
    }
    // Cast to the internal untyped signature; type safety is guaranteed at the
    // call site via the generic signature.
    const fn = handler as (params: unknown) => unknown;
    this.handlers.set(method, fn);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      // Guard against accidentally removing a replacement handler registered
      // after this unsubscribe token was issued.
      if (this.handlers.get(method) === fn) {
        this.handlers.delete(method);
      }
    };
  }

  listMethods(): string[] {
    return Array.from(this.handlers.keys()).sort();
  }

  client<T>(): TypedRpcClient<T> {
    if (!this._proxy) {
      // Arrow so `this` refers to RpcImpl; Proxy calls the trap with `this` = handler object.
      this._proxy = new Proxy(Object.create(null), {
        get: (_target, prop) => {
          // Exclude Symbol keys, Promise inspection props (prevents thenable
          // duck-typing when the proxy is awaited or returned from async fns),
          // and Object.prototype methods (prevents spurious RPC calls from
          // implicit coercions, console.log introspection, JSON.stringify, etc.).
          if (
            typeof prop !== "string" ||
            prop === "then" ||
            prop === "catch" ||
            prop === "finally"
          ) {
            return undefined;
          }
          // Delegate standard Object methods (toString, valueOf, etc.) to
          // their native implementations so console.log / string coercion /
          // DevTools work correctly instead of throwing TypeError.
          if (prop in Object.prototype) {
            return Reflect.get(Object.prototype, prop);
          }
          return (params?: unknown, options?: RpcCallOptions) =>
            this.call(prop, params, options);
        },
      });
    }
    return this._proxy as TypedRpcClient<T>;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Called by PeerImpl on lifecycle transitions

  /** Flush buffered calls now that the peer is active. */
  flushQueue(): void {
    const calls = this.queue.splice(0);
    this.queuedBytes = 0;
    for (const queued of calls) {
      // Remove the queued-abort listener before sending.
      if (queued.onAbort) {
        queued.options?.signal?.removeEventListener("abort", queued.onAbort);
      }
      this.doSendCall(queued.method, queued.params, queued.options)
        .then(queued.resolve)
        .catch(queued.reject);
    }
  }

  /** Handle peer disconnection: reject pending/queued calls per policy. */
  onDisconnect(fatal: boolean): void {
    // Non-fatal drops are transient (may reconnect) → NotConnected.
    // Fatal drops are terminal → PeerClosed.
    const err = fatal
      ? new PeerError(PeerErrorCode.PeerClosed, "Peer closed")
      : new PeerError(PeerErrorCode.NotConnected, "Peer disconnected");

    // Always reject pending calls (already sent, can't be delivered)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();

    // For buffered calls: reject on fatal or "fail" policy; keep on "pause"
    if (fatal || this.host.connectionPolicy.onDisconnect === "fail") {
      for (const queued of this.queue) {
        if (queued.onAbort) {
          queued.options?.signal?.removeEventListener("abort", queued.onAbort);
        }
        queued.reject(err);
      }
      this.queue = [];
      this.queuedBytes = 0;
    }
  }

  /** Reject everything on terminal close. */
  onClosed(): void {
    const err = new PeerError(PeerErrorCode.PeerClosed, "Peer is closed");
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
    for (const queued of this.queue) {
      if (queued.onAbort) {
        queued.options?.signal?.removeEventListener("abort", queued.onAbort);
      }
      queued.reject(err);
    }
    this.queue = [];
    this.queuedBytes = 0;
  }

  /** Dispatch an inbound message frame. Called by the peer's frame processor. */
  async handleFrame(
    frame: MessageFrame,
    sendFn: (data: Uint8Array) => Promise<void>,
  ): Promise<void> {
    let envelope;
    try {
      envelope = decodeRpcEnvelope(frame.data);
    } catch (err) {
      this.host.onUnhandledError(
        err instanceof Error ? err : new Error(String(err)),
      );
      return;
    }

    if (isRpcResponse(envelope)) {
      // Match to pending outgoing call
      const key = frameIdToHex(envelope.cid);
      const pending = this.pending.get(key);
      if (!pending) return; // stale / already timed-out response

      clearTimeout(pending.timer);
      this.pending.delete(key);
      pending.resolve(envelope);
      return;
    }

    if (isRpcRequest(envelope)) {
      const handler = this.handlers.get(envelope.m);

      if (!handler) {
        const errEnv = createRpcErrorResponse(
          envelope.cid,
          RpcErrorCode.UnsupportedMethod,
          `Method not found: ${envelope.m}`,
        );
        await sendFn(
          encodeFrame(
            createMessageFrame(RPC_SUBJECT, encodeRpcEnvelope(errEnv)),
          ),
        ).catch(this.suppressDisconnect);
        return;
      }

      try {
        const result = await handler(envelope.p);
        const resEnv = createRpcSuccessResponse(envelope.cid, result);
        await sendFn(
          encodeFrame(
            createMessageFrame(RPC_SUBJECT, encodeRpcEnvelope(resEnv)),
          ),
        ).catch(this.suppressDisconnect);
      } catch (err) {
        // Handler errors are delivered to the caller as RPC error responses —
        // they have a delivery path and must not be forwarded to onUnhandledError.
        const msg = err instanceof Error ? err.message : String(err);
        const errEnv = createRpcErrorResponse(
          envelope.cid,
          HANDLER_ERROR_CODE,
          msg,
        );
        await sendFn(
          encodeFrame(
            createMessageFrame(RPC_SUBJECT, encodeRpcEnvelope(errEnv)),
          ),
        ).catch(this.suppressDisconnect);
      }
      return;
    }

    // Notifications on the rpc channel are unexpected — drop silently
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private

  // Suppress expected disconnect errors on RPC response sends (race between
  // response send and connection drop). Forward unexpected errors to the host
  // so real bugs aren't silently swallowed — mirrors EventsImpl.sendEvent().
  private readonly suppressDisconnect = (err: unknown): void => {
    if (
      err instanceof PeerError &&
      (err.code === PeerErrorCode.NotConnected ||
        err.code === PeerErrorCode.PeerClosed ||
        err.code === PeerErrorCode.SessionPaused)
    ) {
      return;
    }
    this.host.onUnhandledError(
      err instanceof Error ? err : new Error(String(err)),
    );
  };

  private doCall(
    method: string,
    params: unknown,
    options: RpcCallOptions | undefined,
  ): Promise<unknown> {
    const state = this.host.state;

    if (state === "closed") {
      return Promise.reject(
        new PeerError(PeerErrorCode.PeerClosed, "Peer is closed"),
      );
    }

    if (options?.signal?.aborted) {
      return Promise.reject(
        new RpcPeerError(PeerErrorCode.RpcCancelled, "Aborted"),
      );
    }

    if (state === "active") {
      return this.doSendCall(method, params, options);
    }

    // Not ready — apply disconnect policy
    if (this.host.connectionPolicy.onDisconnect === "fail") {
      // Mirror sendRaw: distinguish a paused relay from a missing connection so
      // callers can react to rate-limiting vs. a dropped socket differently.
      if (state === "paused") {
        return Promise.reject(
          new PeerError(PeerErrorCode.SessionPaused, "Session is paused"),
        );
      }
      return Promise.reject(
        new PeerError(PeerErrorCode.NotConnected, "Peer not connected"),
      );
    }

    // "pause" — buffer the call
    const estimatedBytes = estimateCallBytes(method, params);
    if (
      this.queuedBytes + estimatedBytes >
      this.host.rpcPolicy.disconnectBufferLimitBytes
    ) {
      return Promise.reject(
        new PeerError(PeerErrorCode.BufferOverflow, "RPC buffer overflow"),
      );
    }

    return new Promise<unknown>((resolve, reject) => {
      this.queuedBytes += estimatedBytes;
      const queued: QueuedCall = {
        method,
        params,
        options,
        resolve,
        reject,
        byteSize: estimatedBytes,
      };
      this.queue.push(queued);

      // Abort while queued: remove from queue and reject immediately.
      if (options?.signal) {
        const onAbort = () => {
          const idx = this.queue.indexOf(queued);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            this.queuedBytes -= queued.byteSize;
            reject(
              new RpcPeerError(PeerErrorCode.RpcCancelled, "Request cancelled"),
            );
          }
        };
        queued.onAbort = onAbort;
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  private async doSendCall(
    method: string,
    params: unknown,
    options: RpcCallOptions | undefined,
  ): Promise<unknown> {
    const frameId = generateFrameId();
    const cidKey = frameIdToHex(frameId);
    const timeoutMs =
      options?.timeoutMs ?? this.host.rpcPolicy.defaultTimeoutMs;

    // onAbort is stored outside the Promise constructor so it can be removed
    // when the call resolves or times out (prevents listener accumulation on
    // long-lived AbortSignals used across many calls).
    let timer!: ReturnType<typeof setTimeout>;
    let onAbort: (() => void) | undefined;

    const responsePromise = new Promise<RpcEnvelope>((resolve, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(cidKey);
        if (onAbort) options!.signal!.removeEventListener("abort", onAbort);
        reject(
          new RpcPeerError(
            PeerErrorCode.RpcTimeout,
            `RPC timeout after ${timeoutMs}ms (method: ${method})`,
          ),
        );
      }, timeoutMs);

      if (options?.signal) {
        onAbort = () => {
          clearTimeout(timer);
          if (this.pending.delete(cidKey)) {
            reject(
              new RpcPeerError(PeerErrorCode.RpcCancelled, "Request cancelled"),
            );
          }
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      this.pending.set(cidKey, { resolve, reject, timer });
    });

    // Guard against unhandled rejection crashes: if the timeout or AbortSignal
    // fires while execution is paused at `await sendRaw` below, responsePromise
    // would be rejected without an active `.catch()`. Attaching a no-op catch
    // flags it as handled; the `await responsePromise` below still propagates
    // the rejection correctly.
    responsePromise.catch(() => {});

    // Build and send frame. On failure (encoding or transport), reject the
    // pending promise so all error paths funnel through `await responsePromise`.
    try {
      const envelope = createRpcRequest(
        method,
        frameId,
        params !== undefined ? params : undefined,
      );
      const data = encodeRpcEnvelope(envelope);
      const frame = createMessageFrame(RPC_SUBJECT, data, { frameId });
      await this.host.sendRaw(encodeFrame(frame));
    } catch (err) {
      const pending = this.pending.get(cidKey);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(cidKey);
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      }
      // If pending was already resolved/rejected (timeout/abort race), the
      // error is moot — responsePromise already carries the timeout/abort.
    }

    // Single exit path: all outcomes (success, timeout, abort, encoding error,
    // transport error) flow through responsePromise.
    try {
      const response = await responsePromise;
      if (isRpcErrorResponse(response)) {
        throw new RpcPeerError(PeerErrorCode.RpcError, response.message, {
          details: { wireCode: response.code, data: response.data },
        });
      }
      return (response as RpcSuccessResponse).result;
    } finally {
      if (onAbort) options!.signal!.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * Rough byte estimate for buffer accounting. Intentionally approximate —
 * designed to prevent unbounded buffering, not to precisely measure wire size.
 */
function estimateCallBytes(method: string, params: unknown): number {
  try {
    const s = JSON.stringify(params);
    // JSON.stringify(undefined) returns undefined (not a string) — treat as 0.
    return method.length + (s ? s.length : 0) + 64;
  } catch {
    return method.length + 128;
  }
}
