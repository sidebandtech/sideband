// SPDX-License-Identifier: Apache-2.0

/**
 * Server-side peer listener.
 *
 * `listen()` starts a transport listener. For each incoming connection:
 *   1. Run negotiation (SBP or custom).
 *   2. Create an `AcceptedPeerImpl` in `"active"` state.
 *   3. Register the peer in `PeerServer.connections`.
 *   4. Invoke `onConnection(peer)`.
 *   5. Start the frame processing loop.
 *
 * `AcceptedPeer` differences vs `Peer` (enforced at type level):
 *   - No `connect()` — the server did that before hand-off.
 *   - No `reconnecting` — accepted peers never auto-reconnect.
 *   - Valid states: `"active"`, `"paused"`, `"closed"`.
 *   - `disconnect()` is always a hard close (even from `"paused"`).
 *
 * See docs/sdk/peer.md §6.9 and ADR-013 §Phase 6.
 */

import {
  asPeerId,
  decodeFrame,
  FrameKind,
  type MessageFrame,
} from "@sideband/protocol";
import { SbpNegotiator, type SessionSignal } from "@sideband/runtime";
import {
  unsafeAsTransportEndpoint,
  type TransportConnection,
} from "@sideband/transport";
import { nodeWsTransport } from "@sideband/transport-ws/node";
import { PeerError, PeerErrorCode } from "./errors.js";
import { EVENT_SUBJECT, EventsImpl, type EventHost } from "./events.js";
import { generateId } from "./id.js";
import { RPC_SUBJECT, RpcImpl, type RpcHost } from "./rpc.js";
import type {
  AcceptedPeer,
  ConnectionPolicy,
  EventPolicy,
  ListenOptions,
  PeerEvents,
  PeerServer,
  ResolvedListenOptions,
  RpcPolicy,
  Unsubscribe,
} from "./types.js";

const DEFAULT_RPC_POLICY: RpcPolicy = {
  defaultTimeoutMs: 10_000,
  disconnectBufferLimitBytes: 65_536,
};

const DEFAULT_EVENT_POLICY: EventPolicy = {
  maxBufferedEvents: 128,
};

const DEFAULT_CONNECTION_POLICY: ConnectionPolicy = {
  onDisconnect: "fail",
};

/** Start listening for incoming peer connections. */
export async function listen(options: ListenOptions): Promise<PeerServer> {
  const resolved = resolveListenOptions(options);
  const transport = options.transport ?? nodeWsTransport();
  const connections = new Map<string, AcceptedPeer>();

  if (!transport.listen) {
    throw new Error(
      "Provided transport does not support listening (server-side)",
    );
  }

  const listener = await transport.listen(
    unsafeAsTransportEndpoint(options.endpoint),
    async (conn) => {
      handleIncoming(conn, resolved, connections, options).catch((err) => {
        resolved.onUnhandledError(
          err instanceof Error ? err : new Error(String(err)),
        );
      });
    },
  );

  const server: PeerServer = {
    address: listener.address,
    get connections() {
      return connections as ReadonlyMap<string, AcceptedPeer>;
    },
    async close() {
      // Seal the listener first so no new connections can arrive during teardown.
      // Otherwise peers accepted between the snapshot and connections.clear()
      // would be orphaned (their transport stays open but is never tracked).
      await listener.close();
      await Promise.allSettled(
        Array.from(connections.values()).map((p) => p.disconnect()),
      );
      connections.clear();
    },
  };

  return server;
}

async function handleIncoming(
  conn: TransportConnection,
  opts: ResolvedListenOptions,
  connections: Map<string, AcceptedPeer>,
  listenOpts: ListenOptions,
): Promise<void> {
  // Negotiate the session
  let result;
  try {
    result = await opts.negotiator.negotiate(conn);
  } catch (err) {
    opts.onUnhandledError(err instanceof Error ? err : new Error(String(err)));
    await conn.close({ reason: "negotiation_failed" }).catch(() => {});
    return;
  }

  const channel = (result as { channel?: TransportConnection }).channel ?? conn;
  const peerId = result.peerId;
  const peerIdStr = String(peerId);

  // Reject duplicate peerId — the connections map is keyed by peerId, so a
  // collision would silently orphan the existing peer and corrupt map cleanup.
  // Close `channel` (the negotiated endpoint) rather than raw `conn` — when a
  // negotiator wraps conn into a multiplexed channel, closing only conn would
  // leave the channel object open and leak the wrapper.
  if (connections.has(peerIdStr)) {
    opts.onUnhandledError(
      new Error(`Duplicate peerId "${peerIdStr}"; closing new connection`),
    );
    await channel.close({ reason: "duplicate_peer_id" }).catch(() => {});
    return;
  }

  const peer = new AcceptedPeerImpl(channel, peerIdStr, opts);
  connections.set(peerIdStr, peer);

  // Register stateChange BEFORE subscribing to signals: if a signal fires
  // synchronously on subscription and transitions peer to "closed", the map
  // cleanup must already be in place.
  let unsubscribeSignals: (() => void) | undefined;
  peer.on("stateChange", ({ state }) => {
    if (state === "closed") {
      unsubscribeSignals?.();
      if (connections.get(peerIdStr) === peer) connections.delete(peerIdStr);
    }
  });
  try {
    unsubscribeSignals = result.subscribeSignals?.((signal) => {
      peer.handleSessionSignal(signal);
    });
    // A replayed terminal signal (e.g. session_ended) may have closed the peer
    // synchronously inside subscribeSignals, before unsubscribeSignals was
    // assigned. The stateChange listener already ran with undefined — call it
    // now to ensure the subscription is released.
    if (peer.state === "closed") {
      unsubscribeSignals?.();
    }
  } catch (err) {
    connections.delete(peerIdStr);
    await peer.disconnect();
    throw err;
  }

  // Notify user. If the callback throws, clean up immediately — the frame loop
  // never starts and the channel would otherwise stay open and orphaned.
  try {
    await listenOpts.onConnection(peer);
  } catch (err) {
    connections.delete(peerIdStr);
    await peer.disconnect();
    throw err;
  }

  // Start frame loop (runs until connection closes)
  await peer.startFrameLoop();
}

// ────────────────────────────────────────────────────────────────────────────

class AcceptedPeerImpl implements AcceptedPeer, RpcHost, EventHost {
  private _state: "active" | "paused" | "closed" = "active";
  private frameLoopStarted = false;

  private readonly eventSubs = new Map<
    keyof PeerEvents,
    Set<(data: unknown) => void>
  >();

  readonly rpc: RpcImpl;
  readonly events: EventsImpl;

  constructor(
    private readonly channel: TransportConnection,
    private readonly remotePeerId: string,
    private readonly opts: ResolvedListenOptions,
  ) {
    this.rpc = new RpcImpl(this);
    this.events = new EventsImpl(this);
  }

  // ────────────────── AcceptedPeer interface ──────────────────────────────

  get state(): "active" | "paused" | "closed" {
    return this._state;
  }

  get peerId(): string {
    return this.remotePeerId;
  }

  get connected(): boolean {
    return this._state === "active" || this._state === "paused";
  }

  get ready(): boolean {
    return this._state === "active";
  }

  async disconnect(): Promise<void> {
    if (this._state === "closed") return;
    this.close();
    await this.channel.close({ reason: "disconnect" }).catch(() => {});
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
      let unsub: Unsubscribe;
      const onAbort = () => {
        unsub();
        reject(new PeerError(PeerErrorCode.Cancelled, "whenReady aborted"));
      };

      unsub = this.on("stateChange", ({ state }) => {
        if (state === "active") {
          unsub();
          options?.signal?.removeEventListener("abort", onAbort);
          resolve();
        } else if (state === "closed") {
          unsub();
          options?.signal?.removeEventListener("abort", onAbort);
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

  get connectionPolicy(): ConnectionPolicy {
    return DEFAULT_CONNECTION_POLICY;
  }

  get rpcPolicy(): RpcPolicy {
    return this.opts.rpcPolicy;
  }

  get eventPolicy(): EventPolicy {
    return this.opts.eventPolicy;
  }

  async sendRaw(data: Uint8Array): Promise<void> {
    if (this._state === "closed") {
      throw new PeerError(PeerErrorCode.PeerClosed, "Peer is closed");
    }
    if (this._state === "paused") {
      throw new PeerError(PeerErrorCode.SessionPaused, "Session is paused");
    }
    try {
      await this.channel.send(data);
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

  // ────────────────── Frame loop ───────────────────────────────────────────

  /** Start the frame processing loop. Resolves when connection closes. */
  async startFrameLoop(): Promise<void> {
    if (this.frameLoopStarted) return;
    this.frameLoopStarted = true;

    try {
      for await (const bytes of this.channel.inbound) {
        if (this._state === "closed") break;

        let frame;
        try {
          frame = decodeFrame(bytes);
        } catch (err) {
          this.opts.onUnhandledError(
            err instanceof Error ? err : new Error(String(err)),
          );
          continue;
        }

        if (frame.kind !== FrameKind.Message) continue;
        const msg = frame as MessageFrame;
        const subject = msg.subject as string;

        if (subject === RPC_SUBJECT) {
          this.rpc
            .handleFrame(msg, (data) => this.sendRaw(data))
            .catch((err) =>
              this.opts.onUnhandledError(
                err instanceof Error ? err : new Error(String(err)),
              ),
            );
        } else if (subject === EVENT_SUBJECT) {
          this.events
            .handleFrame(msg)
            .catch((err) =>
              this.opts.onUnhandledError(
                err instanceof Error ? err : new Error(String(err)),
              ),
            );
        }
      }
    } catch (err) {
      // Surface SBRP errors (decrypt failures, malformed frames) so operators
      // can observe tampering or protocol bugs. Ignore plain transport closures
      // (TCP reset, etc.) — those are expected and not actionable.
      // Duck-type check avoids a static import of the optional @sideband/secure-relay
      // peer dependency — a missing package would crash the module at load time.
      if (err instanceof Error && err.name === "SbrpError") {
        this.opts.onUnhandledError(err);
      }
    } finally {
      this.close();
    }
  }

  // ────────────────── Signal handling ─────────────────────────────────────

  handleSessionSignal(signal: SessionSignal): void {
    if (this._state === "closed") return;
    if (signal.type === "session_paused") {
      this.transition("paused");
    } else if (signal.type === "session_resumed") {
      this.transition("active");
      this.rpc.flushQueue();
      this.events.flushBuffer();
    } else if (signal.type === "session_ended") {
      this.disconnect().catch(() => {});
    }
  }

  // ────────────────── Internal ─────────────────────────────────────────────

  private transition(next: "active" | "paused" | "closed"): void {
    const prev = this._state;
    if (prev === "closed" || prev === next) return;
    this._state = next;
    this.emit("stateChange", { state: next, previous: prev });
    if (next === "paused") this.emit("sessionPaused");
    if (prev === "paused" && next === "active") this.emit("sessionResumed");
    if ((prev === "active" || prev === "paused") && next === "closed") {
      this.emit("disconnected");
    }
  }

  private close(): void {
    // AcceptedPeer is always terminal — call onClosed() directly to reject
    // all pending/queued work without the intermediate onDisconnect() step.
    this.transition("closed");
    this.rpc.onClosed();
    this.events.onClosed();
    // Release listener closures after the terminal emit to break retention cycles.
    this.eventSubs.clear();
  }

  private emit<K extends keyof PeerEvents>(
    event: K,
    ...args: PeerEvents[K] extends void ? [] : [PeerEvents[K]]
  ): void {
    const data = args[0] as PeerEvents[K];
    const subs = this.eventSubs.get(event);
    if (!subs) return;
    // Snapshot: handlers may subscribe/unsubscribe during dispatch.
    // Swallow both sync throws and async rejections — mirrors PeerImpl.emit.
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

function resolveListenOptions(opts: ListenOptions): ResolvedListenOptions {
  const peerId = opts.peerId ?? generateId();
  return {
    peerId,
    negotiator:
      opts.negotiator ?? new SbpNegotiator({ peerId: asPeerId(peerId) }),
    rpcPolicy: { ...DEFAULT_RPC_POLICY, ...opts.rpcPolicy },
    eventPolicy: { ...DEFAULT_EVENT_POLICY, ...opts.eventPolicy },
    onUnhandledError: opts.onUnhandledError ?? (() => {}),
  };
}
