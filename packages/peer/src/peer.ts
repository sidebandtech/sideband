// SPDX-License-Identifier: Apache-2.0

/**
 * createPeer — high-level Peer with full lifecycle management.
 *
 * Architecture:
 *   - One SessionManager per connection attempt (mode: "never", so it never
 *     retries on its own). When the session closes, PeerImpl decides whether
 *     to reconnect based on its own retry policy.
 *   - State machine maps onto SessionManager events plus peer-level decisions.
 *   - Reconnect loop runs with exponential back-off via calculateBackoff().
 *   - RpcImpl and EventsImpl are long-lived; they survive reconnects.
 *     Subscriptions are never re-registered (they live in-process). Buffered
 *     outbound events / RPC calls are flushed on entering "active".
 *
 * See docs/sdk/peer.md and ADR-013.
 */

import {
  asPeerId,
  FrameKind,
  type Frame,
  type MessageFrame,
} from "@sideband/protocol";
import {
  calculateBackoff,
  createSessionManager,
  defaultRetryPolicy,
  SbpNegotiator,
  type Session,
  type SessionManager,
} from "@sideband/runtime";
import { unsafeAsTransportEndpoint } from "@sideband/transport";
import { wsTransport } from "@sideband/transport-ws";
import { PeerError, PeerErrorCode } from "./errors.js";
import { EVENT_SUBJECT, EventsImpl, type EventHost } from "./events.js";
import { generateId } from "./id.js";
import { RPC_SUBJECT, RpcImpl, type RpcHost } from "./rpc.js";
import type {
  ConnectionPolicy,
  Peer,
  PeerEvents,
  PeerOptions,
  PeerState,
  ReconnectionOutcome,
  ResolvedPeerOptions,
  Unsubscribe,
} from "./types.js";

const DEFAULT_RPC_POLICY = {
  defaultTimeoutMs: 10_000,
  disconnectBufferLimitBytes: 65_536,
} as const;

const DEFAULT_EVENT_POLICY = {
  maxBufferedEvents: 128,
} as const;

const DEFAULT_CONNECTION_POLICY: ConnectionPolicy = {
  onDisconnect: "fail",
};

/** Create a client-side peer. */
export function createPeer(options: PeerOptions): Peer {
  const resolved = resolveOptions(options);
  return new PeerImpl(resolved);
}

/** Factory for the plain SBP negotiator (direct local connection). */
export function sbpNegotiator(opts?: {
  peerId?: string;
  capabilities?: string[];
  handshakeTimeoutMs?: number;
}) {
  return new SbpNegotiator({
    peerId: asPeerId(opts?.peerId ?? generateId()),
    capabilities: opts?.capabilities,
    handshakeTimeoutMs: opts?.handshakeTimeoutMs,
  });
}

// ────────────────────────────────────────────────────────────────────────────

class PeerImpl implements Peer, RpcHost, EventHost {
  private _state: PeerState = "idle";

  // Current connection artefacts — null between sessions
  private sessionMgr?: SessionManager;
  private currentSession?: Session;

  // connect() Promise state
  private connectPromise?: Promise<void>;
  private connectResolve?: () => void;
  private connectReject?: (e: Error) => void;

  // reconnecting Promise state (one per cycle)
  private reconnectDeferred?: Deferred<ReconnectionOutcome>;

  // Retry state
  private retryAttempt = 0;
  private retryCancel?: () => void; // cancels the current sleep
  private terminated = false;

  // Lifecycle event subscribers
  private readonly eventSubs = new Map<
    keyof PeerEvents,
    Set<(data: unknown) => void>
  >();

  readonly rpc: RpcImpl;
  readonly events: EventsImpl;

  constructor(private readonly opts: ResolvedPeerOptions) {
    this.rpc = new RpcImpl(this);
    this.events = new EventsImpl(this);
  }

  // ────────────────── Peer interface ──────────────────────────────────────

  get state(): PeerState {
    return this._state;
  }

  get connected(): boolean {
    return this._state === "active" || this._state === "paused";
  }

  get ready(): boolean {
    return this._state === "active";
  }

  get reconnecting(): Promise<ReconnectionOutcome> | undefined {
    return this.reconnectDeferred?.promise;
  }

  connect(): Promise<void> {
    const s = this._state;
    if (s === "connecting" || s === "negotiating") {
      return this.connectPromise!;
    }
    if (s === "closed") {
      throw new PeerError(PeerErrorCode.PeerClosed, "Peer is closed");
    }
    if (s !== "idle") {
      throw new PeerError(
        PeerErrorCode.InvalidState,
        `Cannot connect from state "${s}"`,
      );
    }

    // Synchronous transition prevents a second concurrent connect() call from
    // seeing "idle" and launching a second runLoop before the first one starts.
    this.transition("connecting");

    this.connectPromise = new Promise<void>((res, rej) => {
      this.connectResolve = res;
      this.connectReject = rej;
    });

    this.runLoop().catch(() => {});
    return this.connectPromise;
  }

  async disconnect(): Promise<void> {
    if (this._state === "closed") return;
    this.terminated = true;

    // Cancel any pending retry sleep
    this.retryCancel?.();

    // Synchronously close: prevents new calls from being accepted and lets
    // callers that await pending work see rejection immediately rather than
    // after the transport teardown completes.
    this.transition("closed");
    this.rpc.onClosed();
    this.events.onClosed();

    // Resolve/reject in-progress promises
    this.reconnectDeferred?.resolve({ status: "aborted" });
    this.reconnectDeferred = undefined;

    if (this.connectReject) {
      this.connectReject(
        new PeerError(PeerErrorCode.PeerClosed, "Disconnected"),
      );
      this.connectResolve = undefined;
      this.connectReject = undefined;
    }

    // Terminate active session transport (best-effort cleanup)
    if (this.sessionMgr) {
      await this.sessionMgr.terminate({ reason: "disconnect" }).catch(() => {});
    }
  }

  whenReady(options?: { signal?: AbortSignal }): Promise<void> {
    if (options?.signal?.aborted) {
      return Promise.reject(
        new PeerError(PeerErrorCode.Cancelled, "whenReady aborted"),
      );
    }
    if (this._state === "active") return Promise.resolve();
    if (this._state === "closed") {
      return Promise.reject(
        new PeerError(PeerErrorCode.PeerClosed, "Peer is closed"),
      );
    }
    return new Promise<void>((resolve, reject) => {
      let unsubState: Unsubscribe;

      const cleanup = () => {
        unsubState();
        options?.signal?.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        cleanup();
        reject(new PeerError(PeerErrorCode.Cancelled, "whenReady aborted"));
      };

      unsubState = this.on("stateChange", ({ state }) => {
        if (state === "active") {
          cleanup();
          resolve();
        } else if (state === "closed") {
          cleanup();
          reject(new PeerError(PeerErrorCode.PeerClosed, "Peer closed"));
        }
      });

      options?.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  on<K extends keyof PeerEvents>(
    event: K,
    handler: (data: PeerEvents[K]) => void,
  ): Unsubscribe {
    let subs = this.eventSubs.get(event);
    if (!subs) {
      subs = new Set();
      this.eventSubs.set(event, subs);
    }
    const fn = handler as (data: unknown) => void;
    subs.add(fn);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      subs!.delete(fn);
    };
  }

  [Symbol.dispose](): void {
    this.disconnect().catch(() => {});
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }

  // ────────────────── RpcHost / EventHost ─────────────────────────────────

  get connectionPolicy() {
    return this.opts.connectionPolicy;
  }
  get rpcPolicy() {
    return this.opts.rpcPolicy;
  }
  get eventPolicy() {
    return this.opts.eventPolicy;
  }

  async sendRaw(data: Uint8Array): Promise<void> {
    if (!this.currentSession) {
      throw new PeerError(PeerErrorCode.NotConnected, "Not connected");
    }
    try {
      await this.currentSession.sendRaw(data);
    } catch (err) {
      // Normalize raw transport errors so all SDK errors are PeerError instances.
      if (err instanceof PeerError) throw err;
      throw new PeerError(
        PeerErrorCode.NotConnected,
        err instanceof Error ? err.message : String(err),
        { cause: err },
      );
    }
  }

  onUnhandledError(err: Error): void {
    this.opts.onUnhandledError(err);
  }

  // ────────────────── Connection loop ─────────────────────────────────────

  private async runLoop(): Promise<void> {
    while (!this.terminated) {
      // Deferred for "this session closed"
      const closedDeferred = deferred<{
        reason: string;
        graceful: boolean;
        fatal: boolean;
      }>();

      const mgr = createSessionManager({
        endpoint: this.opts.endpoint,
        transportFactory: (ep) =>
          this.opts.transport.connect(unsafeAsTransportEndpoint(ep)),
        negotiator: this.opts.negotiator,
        retryPolicy: { mode: "never" },
        onFrame: (frame) => {
          this.dispatchFrame(frame);
        },
      });

      // "connecting" fires from mgr during initial connect and reconnects.
      // For the initial connect, transition() is already "connecting" (set
      // synchronously in connect()), so this is a no-op on the first attempt.
      mgr.on("connecting", () => this.transition("connecting"));
      mgr.on("negotiating", () => this.transition("negotiating"));
      mgr.on("closed", (evt) => closedDeferred.resolve(evt));

      this.sessionMgr = mgr;

      let connectErr: Error | undefined;
      let session: Session | undefined;

      try {
        session = await mgr.connect();
      } catch (err) {
        connectErr = err instanceof Error ? err : new Error(String(err));
      }

      if (connectErr) {
        // By contract, "closed" fires before connect() throws — closedDeferred is
        // already resolved. Resolve defensively to prevent an infinite hang if
        // that invariant is ever broken by a runtime regression.
        closedDeferred.resolve({
          reason: connectErr.message,
          graceful: false,
          fatal: true,
        });
        const closeEvt = await closedDeferred.promise;

        if (this.terminated) {
          // disconnect() already handled state transitions
          return;
        }

        const fatal = closeEvt.fatal;
        if (fatal || !this.canRetry()) {
          this.transition("closed");
          this.rpc.onClosed();
          this.events.onClosed();
          // Always wrap as PeerError so callers can rely on `instanceof PeerError`
          // regardless of whether the failure was fatal or retries-exhausted.
          const err = new PeerError(
            PeerErrorCode.PeerClosed,
            connectErr.message,
            {
              cause: connectErr,
            },
          );
          // Resolve any in-progress reconnect promise — callers awaiting
          // peer.reconnecting must not hang when retry finally gives up.
          this.reconnectDeferred?.resolve({ status: "failed", error: err });
          this.reconnectDeferred = undefined;
          this.connectReject?.(err);
          this.connectPromise = undefined;
          this.connectResolve = undefined;
          this.connectReject = undefined;
          // Emit "error" for all terminal initial-connect failures (both fatal
          // and retries-exhausted). Post-active exhaustion signals via
          // reconnecting.promise only; initial connect has no such equivalent.
          this.emit("error", err);
          return;
        }
        // Retryable — fall through to retry scheduling
      } else {
        // Disconnect may race with mgr.connect() resolving — if terminated,
        // sessionMgr.terminate() handles transport cleanup; bail out here.
        if (this.terminated) return;

        // Successfully connected!
        this.currentSession = session!;
        this.retryAttempt = 0; // reset backoff after a successful connection
        this.transition("active");

        // Resolve initial connect() promise (idempotent if already resolved)
        if (this.connectResolve) {
          this.connectResolve();
          this.connectPromise = undefined;
          this.connectResolve = undefined;
          this.connectReject = undefined;
        }

        // Resolve reconnecting promise from previous cycle
        this.reconnectDeferred?.resolve({ status: "connected" });
        this.reconnectDeferred = undefined;

        // Flush buffered RPC calls and events
        this.rpc.flushQueue();
        this.events.flushBuffer();

        // Wait for this session to close (transport drop or terminate)
        const closeEvt = await closedDeferred.promise;

        this.currentSession = undefined;

        if (this.terminated) {
          // disconnect() already handled state transitions
          return;
        }

        this.rpc.onDisconnect(closeEvt.fatal);

        if (closeEvt.fatal || !this.canRetry()) {
          this.transition("closed");
          this.rpc.onClosed();
          this.events.onClosed();
          // Emit error on fatal close so apps can observe the cause. Retries-
          // exhausted is already signaled via the reconnecting promise; no
          // additional error event needed for that case.
          if (closeEvt.fatal) {
            this.emit(
              "error",
              new PeerError(PeerErrorCode.PeerClosed, closeEvt.reason),
            );
          }
          return;
        }
        // Transport dropped — schedule reconnect
      }

      // ── Schedule reconnect with exponential back-off ──────────────────
      const delayMs = calculateBackoff(
        this.retryAttempt,
        this.opts.retryPolicy,
      );
      this.retryAttempt++;
      // Create the deferred BEFORE transitioning so that "reconnecting" event
      // listeners can immediately read peer.reconnecting without seeing undefined.
      this.reconnectDeferred = deferred();
      this.transition("reconnecting");

      await this.sleep(delayMs);

      if (this.terminated) {
        // disconnect() already handled state transitions
        this.reconnectDeferred?.resolve({ status: "aborted" });
        return;
      }
    }
  }

  private canRetry(): boolean {
    const p = this.opts.retryPolicy;
    if (p.mode === "never") return false;
    if (p.maxAttempts > 0 && this.retryAttempt >= p.maxAttempts) return false;
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.retryCancel = undefined;
        resolve();
      }, ms);
      this.retryCancel = () => {
        clearTimeout(timer);
        this.retryCancel = undefined;
        resolve();
      };
    });
  }

  // ────────────────── Frame dispatch ──────────────────────────────────────

  private dispatchFrame(frame: Frame): void {
    if (frame.kind !== FrameKind.Message) return;
    const msg = frame as MessageFrame;
    const subject = msg.subject as string;

    if (subject === RPC_SUBJECT) {
      this.rpc
        .handleFrame(msg, (data) => this.sendRaw(data))
        .catch((err) => this.opts.onUnhandledError(err));
      return;
    }

    if (subject === EVENT_SUBJECT) {
      this.events
        .handleFrame(msg)
        .catch((err) => this.opts.onUnhandledError(err));
    }
  }

  // ────────────────── State machine ───────────────────────────────────────

  private transition(next: PeerState): void {
    const prev = this._state;
    if (prev === "closed") return; // terminal — no state can follow closed
    if (prev === next) return;
    this._state = next;

    this.emit("stateChange", { state: next, previous: prev });

    // "connected" fires only on entering "active" from a non-active origin
    if (next === "active" && prev !== "paused") {
      this.emit("connected");
    }
    if (next === "paused") {
      this.emit("sessionPaused");
    }
    if (prev === "paused" && next === "active") {
      this.emit("sessionResumed");
    }
    if (next === "reconnecting") {
      this.emit("reconnecting");
    }
    if (
      (prev === "active" || prev === "paused") &&
      next !== "active" &&
      next !== "paused"
    ) {
      this.emit("disconnected");
    }
  }

  private emit<K extends keyof PeerEvents>(
    event: K,
    ...args: PeerEvents[K] extends void ? [] : [PeerEvents[K]]
  ): void {
    const data = args[0] as PeerEvents[K];
    const subs = this.eventSubs.get(event);
    if (!subs) return;
    // Snapshot: handlers may subscribe/unsubscribe during dispatch.
    // Swallow both sync throws and async rejections — preserve state machine
    // integrity regardless of what user-provided handlers do.
    for (const fn of [...subs]) {
      try {
        const result: unknown = fn(data);
        if (
          result !== null &&
          result !== undefined &&
          typeof (result as { then?: unknown }).then === "function"
        ) {
          (result as Promise<unknown>).catch((err) =>
            this.opts.onUnhandledError(
              err instanceof Error ? err : new Error(String(err)),
            ),
          );
        }
      } catch (err) {
        this.opts.onUnhandledError(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(err: Error): void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function resolveOptions(opts: PeerOptions): ResolvedPeerOptions {
  const peerId = opts.peerId ?? generateId();
  return {
    endpoint: opts.endpoint,
    negotiator:
      opts.negotiator ?? new SbpNegotiator({ peerId: asPeerId(peerId) }),
    transport: opts.transport ?? wsTransport(),
    peerId,
    connectionPolicy: {
      ...DEFAULT_CONNECTION_POLICY,
      ...opts.connectionPolicy,
    },
    rpcPolicy: {
      ...DEFAULT_RPC_POLICY,
      ...opts.rpcPolicy,
    },
    eventPolicy: {
      ...DEFAULT_EVENT_POLICY,
      ...opts.eventPolicy,
    },
    retryPolicy: {
      ...defaultRetryPolicy,
      ...opts.retryPolicy,
    },
    onUnhandledError: opts.onUnhandledError ?? (() => {}),
  };
}
