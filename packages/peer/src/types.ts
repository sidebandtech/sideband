// SPDX-License-Identifier: Apache-2.0

import type { Negotiator, RetryPolicy } from "@sideband/runtime";
import type { Transport } from "@sideband/transport";
import type { PeerError } from "./errors.js";

// Re-export for convenience
export type { RetryPolicy } from "@sideband/runtime";

/**
 * Full lifecycle state of a Peer.
 *
 * State machine (see ADR-013 §Phase 2 and docs/sdk/peer.md §6.3):
 *   idle → connecting → negotiating → active
 *   active ↔ paused  (SBRP session pause/resume)
 *   active | paused | connecting | negotiating → reconnecting → connecting → …
 *   any → closed  (terminal; explicit disconnect or fatal error)
 */
export type PeerState =
  | "idle"
  | "connecting"
  | "negotiating"
  | "active"
  | "paused"
  | "reconnecting"
  | "closed";

/** Cleanup function; idempotent. */
export type Unsubscribe = () => void;

/**
 * How the peer handles RPC calls when not in `"active"` state.
 * `"fail"` (default): calls rejected immediately when peer is not active.
 * `"pause"`: unsent calls are buffered from any non-ready state, including
 *   before the first `connect()` (up to `rpcPolicy.disconnectBufferLimitBytes`);
 *   already in-flight calls are still rejected on disconnect.
 */
export interface ConnectionPolicy {
  onDisconnect: "fail" | "pause";
}

/** RPC policy with fully-resolved defaults. */
export interface RpcPolicy {
  /** Per-call timeout used when `RpcCallOptions.timeoutMs` is absent. Default: 10s */
  defaultTimeoutMs: number;
  /**
   * Max bytes of queued (not yet sent) outgoing RPC frames when
   * `connectionPolicy.onDisconnect === "pause"`. Default: 65536 (64 KiB)
   */
  disconnectBufferLimitBytes: number;
}

/** Event policy with fully-resolved defaults. */
export interface EventPolicy {
  /**
   * Max events buffered while disconnected. Oldest are evicted silently on
   * overflow. Default: 128.
   */
  maxBufferedEvents: number;
}

/** Outcome of an in-progress reconnection attempt. */
export type ReconnectionOutcome =
  | { status: "connected" }
  | { status: "aborted" }
  | { status: "failed"; error: Error };

/** Per-call RPC options. */
export interface RpcCallOptions {
  /**
   * Override `rpcPolicy.defaultTimeoutMs` for this call.
   * If the call does not resolve in this time, it rejects with
   * `PeerError{ code: "rpc_timeout" }`.
   */
  timeoutMs?: number;
  /**
   * Aborting this signal rejects the Promise with
   * `PeerError{ code: "rpc_cancelled" }`.
   * The in-flight request is abandoned locally; late responses are ignored.
   */
  signal?: AbortSignal;
}

/**
 * Result of `peer.rpc.tryCall()`.
 * `reconnected: true` means the call completed after a readiness gap — either
 * the peer was still on its first connect, or the call was buffered across a
 * reconnect cycle. It does not distinguish first-connect buffering from
 * post-reconnect flushing.
 */
export type TryCallResult<R> =
  | { ok: true; value: R; reconnected: boolean }
  | { ok: false; error: PeerError; reconnected: boolean };

/**
 * Typed RPC client proxy.
 *
 * T is an interface whose keys are method names (string literals) and values
 * are function types describing params and return type:
 *
 * ```ts
 * interface Api {
 *   "user.get": (params: { id: string }) => User;
 *   "ping": (params: void) => void;
 * }
 * const api = peer.rpc.client<Api>();
 * api["user.get"]({ id: "1" });                    // Promise<User>
 * api["ping"]();                                   // Promise<void>
 * api["ping"](undefined, { timeoutMs: 500 });      // with options
 * ```
 *
 * When params is `void | undefined`, pass `undefined` (or omit) as first arg;
 * options go in the second argument.
 */
/** Extract only keys whose values are function types. */
type MethodKeys<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T];

export type TypedRpcClient<T> = {
  [K in MethodKeys<T> & string]: T[K] extends (...args: infer Args) => infer R
    ? Args["length"] extends 0
      ? (params?: undefined, options?: RpcCallOptions) => Promise<Awaited<R>>
      : [Args[0]] extends [void | undefined]
        ? (params?: undefined, options?: RpcCallOptions) => Promise<Awaited<R>>
        : (params: Args[0], options?: RpcCallOptions) => Promise<Awaited<R>>
    : never;
};

/** Return type of `onPattern()`. Idempotent unsubscribe function. */
export type PatternSubscription = Unsubscribe;

/** The RPC sub-namespace on a Peer. */
export interface RpcInterface {
  /**
   * Make a typed RPC call. Returns a Promise for the response.
   * Rejects with `PeerError` on timeout, cancellation, or remote error.
   */
  call<R = unknown>(
    method: string,
    params?: unknown,
    options?: RpcCallOptions,
  ): Promise<R>;

  /**
   * Like `call()` but never throws. Returns `{ ok, value, reconnected }`.
   * `reconnected` is true if the call was pending during a readiness gap.
   */
  tryCall<R = unknown>(
    method: string,
    params?: unknown,
    options?: RpcCallOptions,
  ): Promise<TryCallResult<R>>;

  /**
   * Register a server-side handler for `method`.
   * Returns `Unsubscribe`. Throws synchronously if method already has a handler.
   * Handler errors are sent back to the caller as RPC error responses.
   *
   * Generics allow typed handlers without `as` casts:
   * ```ts
   * peer.rpc.handle<{ id: string }, User>("user.get", (p) => db.find(p.id));
   * ```
   */
  handle<P = unknown, R = unknown>(
    method: string,
    handler: (params: P) => R | Promise<R>,
  ): Unsubscribe;

  /** Returns a typed proxy that maps method keys to typed call functions. */
  client<T>(): TypedRpcClient<T>;
}

/** The Events sub-namespace on a Peer. */
export interface EventsInterface {
  /**
   * Send a fire-and-forget event. When active, sends immediately. Otherwise,
   * buffers up to `eventPolicy.maxBufferedEvents` events (oldest evicted on
   * overflow) and flushes on next activation. No-op when closed.
   */
  emit(eventName: string, data?: unknown): void;

  /**
   * Subscribe to an exact event name.
   * Returns idempotent `Unsubscribe`.
   */
  on(eventName: string, handler: (data: unknown) => void): Unsubscribe;

  /**
   * Subscribe to events matching a NATS-style pattern (`*`, `>`).
   * Throws `PeerError{ code: "invalid_pattern" }` synchronously on invalid pattern.
   * `**` is rejected — use `>` instead.
   * Returns idempotent `Unsubscribe`.
   */
  onPattern(
    pattern: string,
    handler: (eventName: string, data: unknown) => void,
  ): PatternSubscription;
}

/** Peer lifecycle event map (used with `peer.on()`). */
export interface PeerEvents {
  /** Fires on every state transition. */
  stateChange: { state: PeerState; previous: PeerState };
  /** Fires when entering `"active"` except when resuming from `"paused"` (use `sessionResumed` for that). */
  connected: void;
  /** Fires when leaving `"active"` or `"paused"` toward disconnect/close. */
  disconnected: void;
  /** Fires when entering `"reconnecting"`. */
  reconnecting: void;
  /** Fires when entering `"paused"` (SBRP session pause). */
  sessionPaused: void;
  /** Fires when resuming from `"paused"` to `"active"`. */
  sessionResumed: void;
  /** Fires on fatal or unhandled errors. */
  error: Error;
}

/** Full Peer interface (client-side, created via `createPeer()`). */
export interface Peer {
  /** Current lifecycle state. */
  readonly state: PeerState;
  /** `true` when state is `"active"` or `"paused"`. */
  readonly connected: boolean;
  /** `true` only when state is `"active"` (traffic can flow). */
  readonly ready: boolean;
  /**
   * Promise for the current reconnection cycle.
   * Created on entering `"reconnecting"`, one per cycle.
   * `undefined` when not reconnecting.
   * Calling `disconnect()` resolves it with `{ status: "aborted" }`.
   */
  readonly reconnecting: Promise<ReconnectionOutcome> | undefined;
  /** RPC sub-namespace. */
  readonly rpc: RpcInterface;
  /** Events sub-namespace. */
  readonly events: EventsInterface;

  /**
   * Initiate connection. Returns a Promise that resolves on first `"active"`.
   * No-op if already `"connecting"` or `"negotiating"` (returns a Promise resolving on `"active"`).
   * Throws synchronously from any other state.
   * Fatal errors are both rejected on the Promise AND emitted via `on("error")`.
   */
  connect(): Promise<void>;

  /**
   * Hard close. Idempotent (no-op if already `"closed"`).
   * Resolves `reconnecting` with `{ status: "aborted" }`.
   */
  disconnect(): Promise<void>;

  /**
   * Wait until `state === "active"`.
   * Resolves immediately if already active.
   * Rejects immediately with `peer_closed` if already closed.
   * Stays pending during `"paused"` — readiness requires active traffic flow.
   * Abortable via `options.signal`.
   */
  whenReady(options?: { signal?: AbortSignal }): Promise<void>;

  /** Subscribe to a peer lifecycle event. */
  on<K extends keyof PeerEvents>(
    event: K,
    handler: (data: PeerEvents[K]) => void,
  ): Unsubscribe;

  /** Alias for `disconnect()`. Enables `using peer = createPeer(...)`. */
  [Symbol.dispose](): void;
  /** Async alias for `disconnect()`. Enables `await using peer = createPeer(...)`. */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Server-accepted peer. A subset of `Peer` with narrower state and no
 * `connect()` / `reconnecting` (the server handled connection before hand-off).
 *
 * `disconnect()` is always a hard close, even when state is `"paused"`.
 */
export interface AcceptedPeer {
  readonly state: "active" | "paused" | "closed";
  readonly connected: boolean;
  readonly ready: boolean;
  /** Remote peer ID (stringified PeerId) — matches the key in `PeerServer.connections`. */
  readonly peerId: string;
  readonly rpc: RpcInterface;
  readonly events: EventsInterface;
  disconnect(): Promise<void>;
  whenReady(options?: { signal?: AbortSignal }): Promise<void>;
  on<K extends keyof PeerEvents>(
    event: K,
    handler: (data: PeerEvents[K]) => void,
  ): Unsubscribe;
  [Symbol.dispose](): void;
  [Symbol.asyncDispose](): Promise<void>;
}

/** Options for `createPeer()`. */
export interface PeerOptions {
  /**
   * WebSocket endpoint, e.g. `"ws://localhost:8080"`.
   * Optional when `negotiator.getConnectionParams()` provides a fresh
   * endpoint on each connect attempt (e.g. for time-limited relay tokens).
   * A runtime error is thrown if neither source provides an endpoint.
   */
  endpoint?: string;
  /**
   * Session negotiator. Defaults to `sbpNegotiator()` (plain SBP handshake).
   * Pass `sbrpClientNegotiator(...)` for E2EE relay mode.
   */
  negotiator?: Negotiator;
  /**
   * Transport factory. Defaults to `wsTransport()` (auto-detects platform).
   * Override for testing or non-WebSocket transports.
   */
  transport?: Transport;
  /** Local peer ID. Auto-generated if omitted. */
  peerId?: string;
  connectionPolicy?: Partial<ConnectionPolicy>;
  rpcPolicy?: Partial<RpcPolicy>;
  eventPolicy?: Partial<EventPolicy>;
  retryPolicy?: Partial<RetryPolicy>;
  /**
   * Handler for errors that have no other delivery path (e.g. event-handler
   * throws). Defaults to no-op — opt in to logging explicitly.
   */
  onUnhandledError?: (error: Error) => void;
}

/** Fully-resolved internal options (defaults applied). */
export interface ResolvedPeerOptions {
  endpoint?: string;
  negotiator: Negotiator;
  transport: Transport;
  peerId: string;
  connectionPolicy: ConnectionPolicy;
  rpcPolicy: RpcPolicy;
  eventPolicy: EventPolicy;
  retryPolicy: RetryPolicy;
  onUnhandledError: (error: Error) => void;
}

/** `PeerServer` returned by `listen()`. */
export interface PeerServer {
  /** The address the server is listening on. */
  readonly address: string;
  /** All currently-connected accepted peers, keyed by their remote PeerId. */
  readonly connections: ReadonlyMap<string, AcceptedPeer>;
  /**
   * Hard shutdown. Immediately transitions all `AcceptedPeer` instances to
   * `"closed"`, severs transports. Idempotent.
   */
  close(): Promise<void>;
}

/** Options for `listen()`. */
export interface ListenOptions {
  /**
   * Endpoint to listen on, e.g. `"ws://0.0.0.0:8080"`.
   * Optional when `transport` handles its own connection (e.g. relay daemons
   * that connect outbound — no local port is bound).
   */
  endpoint?: string;
  /**
   * Called for each accepted connection. The `peer` argument is always in
   * `"active"` state at the point of the callback.
   */
  onConnection: (peer: AcceptedPeer) => void | Promise<void>;
  /**
   * Session negotiator. Defaults to `sbpNegotiator()`.
   * Pass `sbrpDaemonNegotiator(...)` for E2EE relay mode.
   */
  negotiator?: Negotiator;
  /**
   * Transport factory. Defaults to `nodeWsTransport()` (server-side Node.js/Bun WebSocket).
   */
  transport?: Transport;
  /** Local (server) peer ID. Auto-generated if omitted. */
  peerId?: string;
  rpcPolicy?: Partial<RpcPolicy>;
  eventPolicy?: Partial<EventPolicy>;
  onUnhandledError?: (error: Error) => void;
}

/** Fully-resolved listen options. */
export interface ResolvedListenOptions {
  peerId: string;
  negotiator: Negotiator;
  rpcPolicy: RpcPolicy;
  eventPolicy: EventPolicy;
  onUnhandledError: (error: Error) => void;
}
