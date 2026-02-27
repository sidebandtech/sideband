// SPDX-License-Identifier: Apache-2.0

/**
 * Cloud daemon — connects to relay.sideband.cloud as a daemon and
 * multiplexes incoming client SBRP sessions over the single relay WebSocket.
 *
 * Architecture:
 *   relay.sideband.cloud
 *       │ one outbound WebSocket per daemon
 *       │ frames multiplexed by SessionID
 *       ↓
 *   RelayDaemonTransport.listen()
 *       │ demultiplexes frames by SessionID
 *       │ HandshakeInit (new SID) → creates RelayVirtualConn → handler(vconn)
 *       ↓
 *   sbrpDaemonNegotiator (per session)
 *       ↓
 *   AcceptedPeer → onConnection(peer)
 *
 * The transport reconnects automatically when the relay WebSocket drops,
 * fetching a fresh presence token on each attempt.
 */

import type { AcceptedPeer, PeerServer } from "@sideband/peer";
import { listen as peerListen } from "@sideband/peer/server";
import { sbrpDaemonNegotiator } from "@sideband/peer/sbrp";
import type {
  CloseInfo,
  CloseOptions,
  ConnectionHandler,
  ConnectionId,
  Transport,
  TransportConnection,
  TransportEndpoint,
  TransportListener,
} from "@sideband/transport";
import { asConnectionId, unsafeAsTransportEndpoint } from "@sideband/transport";
import { nodeWsTransport } from "@sideband/transport-ws/node";
import {
  asDaemonId,
  decodeControl,
  decodeFrame,
  fromWireControlCode,
  FrameType,
  type IdentityKeyPair,
  SbrpErrorCode,
} from "@sideband/secure-relay";
import { classifyApiError, CloudApiError, renewPresenceToken } from "./api.js";

// A connection must stay open at least this long to reset the backoff counter.
// Shorter connections indicate relay-side rejection or network flapping.
const STABLE_CONNECTION_MS = 5_000;

/**
 * Thrown by runMux when the relay sends a terminal SID=0 Control frame
 * (unauthorized, internal_error, etc.). This is an expected reconnect
 * trigger — the daemon silently backs off and retries. Fatal credential
 * failures will surface as a CloudApiError on the next renewPresenceToken call.
 */
class RelayControlKick extends Error {
  constructor(reason: string) {
    super(`Relay daemon control: ${reason}`);
    this.name = "RelayControlKick";
  }
}

/**
 * Thrown by RelayVirtualConn.send() when a send races with session teardown.
 * Filtered out in the runMux handler catch so it doesn't alarm operators;
 * filterable by `error.name === "SessionClosedError"` if it ever escapes.
 */
class SessionClosedError extends Error {
  constructor() {
    super("Session closed");
    this.name = "SessionClosedError";
  }
}

/** Options for {@link listen}. */
export interface ListenOptions {
  /** Daemon ID (e.g. `"d_abc123"`). */
  daemonId: string;
  /** API key (`dak_...`) used to renew the relay presence token on each reconnect. */
  apiKey: string;
  /** Ed25519 identity keypair for SBRP daemon authentication. */
  identityKeyPair: IdentityKeyPair;
  /** Called for each accepted client session. */
  onConnection: (peer: AcceptedPeer) => void | Promise<void>;
  /** Defaults to `"https://api.sideband.cloud"`. */
  apiUrl?: string;
  /** Defaults to `"wss://relay.sideband.cloud"`. */
  relayUrl?: string;
  /**
   * Log sink for diagnostic events (relay rate limiting, malformed frames)
   * and connection errors while the transport retries in the background.
   * Fatal credential failures at startup reject `listen()` directly instead.
   * The reconnect loop has no retry limit — this callback is not a crash signal.
   */
  onUnhandledError?: (error: Error) => void;
  /**
   * An `AbortSignal` to cancel `listen()` before the first successful relay
   * connection. Aborting rejects the returned promise immediately and stops
   * the reconnect loop. For a running daemon, use the returned server's
   * `close()` instead — aborting after the first connect is a no-op.
   */
  signal?: AbortSignal;
}

/**
 * Connect to relay.sideband.cloud as a daemon and accept client sessions.
 *
 * Makes an outbound WebSocket connection to the relay (not a local port bind)
 * and multiplexes incoming SBRP sessions over it. Resolves when connected
 * and ready. Presence token is renewed automatically on each reconnect.
 *
 * **Startup behavior:** transient failures (DNS, 502, network unavailable)
 * are retried with exponential backoff — `listen()` stays pending until the
 * first successful relay connection. Only fatal errors (401/403/404 from
 * the API) reject the returned promise and stop retrying. This mirrors
 * standard server-daemon semantics: the process starts and waits for the
 * network, rather than crashing on a transient hiccup.
 *
 * @example
 * ```ts
 * const server = await listen({
 *   daemonId: process.env.SIDEBAND_DAEMON_ID,
 *   apiKey: process.env.SIDEBAND_API_KEY,
 *   identityKeyPair: await loadOrCreateIdentityKeyPair(),
 *   onConnection(peer) {
 *     peer.rpc.handle("ping", () => "pong");
 *   },
 * });
 * ```
 */
export async function listen(opts: ListenOptions): Promise<PeerServer> {
  const relayBase = opts.relayUrl ?? "wss://relay.sideband.cloud";

  const transport = new RelayDaemonTransport(
    async () => {
      const token = await renewPresenceToken(opts.apiKey, opts.apiUrl);
      const url = new URL(relayBase);
      url.searchParams.set("token", token);
      return url.toString();
    },
    opts.onUnhandledError,
    opts.signal,
  );

  return peerListen({
    transport,
    negotiator: sbrpDaemonNegotiator({
      daemonId: asDaemonId(opts.daemonId),
      identityKeyPair: opts.identityKeyPair,
    }),
    onConnection: opts.onConnection,
    onUnhandledError: opts.onUnhandledError,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RelayDaemonTransport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transport that connects outbound to the relay and demultiplexes SBRP
 * sessions from the single relay WebSocket.
 *
 * When `listen()` is called, it starts a reconnect loop that:
 * 1. Gets a fresh relay URL (with presence token) from `getRelayUrl`
 * 2. Connects to the relay using the ws transport
 * 3. Runs the frame mux loop until the relay connection closes
 * 4. Reconnects with backoff on error
 */
class RelayDaemonTransport implements Transport {
  readonly kind = "cloud:relay-daemon";

  private readonly logError: (e: Error) => void;

  constructor(
    private readonly getRelayUrl: () => Promise<string>,
    onUnhandledError: ((e: Error) => void) | undefined,
    private readonly signal: AbortSignal | undefined,
  ) {
    this.logError = onUnhandledError ?? console.error;
  }

  async connect(): Promise<TransportConnection> {
    throw new Error(
      "RelayDaemonTransport is server-only; use listen() not connect()",
    );
  }

  async listen(
    _endpoint: TransportEndpoint,
    handler: ConnectionHandler,
  ): Promise<TransportListener> {
    let stopped = false;
    let stopCurrent: (() => void) | undefined;
    let stopSleep: (() => void) | undefined;
    let firstConnectResolve: (() => void) | undefined;
    let firstConnectReject: ((e: Error) => void) | undefined;

    const firstConnect = new Promise<void>((resolve, reject) => {
      firstConnectResolve = resolve;
      firstConnectReject = reject;
    });

    const run = async () => {
      let attempt = 0;
      while (!stopped) {
        try {
          const url = await this.getRelayUrl();
          const ws = nodeWsTransport();
          const relayConn = await ws.connect(unsafeAsTransportEndpoint(url));
          stopCurrent = () =>
            relayConn.close({ reason: "stopped" }).catch(() => {});

          // Signal first successful connect
          firstConnectResolve?.();
          firstConnectResolve = undefined;
          firstConnectReject = undefined;

          const connectedAt = Date.now();
          await runMux(relayConn, handler, this.logError);
          // Relay connection closed cleanly (normal for graceful relay restart).
          // Reset backoff for stable connections; apply it for short-lived ones
          // to avoid hammering the token endpoint on rapid relay close cycles.
          if (Date.now() - connectedAt >= STABLE_CONNECTION_MS) {
            attempt = 0;
          } else {
            const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
            attempt++;
            await sleep(delayMs, (c) => {
              stopSleep = c;
            });
            stopSleep = undefined;
          }
        } catch (err) {
          if (stopped) break;
          const error = err instanceof Error ? err : new Error(String(err));

          // Fatal API errors (401/403/404) — credentials are wrong or the daemon
          // doesn't exist; retrying won't help. Surface immediately and stop.
          if (
            error instanceof CloudApiError &&
            classifyApiError(error) === "fatal"
          ) {
            if (firstConnectReject) {
              firstConnectReject(error);
              firstConnectResolve = undefined;
              firstConnectReject = undefined;
            } else {
              this.logError(error);
            }
            return;
          }

          // RelayControlKick is an expected reconnect trigger (relay restart,
          // transient internal_error, etc.) — no need to alarm the operator.
          // Network failures and other unexpected errors are still surfaced.
          if (!(error instanceof RelayControlKick)) {
            this.logError(error);
          }

          // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
          const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
          attempt++;
          await sleep(delayMs, (c) => {
            stopSleep = c;
          });
          stopSleep = undefined;
        }
      }
    };

    run().catch((err) => {
      if (!stopped)
        this.logError(err instanceof Error ? err : new Error(String(err)));
    });

    // Abort support: if the signal fires before firstConnect resolves, stop
    // the loop and reject immediately. After firstConnect resolves the handler
    // is removed — use server.close() to stop a running daemon.
    const abortHandler = () => {
      stopped = true;
      stopCurrent?.();
      stopSleep?.();
      if (firstConnectReject) {
        const reason = this.signal!.reason;
        firstConnectReject(
          reason instanceof Error
            ? reason
            : Object.assign(new Error("listen() aborted"), {
                name: "AbortError",
              }),
        );
        firstConnectResolve = undefined;
        firstConnectReject = undefined;
      }
    };
    this.signal?.addEventListener("abort", abortHandler);
    // Handle already-aborted signals — the "abort" event won't re-fire if the
    // signal was aborted before addEventListener, so check immediately after.
    if (this.signal?.aborted) abortHandler();

    try {
      await firstConnect;
    } finally {
      this.signal?.removeEventListener("abort", abortHandler);
    }

    return {
      address: unsafeAsTransportEndpoint("cloud:relay-daemon"),
      async close() {
        stopped = true;
        stopCurrent?.();
        stopSleep?.();
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Relay mux
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads SBRP frames from a relay connection and routes them to per-session
 * virtual connections. When a HandshakeInit arrives for a new SessionID, a
 * new virtual connection is created and the handler is invoked.
 *
 * The relay sends all client frames over the single daemon WebSocket.
 * Each frame's 13-byte header contains: type (1B), length (4B), sessionId (8B).
 */
async function runMux(
  relayConn: TransportConnection,
  handler: ConnectionHandler,
  onError: ((e: Error) => void) | undefined,
): Promise<void> {
  const sessions = new Map<bigint, RelayVirtualConn>();
  // Circuit breaker: N consecutive decode failures → reconnect with backoff.
  // Protects against log storms on protocol version mismatch (every frame
  // would fail otherwise). The reconnect loop's exponential backoff caps the
  // error rate at 10 errors per backoff period even if the mismatch persists.
  let consecutiveDecodeErrors = 0;
  const MAX_CONSECUTIVE_DECODE_ERRORS = 10;

  try {
    for await (const bytes of relayConn.inbound) {
      let frame: ReturnType<typeof decodeFrame>;
      try {
        frame = decodeFrame(bytes);
      } catch (err) {
        // Malformed frame from the relay — relay validates before forwarding,
        // so this indicates a relay bug or a protocol version mismatch.
        onError?.(err instanceof Error ? err : new Error(String(err)));
        if (++consecutiveDecodeErrors >= MAX_CONSECUTIVE_DECODE_ERRORS) {
          // Emit a summary diagnostic before throwing so operators see the
          // cause; RelayControlKick itself is suppressed from the outer logger.
          onError?.(
            new Error(
              `Relay: ${MAX_CONSECUTIVE_DECODE_ERRORS} consecutive malformed frames — reconnecting`,
            ),
          );
          throw new RelayControlKick(
            `${MAX_CONSECUTIVE_DECODE_ERRORS} consecutive malformed frames`,
          );
        }
        continue;
      }

      const { type, sessionId: sid } = frame;

      // Ping — relay keepalive, pong is handled at the ws transport layer.
      // Keepalives don't indicate the application protocol is healthy, so they
      // must not reset the decode-error counter.
      if (type === FrameType.Ping || type === FrameType.Pong) continue;
      consecutiveDecodeErrors = 0;

      // Daemon-level Control (SID=0): sent by the relay for connection-level events.
      // rate_limited (0x0901) is non-terminal — relay keeps the connection alive
      // and drops excess frames until the bucket refills; continue the loop.
      // All other SID=0 codes are terminal — throw so the reconnect loop applies
      // backoff. If credentials are revoked, the next renewPresenceToken call will
      // surface a fatal 401/403 and stop permanently.
      if (type === FrameType.Control && sid === 0n) {
        let reason = "relay daemon control";
        try {
          const ctrl = decodeControl(frame);
          if (fromWireControlCode(ctrl.code) === SbrpErrorCode.RateLimited) {
            // Relay sends one rate_limited frame per rate-limit window (not per
            // dropped frame), so this won't spam. Operators should know when
            // their daemon is being throttled.
            onError?.(
              new Error(
                ctrl.message
                  ? `Relay rate_limited: ${ctrl.message}`
                  : "Relay rate_limited",
              ),
            );
            continue;
          }
          reason = ctrl.message || `code 0x${ctrl.code.toString(16)}`;
        } catch {
          // Malformed Control payload — treat as terminal
        }
        for (const [, conn] of sessions) conn.terminate(false);
        sessions.clear();
        throw new RelayControlKick(reason);
      }

      let vconn = sessions.get(sid);

      if (!vconn) {
        // Unknown session — only HandshakeInit starts a new one
        if (type !== FrameType.HandshakeInit) continue;
        vconn = new RelayVirtualConn(sid, relayConn);
        sessions.set(sid, vconn);
        vconn.whenClosed().then(() => sessions.delete(sid));
        // handler() runs sbrpDaemonNegotiator.negotiate(vconn) asynchronously.
        // SessionClosedError is an expected teardown race — suppress it.
        // All other errors indicate a bug in the session handler and are surfaced.
        Promise.resolve(handler(vconn)).catch((err) => {
          const e = err instanceof Error ? err : new Error(String(err));
          if (e instanceof SessionClosedError) return;
          onError?.(e);
        });
      }

      vconn.deliver(bytes);
    }
  } finally {
    // Relay connection closed — terminate all sessions so their inbound
    // iterators complete and AcceptedPeer instances transition to "closed".
    for (const [, conn] of sessions) conn.terminate(false);
    sessions.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RelayVirtualConn
// ─────────────────────────────────────────────────────────────────────────────

// Terminate a virtual connection after this many buffered frames. Guards the
// daemon against memory exhaustion from a slow or stalled SBRP consumer.
const MAX_BUFFER_FRAMES = 1024;

/**
 * A virtual `TransportConnection` scoped to one SBRP session (by SessionID).
 *
 * Frames delivered via `deliver()` are buffered and yielded from `inbound`.
 * `send()` forwards bytes to the relay WebSocket (the daemon's SBRP layer
 * already embeds the SessionID in frame headers before calling send()).
 */
class RelayVirtualConn implements TransportConnection {
  private readonly _buffer: Uint8Array[] = [];
  private _waiter: ((r: IteratorResult<Uint8Array>) => void) | null = null;
  private _closed = false;
  private readonly _closedPromise: Promise<CloseInfo>;
  private _resolveClose!: (info: CloseInfo) => void;

  readonly id: ConnectionId;
  readonly endpoint: TransportEndpoint;

  constructor(
    readonly sessionId: bigint,
    private readonly relay: TransportConnection,
  ) {
    this.id = asConnectionId(`relay:${sessionId}`);
    this.endpoint = unsafeAsTransportEndpoint(`relay:${sessionId}`);
    this._closedPromise = new Promise((r) => {
      this._resolveClose = r;
    });
  }

  get state(): "connecting" | "open" | "closing" | "closed" {
    return this._closed ? "closed" : "open";
  }

  get closed(): Promise<CloseInfo> {
    return this._closedPromise;
  }

  /** Called by the mux to deliver a frame to this session. */
  deliver(bytes: Uint8Array): void {
    if (this._closed) return;
    if (this._waiter) {
      this._waiter({ value: bytes, done: false });
      this._waiter = null;
    } else {
      if (this._buffer.length >= MAX_BUFFER_FRAMES) {
        // Slow consumer — drop and close this session to protect daemon memory.
        this.terminate(false);
        return;
      }
      this._buffer.push(bytes);
    }
  }

  /** Terminate this virtual connection (relay dropped or session ended). */
  terminate(graceful: boolean): void {
    if (this._closed) return;
    this._closed = true;
    this._resolveClose({ graceful });
    if (this._waiter) {
      this._waiter({ value: undefined as unknown as Uint8Array, done: true });
      this._waiter = null;
    }
  }

  whenClosed(): Promise<void> {
    return this._closedPromise.then(() => {});
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (this._closed) throw new SessionClosedError();
    await this.relay.send(bytes);
  }

  async close(_options?: CloseOptions): Promise<void> {
    this.terminate(true);
  }

  get inbound(): AsyncIterable<Uint8Array> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        return {
          async next(): Promise<IteratorResult<Uint8Array>> {
            if (self._buffer.length > 0) {
              return { value: self._buffer.shift()!, done: false };
            }
            if (self._closed) {
              return { value: undefined as unknown as Uint8Array, done: true };
            }
            return new Promise<IteratorResult<Uint8Array>>((resolve) => {
              self._waiter = resolve;
            });
          },
        };
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function sleep(
  ms: number,
  register?: (cancel: () => void) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    register?.(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
