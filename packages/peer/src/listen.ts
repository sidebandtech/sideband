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
import { SbpNegotiator } from "@sideband/runtime";
import {
  unsafeAsTransportEndpoint,
  type TransportConnection,
} from "@sideband/transport";
import { nodeWsTransport } from "@sideband/transport-ws";
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

  // Remove from map when peer closes. Identity check prevents a later duplicate
  // (if somehow one slips through) from deleting an active peer's entry.
  peer.on("stateChange", ({ state }) => {
    if (state === "closed" && connections.get(peerIdStr) === peer) {
      connections.delete(peerIdStr);
    }
  });

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
            .catch((err) => this.opts.onUnhandledError(err));
        } else if (subject === EVENT_SUBJECT) {
          this.events
            .handleFrame(msg)
            .catch((err) => this.opts.onUnhandledError(err));
        }
      }
    } catch {
      // Abrupt transport closure (TCP reset, etc.) — not an application error.
      // The finally block handles cleanup via this.close().
    } finally {
      this.close();
    }
  }

  // ────────────────── Internal ─────────────────────────────────────────────

  private close(): void {
    if (this._state === "closed") return;
    const prev = this._state;
    this._state = "closed";
    // AcceptedPeer is always terminal — call onClosed() directly to reject
    // all pending/queued work without the intermediate onDisconnect() step.
    this.rpc.onClosed();
    this.events.onClosed();
    this.emitStateChange("closed", prev);
  }

  private emitStateChange(
    state: "active" | "paused" | "closed",
    previous: "active" | "paused" | "closed",
  ): void {
    this.emit("stateChange", { state, previous });
    if (previous === "active" || previous === "paused") {
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
