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
  encodePong,
  fromWireControlCode,
  FrameType,
  type IdentityKeyPair,
  SbrpErrorCode,
} from "@sideband/secure-relay";
import {
  classifyApiError,
  CloudApiError,
  extractDaemonIdFromToken,
  renewPresenceToken,
} from "./api.js";

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
  /**
   * Daemon ID (e.g. `"d_abc123"`). If omitted, extracted from the presence
   * token's `did` claim. If provided, validated against the token on startup —
   * a mismatch (API key belongs to a different daemon) throws immediately.
   */
  daemonId?: string;
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
 * first successful relay connection. Only fatal errors (400/401/403/404 from
 * the API) reject the returned promise and stop retrying. This mirrors
 * standard server-daemon semantics: the process starts and waits for the
 * network, rather than crashing on a transient hiccup.
 *
 * @example
 * ```ts
 * // daemonId is optional — extracted from the presence token automatically.
 * const server = await listen({
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

  // Fetch initial token eagerly: (1) validates API key credentials immediately
  // so bad keys fail fast rather than after a connection attempt, (2) extracts
  // the canonical daemon ID from the `did` claim so callers don't need to
  // supply it, and (3) avoids a redundant renewPresenceToken call on first connect.
  // Transient failures (DNS, 502) are retried with backoff to match standard
  // server daemon startup semantics.
  let firstToken: string;
  let daemonId: string;
  let attempt = 0;

  while (true) {
    if (opts.signal?.aborted) throw normalizeAbortReason(opts.signal.reason);
    try {
      firstToken = await renewPresenceToken(
        opts.apiKey,
        opts.apiUrl,
        opts.signal,
      );
      daemonId = extractDaemonIdFromToken(firstToken);
      if (opts.daemonId !== undefined && opts.daemonId !== daemonId) {
        throw new CloudApiError(
          400,
          `daemonId mismatch: provided "${opts.daemonId}" but API key belongs to daemon "${daemonId}"`,
        );
      }
      break;
    } catch (err) {
      if (opts.signal?.aborted) throw normalizeAbortReason(opts.signal.reason);
      const error = err instanceof Error ? err : new Error(String(err));
      if (
        error instanceof CloudApiError &&
        classifyApiError(error) === "fatal"
      ) {
        throw error;
      }
      // Transient error (network, 5xx) — retry with exponential backoff.
      // Register abort listener before sleep and always remove it after,
      // whether sleep times out or abort cancels it early. once:true alone
      // only cleans up on abort — without removeEventListener, timed-out
      // sleeps leave dangling listeners that accumulate across retries.
      const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
      attempt++;
      let sleepCancel: (() => void) | undefined;
      const onAbort = () => sleepCancel?.();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        await sleep(delayMs, (cancel) => {
          sleepCancel = cancel;
          // Signal already aborted before addEventListener: the event won't
          // re-fire, so cancel eagerly here (inside the Promise constructor,
          // before any yield) instead of relying on the event.
          if (opts.signal?.aborted) cancel();
        });
      } finally {
        opts.signal?.removeEventListener("abort", onAbort);
      }
      if (opts.signal?.aborted) throw normalizeAbortReason(opts.signal.reason);
    }
  }

  // Carry the pre-fetched token into the transport closure so the first relay
  // connect uses it directly; subsequent reconnects fetch fresh tokens.
  let pendingToken: string | null = firstToken;

  const transport = new RelayDaemonTransport(
    async (shutdownSignal: AbortSignal) => {
      // shutdownSignal is the transport's internal shutdown controller signal —
      // fired only when server.close() is called, allowing pending token fetches
      // to be cancelled and close() to drain promptly instead of hanging on
      // network stalls. opts.signal is intentionally NOT used here (startup only).
      const token =
        pendingToken ??
        (await renewPresenceToken(opts.apiKey, opts.apiUrl, shutdownSignal));
      pendingToken = null;
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
      daemonId: asDaemonId(daemonId),
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
    private readonly getRelayUrl: (signal: AbortSignal) => Promise<string>,
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
    // Internal shutdown controller: fired by close() to interrupt in-flight
    // token fetches and WS connection attempts, ensuring loopPromise drains
    // promptly without relying on OS network timeouts (which can be 30+ s).
    const shutdownCtrl = new AbortController();
    let stopCurrent: (() => void) | undefined;
    let stopSleep: (() => void) | undefined;
    let firstConnectResolve: (() => void) | undefined;
    let firstConnectReject: ((e: Error) => void) | undefined;

    const firstConnect = new Promise<void>((resolve, reject) => {
      firstConnectResolve = resolve;
      firstConnectReject = reject;
    });

    // Helper: sleep with cancellation support via stopSleep (shared with close()).
    const sleepWithCancel = (ms: number) =>
      sleep(ms, (c) => {
        stopSleep = c;
      }).finally(() => {
        stopSleep = undefined;
      });

    const run = async () => {
      let attempt = 0;
      while (!stopped) {
        // Hoisted so the catch path can credit a stable connection even when
        // runMux() throws (network drop, RelayControlKick, etc.). Without this,
        // a long-lived connection that ends in a transient error accumulates the
        // attempt counter permanently, resulting in maximum backoff after a few
        // weekly network blips despite otherwise healthy uptime.
        let connectedAt = 0;
        try {
          const url = await this.getRelayUrl(shutdownCtrl.signal);
          const ws = nodeWsTransport();
          const relayConn = await ws.connect(unsafeAsTransportEndpoint(url), {
            signal: shutdownCtrl.signal,
          });
          // Guard: close() may have been called while we were connecting.
          // stopCurrent is not yet set, so close the fresh connection explicitly.
          if (stopped) {
            relayConn.close({ reason: "stopped" }).catch(() => {});
            break;
          }
          stopCurrent = () =>
            relayConn.close({ reason: "stopped" }).catch(() => {});

          // Signal first successful connect
          firstConnectResolve?.();
          firstConnectResolve = undefined;
          firstConnectReject = undefined;

          connectedAt = Date.now();
          await runMux(relayConn, handler, this.logError);
          if (stopped) break; // close() called during runMux — skip reconnect sleep
          // Relay connection closed cleanly (normal for graceful relay restart).
          // Reset backoff for stable connections; apply it for short-lived ones
          // to avoid hammering the token endpoint on rapid relay close cycles.
          if (Date.now() - connectedAt >= STABLE_CONNECTION_MS) {
            attempt = 0;
            // Jitter before reconnect: relay restarts are correlated — without
            // this, all daemons that see a clean close would hit renewPresenceToken
            // simultaneously and DDoS the control plane.
            await sleepWithCancel(Math.random() * 2000);
          } else {
            const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
            attempt++;
            await sleepWithCancel(delayMs);
          }
        } catch (err) {
          if (stopped) break;
          const error = err instanceof Error ? err : new Error(String(err));

          // Fatal API errors (400/401/403/404) — credentials are wrong or the
          // daemon doesn't exist; retrying won't help. Surface immediately and stop.
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

          // Credit stable connections regardless of how they ended — a network
          // drop after hours of uptime is not the same as an immediate reject.
          if (
            connectedAt > 0 &&
            Date.now() - connectedAt >= STABLE_CONNECTION_MS
          ) {
            attempt = 0;
          }

          // Exponential backoff with jitter: 1s–30s + up to 500ms random.
          // Jitter prevents correlated reconnect storms when many daemons lose
          // the relay connection simultaneously (e.g., network blip).
          const delayMs =
            Math.min(1000 * 2 ** attempt, 30_000) + Math.random() * 500;
          attempt++;
          await sleepWithCancel(delayMs);
        }
      }
    };

    // Capture the loop's lifecycle promise so close() can await full termination.
    // Errors that escape run() are programmer bugs (run() only throws if a
    // while-loop invariant breaks); suppress them after stop to avoid spurious logs.
    const loopPromise = run().catch((err) => {
      if (!stopped)
        this.logError(err instanceof Error ? err : new Error(String(err)));
    });

    // Abort support: if the signal fires before firstConnect resolves, stop
    // the loop and reject immediately. After firstConnect resolves the handler
    // is removed — use server.close() to stop a running daemon.
    const abortHandler = () => {
      stopped = true;
      shutdownCtrl.abort(); // cancel any in-flight getRelayUrl / ws.connect
      stopCurrent?.();
      stopSleep?.();
      if (firstConnectReject) {
        firstConnectReject(normalizeAbortReason(this.signal!.reason));
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
        shutdownCtrl.abort(); // cancel in-flight token fetches and WS connects
        stopCurrent?.();
        stopSleep?.();
        await loopPromise;
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
      // Successful decode — reset the consecutive-error counter. Any valid
      // frame (including Ping/Pong) proves the decode path is working; the
      // circuit breaker should only trip on truly consecutive failures.
      consecutiveDecodeErrors = 0;

      // Application-level keepalive: echo Pong with matching payload.
      // Note: the WS transport handles native WS Pings (opcode 0x09) at the
      // TCP/WS layer. SBRP Pings (0x10) are binary frames the relay sends to
      // detect dead daemon connections — they must be answered at this layer.
      if (type === FrameType.Ping) {
        relayConn.send(encodePong(frame.payload)).catch(() => {});
        continue;
      }
      if (type === FrameType.Pong) continue;

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
        vconn = new RelayVirtualConn(sid, relayConn, onError);
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
    private readonly onError?: (e: Error) => void,
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
        // Slow consumer — terminate session to protect daemon memory.
        // Log before terminating so operators can detect backpressure drops.
        this.onError?.(
          new Error(
            `Relay session ${this.sessionId}: buffer full (${MAX_BUFFER_FRAMES} frames), terminating slow consumer`,
          ),
        );
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
            // Guard against concurrent consumers — _waiter is single-slot.
            // @sideband/peer guarantees single-consumer reads, but we defend
            // explicitly since TransportConnection imposes the same contract.
            if (self._waiter) {
              throw new Error(
                "RelayVirtualConn: concurrent reads are not supported",
              );
            }
            return new Promise<IteratorResult<Uint8Array>>((resolve) => {
              self._waiter = resolve;
            });
          },
          // Required by the AsyncIterator spec: called when a consumer breaks
          // out of for-await-of early. Eagerly terminates the virtual connection
          // so the mux stops buffering frames — without this, the buffer would
          // grow to MAX_BUFFER_FRAMES and trigger a noisy "slow consumer" log.
          // terminate() also resolves any pending _waiter, so no leak occurs.
          async return(): Promise<IteratorResult<Uint8Array>> {
            self.terminate(true);
            return { value: undefined as unknown as Uint8Array, done: true };
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

/** Normalize an AbortSignal reason to an Error. `abort()` with no argument sets reason to undefined. */
function normalizeAbortReason(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new DOMException("listen() aborted", "AbortError");
}
