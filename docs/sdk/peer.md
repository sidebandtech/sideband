# RFC: @sideband/peer SDK

**Status:** Draft · Phases 0–4, 6, and 7 (partial) implemented · Phase 5 (SBRP) pending
**Created:** 2026-01-13
**Updated:** 2026-02-24

## 1. Summary

`@sideband/peer` is a high-level SDK providing a developer-friendly API for real-time applications on the Sideband stack. It wraps `@sideband/runtime`, `@sideband/transport-ws`, and `@sideband/secure-relay` with three core capabilities:

- **Connection lifecycle** — Connect, reconnect, disconnect with observable state
- **RPC** — Type-safe remote procedure calls with correlation and timeouts
- **Events** — Fire-and-forget events with subject-based routing

**Target Developer:**

> Developers who start on localhost and expect to graduate to secure remote access without rewriting their stack.

This includes indie developers building local-first tools (AI agents, dev tools, desktop apps) who need browser↔daemon communication today, and secure relay access tomorrow.

**Design Goals:**

1. Progressive disclosure: `createPeer()` with `sbpNegotiator()` for localhost, `sbrpClientNegotiator()` for relay
2. Full TypeScript inference without manual casts
3. Secure by default: explicit negotiator selection, no URL-based auto-detection
4. Hard to misuse: invalid configuration fails at construction, not runtime
5. Graduation path: same SDK for local dev and production E2EE relay

---

## 2. Use Cases

### UC1: Local Development (Browser ↔ Local Daemon)

**Actor:** Frontend developer building a desktop app with a web-based UI.

**Scenario:** Browser UI communicates with a local daemon (Bun/Node on `localhost:8080`) for file system access, system commands, or local services.

```
Browser (UI) ←—— WebSocket ——→ Local Daemon (localhost:8080)
```

**Requirements:**

- Direct WebSocket connection (no relay)
- Fast reconnection on daemon restart
- Bidirectional RPC (UI calls daemon; daemon pushes events to UI)

**Security:** Transport is trusted (loopback interface). No E2EE required.

---

### UC2: Remote Management (Browser ↔ Cloud Daemon via E2EE Relay)

**Actor:** DevOps engineer managing cloud infrastructure through a web dashboard.

**Scenario:** Browser connects to a daemon on a remote VM. Traffic routes through `wss://relay.sideband.cloud` which handles routing but cannot read message contents.

```
Browser ←—— E2EE (SBRP) ——→ Relay Server ←—— E2EE (SBRP) ——→ Cloud Daemon
```

**Requirements:**

- End-to-end encryption (relay sees only metadata)
- TOFU identity pinning (detect daemon impersonation)
- Automatic reconnection through relay
- Session pause/resume when daemon temporarily disconnects

**Security:** Relay is untrusted. All application data encrypted with ChaCha20-Poly1305. Daemon identity verified via Ed25519 signatures.

---

### UC3: Service Mesh (Daemon ↔ Daemon)

**Actor:** Backend services communicating within a cluster.

**Scenario:** Multiple daemons communicate directly for service-to-service RPC or event propagation.

```
Daemon A ←—— WebSocket/TCP ——→ Daemon B
```

**Requirements:**

- Server-side listening capability
- Multiple concurrent connections
- High throughput with backpressure handling

**Security:** Transport security via TLS. Application-level E2EE optional.

---

## 3. Non-Goals (v1)

| Non-Goal                            | Rationale                                         |
| ----------------------------------- | ------------------------------------------------- |
| **Data synchronization / CRDTs**    | Use Yjs, Automerge, or Gun.js                     |
| **Service discovery**               | Peers must know endpoints upfront                 |
| **Multi-party group communication** | v1 is point-to-point                              |
| **Offline-first / message queuing** | SDK requires active connection                    |
| **Streaming RPC**                   | Reserved for v2 via `stream/` subject prefix      |
| **Built-in presence**               | Defer to v2; requires additional protocol support |

---

## 4. Design Principles

### 4.1 Layered Architecture (Not God Object)

The SDK separates concerns into distinct components:

| Component          | Responsibility                                          |
| ------------------ | ------------------------------------------------------- |
| **PeerConnection** | Transport lifecycle, reconnection, negotiation          |
| **RpcClient**      | Request/response correlation, typed methods             |
| **Events**         | Fire-and-forget event emission and listening            |
| **Peer**           | Coordinator exposing the three above; no business logic |

This separation enables:

- Independent testing of each layer
- Future extraction (e.g., `@sideband/rpc-browser` standalone)
- Clear error attribution by layer

### 4.2 Explicit Negotiator Selection (No Auto-Detection)

The negotiator determines the session protocol (SBP for direct, SBRP for relay). This is security-critical and must be explicit:

```typescript
// Direct mode: plain SBP handshake (default when negotiator omitted)
const peer = createPeer({
  endpoint: "ws://localhost:8080",
  negotiator: sbpNegotiator(),
});

// Relay mode: E2EE with TOFU identity (Phase 5)
const peer = createPeer({
  endpoint: "wss://relay.example.com",
  negotiator: sbrpClientNegotiator({
    daemonId: "my-daemon",
    keyStorage: createBrowserKeyStorage(),
  }),
});
```

**Why no auto-detection:**

- URL patterns are unreliable (self-hosted relays, TLS for direct P2P)
- Security posture should be explicit and auditable
- Enables future protocols (TURN, QUIC+SBRP) without API changes

### 4.3 Explicit Construction, No Sugar Wrappers

`createPeer()` requires an explicit `negotiator`. There are no `createDirectPeer()` / `createRelayPeer()` shortcuts — explicit construction keeps the security model visible and auditable. `sbpNegotiator()` is the default and is ergonomic enough that no alias is needed.

### 4.4 Type Safety Without Ceremony

Full TypeScript inference using function-signature format for `TypedRpcClient<T>`:

```typescript
interface Api {
  "user.get": (params: { id: string }) => User;
  "user.list": (params: void) => User[];
}

const api = peer.rpc.client<Api>();
const user = await api["user.get"]({ id: "123" }); // user: User, inferred
const users = await api["user.list"](); // no params required
```

### 4.5 Fail Fast, Fail Loud

Invalid configuration and programming errors throw synchronously at the call site, not at runtime:

```typescript
// Throws synchronously: method already registered
peer.rpc.handle("user.get", handlerA);
peer.rpc.handle("user.get", handlerB); // PeerError{ code: "rpc_method_already_registered" }

// Throws synchronously: invalid pattern
peer.events.onPattern("user.**", handler); // PeerError{ code: "invalid_pattern" }
```

### 4.6 Policy vs Mechanism Separation

Behavior is configurable via policy objects, not hardcoded:

```typescript
const peer = createPeer({
  endpoint: "ws://localhost:8080",
  connectionPolicy: { onDisconnect: "pause" },
  rpcPolicy: { defaultTimeoutMs: 5_000 },
  eventPolicy: { maxBufferedEvents: 256 },
});
```

---

## 5. Architecture

### 5.1 Layer Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        @sideband/peer                           │
│                                                                 │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ PeerConnection  │  │  RpcClient   │  │     Events       │   │
│  │  (lifecycle +   │  │  (request/   │  │  (emit/on,       │   │
│  │   negotiation)  │  │   response)  │  │   fire-forget)   │   │
│  └────────┬────────┘  └──────┬───────┘  └────────┬─────────┘   │
│           │                  │                    │             │
│  ┌────────┴──────────────────┴────────────────────┴──────────┐  │
│  │                         Peer                               │  │
│  │  (coordinator: wires connection + router + correlation)    │  │
│  └────────┬───────────────────────────────────────────────────┘  │
│           │                                                      │
│  ┌────────┴─────────────┐              ┌──────────────────────┐  │
│  │     Negotiator       │              │      Transport       │  │
│  │  (SBP or SBRP)       │              │    (WebSocket)       │  │
│  └──────────────────────┘              └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                                        │
         ▼                                        ▼
  @sideband/runtime                    @sideband/transport-ws
  @sideband/secure-relay               @sideband/transport
  @sideband/rpc                        @sideband/protocol
```

### 5.2 Component Responsibilities

| Component          | Responsibility                                   | Does NOT                          |
| ------------------ | ------------------------------------------------ | --------------------------------- |
| **Peer**           | Wire components together; expose namespaces      | Contain lifecycle/RPC/event logic |
| **PeerConnection** | Transport lifecycle; state machine; reconnection | Parse message content             |
| **RpcClient**      | Correlation; typed clients; timeouts             | Manage transport                  |
| **Events**         | Subscriptions; client-side filtering             | Guarantee delivery                |
| **Negotiator**     | Session establishment (SBP/SBRP)                 | Persist keys                      |

---

## 6. API Reference

### 6.1 Factory Functions

```typescript
// Core factory
function createPeer(options: PeerOptions): Peer;

// Server
function listen(options: ListenOptions): Promise<PeerServer>;

// Negotiator factories
function sbpNegotiator(opts?: {
  peerId?: string;
  capabilities?: string[];
  handshakeTimeoutMs?: number;
}): Negotiator;
// sbrpClientNegotiator / sbrpDaemonNegotiator — Phase 5, see §10

// Pattern utilities (also exported from the package)
function isValidEventName(name: string): boolean;
function validatePattern(pattern: string): void; // throws on invalid
function matchPattern(pattern: string, name: string): boolean;
```

### 6.2 PeerOptions

```typescript
interface PeerOptions {
  /** WebSocket endpoint, e.g. "ws://localhost:8080". */
  endpoint: string;

  /**
   * Session negotiator. Defaults to sbpNegotiator() (plain SBP handshake).
   * Pass sbrpClientNegotiator(...) for E2EE relay mode (Phase 5).
   */
  negotiator?: Negotiator;

  /**
   * Transport factory. Defaults to wsTransport() (auto-detects platform).
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
   * Handler for errors with no other delivery path (e.g. event handler throws).
   * Defaults to no-op — opt in to logging explicitly.
   */
  onUnhandledError?: (error: Error) => void;
}
```

### 6.3 Policy Objects

```typescript
interface ConnectionPolicy {
  /**
   * Behavior when the connection drops.
   * - "fail": RPC calls rejected immediately when peer is not active (default).
   * - "pause": Unsent calls are buffered up to rpcPolicy.disconnectBufferLimitBytes
   *   (from any non-ready state, including before first connect); overflow →
   *   PeerError{ code: "buffer_overflow" }. Already in-flight calls are still
   *   rejected on disconnect. Full in-flight preservation requires Phase 5
   *   pause signals.
   */
  onDisconnect: "fail" | "pause";
}

interface RpcPolicy {
  /** Per-call timeout when RpcCallOptions.timeoutMs is absent. Default: 10_000. */
  defaultTimeoutMs: number;
  /**
   * Max queued outgoing RPC bytes when onDisconnect === "pause". Default: 65_536 (64 KiB).
   * Overflow rejects the enqueued call with PeerError{ code: "buffer_overflow" }.
   */
  disconnectBufferLimitBytes: number;
}

interface EventPolicy {
  /**
   * Max events buffered while disconnected. Oldest evicted silently on overflow.
   * Default: 128.
   */
  maxBufferedEvents: number;
}
```

`RetryPolicy` is re-exported from `@sideband/runtime` and governs reconnection backoff.

### 6.4 Peer Interface

```typescript
interface Peer {
  /** Current lifecycle state. */
  readonly state: PeerState;

  /** true when state is "active" or "paused". */
  readonly connected: boolean;

  /** true only when state is "active" (traffic can flow). */
  readonly ready: boolean;

  /**
   * Promise for the current reconnection cycle.
   * Created on entering "reconnecting"; undefined otherwise.
   * disconnect() resolves it with { status: "aborted" }.
   */
  readonly reconnecting: Promise<ReconnectionOutcome> | undefined;

  readonly rpc: RpcInterface;
  readonly events: EventsInterface;

  /**
   * Initiate connection. Returns a Promise that resolves on first "active".
   * Can only be called from "idle". Idempotent: returns the same Promise if
   * already "connecting" or "negotiating". Throws synchronously from "active",
   * "paused", "reconnecting", or "closed".
   * Fatal errors are rejected on the Promise AND emitted via on("error").
   */
  connect(): Promise<void>;

  /**
   * Hard close. Idempotent (no-op if already "closed").
   * Resolves reconnecting with { status: "aborted" }.
   */
  disconnect(): Promise<void>;

  /**
   * Wait until state === "active".
   * Resolves immediately if already active.
   * Rejects immediately with peer_closed if already closed.
   * Stays pending during "paused" — readiness requires active traffic flow.
   * Abortable via options.signal.
   */
  whenReady(options?: { signal?: AbortSignal }): Promise<void>;

  /** Subscribe to a peer lifecycle event. */
  on<K extends keyof PeerEvents>(
    event: K,
    handler: (data: PeerEvents[K]) => void,
  ): Unsubscribe;

  /** Enables `using peer = createPeer(...)`. Calls disconnect(). */
  [Symbol.dispose](): void;
  /** Enables `await using peer = createPeer(...)`. Awaits disconnect(). */
  [Symbol.asyncDispose](): Promise<void>;
}
```

### 6.5 PeerState

```typescript
type PeerState =
  | "idle" // Not connected, not connecting
  | "connecting" // Transport connection in progress
  | "negotiating" // Handshake in progress
  | "active" // Ready; traffic can flow
  | "paused" // SBRP session pause; session alive, SDK client-side buffering
  | "reconnecting" // Waiting before next retry
  | "closed"; // Terminal; no reconnection

type ReconnectionOutcome =
  | { status: "connected" }
  | { status: "aborted" }
  | { status: "failed"; error: Error };
```

**State machine:**

```
idle → connecting → negotiating → active ↔ paused
active | paused | connecting | negotiating → reconnecting → connecting → …
any → closed  (terminal)
```

`"reconnecting"` creates `peer.reconnecting` promise (one per cycle).
`"paused"` does not create a `reconnecting` promise — the session is alive.

**State quick reference:**

| Need                         | Check                                       |
| ---------------------------- | ------------------------------------------- |
| Can I send right now?        | `peer.ready` (`state === "active"`)         |
| Is the session established?  | `peer.connected` (`"active"` or `"paused"`) |
| Is reconnection in progress? | `peer.reconnecting !== undefined`           |
| Is the peer in SBRP pause?   | `peer.state === "paused"`                   |

### 6.6 PeerEvents

```typescript
interface PeerEvents {
  /** Fires on every state transition. */
  stateChange: { state: PeerState; previous: PeerState };
  /** Fires when entering "active" except when resuming from "paused" (use sessionResumed). */
  connected: void;
  /** Fires when leaving "active" or "paused" toward disconnect/close. */
  disconnected: void;
  /** Fires when entering "reconnecting". */
  reconnecting: void;
  /** Fires when entering "paused" (SBRP session pause). */
  sessionPaused: void;
  /** Fires when resuming from "paused" to "active". */
  sessionResumed: void;
  /** Fires on fatal or unhandled errors. */
  error: Error;
}
```

### 6.7 RpcInterface

````typescript
interface RpcInterface {
  /**
   * Make an RPC call. Rejects with PeerError on timeout, cancellation, or remote error.
   * Handler errors on the remote side are returned as RPC error responses — the caller
   * gets a rejection, not a timeout.
   */
  call<R = unknown>(
    method: string,
    params?: unknown,
    options?: RpcCallOptions,
  ): Promise<R>;

  /**
   * Like call() but never throws. Returns { ok, value, reconnected }.
   * reconnected: true means the call survived a readiness gap and completed after
   * readiness was restored.
   */
  tryCall<R = unknown>(
    method: string,
    params?: unknown,
    options?: RpcCallOptions,
  ): Promise<TryCallResult<R>>;

  /**
   * Register a handler for method. Returns Unsubscribe.
   * Throws synchronously with PeerError{ code: "rpc_method_already_registered" }
   * if the method already has a handler.
   * Handler errors are sent back as RPC error responses.
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

  /**
   * Returns a typed proxy that maps method keys to typed call functions.
   * T is an interface whose keys are method names (string literals) and values
   * are function signatures describing params and return type.
   */
  client<T>(): TypedRpcClient<T>;
}

interface RpcCallOptions {
  /** Override rpcPolicy.defaultTimeoutMs for this call. */
  timeoutMs?: number;
  /** Aborting rejects with PeerError{ code: "rpc_cancelled" }. */
  signal?: AbortSignal;
}

type TryCallResult<R> =
  | { ok: true; value: R; reconnected: boolean }
  | { ok: false; error: PeerError; reconnected: boolean };

/**
 * T keys are method names; values are function types.
 * When params is void | undefined the params argument is optional.
 *
 * interface Api {
 *   "user.get": (params: { id: string }) => User;
 *   "ping":     (params: void) => void;
 *   "noop":     () => void;
 * }
 */
type TypedRpcClient<T> = {
  [K in keyof T & string]: T[K] extends (...args: infer Args) => infer R
    ? Args["length"] extends 0
      ? (params?: undefined, options?: RpcCallOptions) => Promise<Awaited<R>>
      : [Args[0]] extends [void | undefined]
        ? (params?: undefined, options?: RpcCallOptions) => Promise<Awaited<R>>
        : (params: Args[0], options?: RpcCallOptions) => Promise<Awaited<R>>
    : never;
};
````

**RPC behavior under disconnect:**

| `onDisconnect` | In-flight (already sent) | Unsent calls (while disconnected)                                 |
| -------------- | ------------------------ | ----------------------------------------------------------------- |
| `"fail"`       | Rejected immediately     | Rejected with `not_connected`                                     |
| `"pause"`      | Rejected immediately     | Queued up to `disconnectBufferLimitBytes`; then `buffer_overflow` |

When state reaches `"closed"`, all pending/queued calls are rejected with `peer_closed`.

### 6.8 EventsInterface

```typescript
interface EventsInterface {
  /**
   * Send a fire-and-forget event. Synchronous; returns void.
   * Throws PeerError{ code: "invalid_pattern" } synchronously on invalid event name.
   * Outbound events are buffered up to eventPolicy.maxBufferedEvents while
   * disconnected. Oldest events are evicted silently on overflow.
   * Events are discarded silently on close.
   */
  emit(eventName: string, data?: unknown): void;

  /**
   * Subscribe to an exact event name. Returns idempotent Unsubscribe.
   * Throws PeerError{ code: "invalid_pattern" } synchronously on wildcard patterns
   * (use onPattern() for those). Subscriptions survive reconnects.
   */
  on(eventName: string, handler: (data: unknown) => void): Unsubscribe;

  /**
   * Subscribe to events matching a NATS-style pattern.
   * Pattern matching is client-side.
   * Throws PeerError{ code: "invalid_pattern" } synchronously on invalid pattern.
   * Returns idempotent Unsubscribe.
   */
  onPattern(
    pattern: string,
    handler: (eventName: string, data: unknown) => void,
  ): PatternSubscription;
}

type PatternSubscription = Unsubscribe;
```

**Pattern syntax (NATS-style):**

| Token | Meaning                                        | Example                          |
| ----- | ---------------------------------------------- | -------------------------------- |
| `*`   | Exactly one segment                            | `user.*` → `user.created`        |
| `>`   | One or more trailing segments (final pos only) | `metrics.>` → `metrics.cpu.load` |
| `**`  | Rejected — use `>` instead                     | —                                |

Valid characters in segment tokens: `A-Z`, `a-z`, `0-9`, `-`, `_`. Case-sensitive. Max 255 UTF-8 bytes.

### 6.9 AcceptedPeer

`AcceptedPeer` is the server-side view of a connection. It is handed to `ListenOptions.onConnection` after negotiation completes.

```typescript
interface AcceptedPeer {
  readonly state: "active" | "paused" | "closed";
  readonly connected: boolean; // state === "active" || state === "paused"
  readonly ready: boolean; // state === "active"
  /** Remote peer ID — matches the key in PeerServer.connections. */
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
```

Key differences from `Peer`: no `connect()`, no `reconnecting`, narrower state union. `disconnect()` is always a hard close even when `state === "paused"`. Starts in `"active"` immediately after `onConnection` is called.

### 6.10 Server Listening

```typescript
interface ListenOptions {
  /** Endpoint to listen on, e.g. "ws://0.0.0.0:8080". */
  endpoint: string;

  /**
   * Called for each accepted connection after negotiation.
   * peer is always in "active" state at the time of the callback.
   */
  onConnection: (peer: AcceptedPeer) => void | Promise<void>;

  /**
   * Session negotiator. Defaults to sbpNegotiator().
   * Pass sbrpDaemonNegotiator(...) for E2EE relay mode (Phase 5).
   */
  negotiator?: Negotiator;
  transport?: Transport;
  peerId?: string;
  rpcPolicy?: Partial<RpcPolicy>;
  eventPolicy?: Partial<EventPolicy>;
  onUnhandledError?: (error: Error) => void;
}

interface PeerServer {
  /** The address the server is listening on. */
  readonly address: string;
  /** All currently-connected accepted peers, keyed by remote PeerId. */
  readonly connections: ReadonlyMap<string, AcceptedPeer>;
  /**
   * Hard shutdown. Transitions all AcceptedPeer instances to "closed",
   * severs transports. Idempotent.
   */
  close(): Promise<void>;
}
```

---

## 7. Error Taxonomy

### 7.1 Error Class Hierarchy

```typescript
/** Base error for all peer SDK errors. */
class PeerError extends Error {
  readonly code: PeerErrorCode;
  readonly details?: Record<string, unknown>;
}

/** Transport-layer errors (WebSocket close, network failure). */
class TransportPeerError extends PeerError {}

/** Protocol-layer errors (handshake failure, version mismatch). */
class ProtocolPeerError extends PeerError {}

/** RPC-layer errors (timeout, cancellation, handler error). */
class RpcPeerError extends PeerError {}

/** SBRP-layer errors (identity mismatch, key storage). Phase 5. */
class SbrpPeerError extends PeerError {}
```

### 7.2 Error Codes

```typescript
const PeerErrorCode = {
  /** Peer is closed (terminal state). */
  PeerClosed: "peer_closed",
  /** rpc.handle() called for a method that already has a handler. */
  RpcMethodAlreadyRegistered: "rpc_method_already_registered",
  /** RPC call cancelled via AbortSignal. */
  RpcCancelled: "rpc_cancelled",
  /** RPC call exceeded timeoutMs. */
  RpcTimeout: "rpc_timeout",
  /** Remote RPC handler returned an error. */
  RpcError: "rpc_error",
  /** Invalid NATS pattern or event name (onPattern, on, emit). */
  InvalidPattern: "invalid_pattern",
  /** Key storage I/O failure (SBRP only, Phase 5). */
  KeyStorageError: "key_storage_error",
  /** Outbound RPC buffer full (onDisconnect: "pause" only). */
  BufferOverflow: "buffer_overflow",
  /** Peer exists but is not connected or is reconnecting. */
  NotConnected: "not_connected",
  /** connect() called from a state that does not allow it. */
  InvalidState: "invalid_state",
  /** Operation cancelled via AbortSignal (non-RPC, e.g. whenReady). */
  Cancelled: "cancelled",
} as const;

type PeerErrorCode = (typeof PeerErrorCode)[keyof typeof PeerErrorCode];
```

Wire-layer numeric codes are available in `error.details.wireCode` when applicable.

### 7.3 Error Handling Patterns

```typescript
// Global handler for fatal/unhandled errors
peer.on("error", (error) => {
  logger.error("Peer error", { code: error.code, details: error.details });
});

// RPC with typed catch
try {
  const result = await peer.rpc.call<User>("user.get", { id: "123" });
} catch (error) {
  if (error instanceof PeerError) {
    if (error.code === "rpc_timeout") return retry();
    if (error.code === "rpc_error")
      console.warn("Remote error:", error.message);
  }
  throw error;
}

// Non-throwing RPC
const result = await peer.rpc.tryCall<User>("user.get", { id: "123" });
if (result.ok) {
  console.log(result.value);
} else {
  console.error(result.error.code);
  if (result.reconnected) {
    // Connection was lost and restored during the call; decide retry based on idempotency
  }
}
```

---

## 8. Observability

`onUnhandledError` (in `PeerOptions` and `ListenOptions`) is the v1 observability hook — it captures errors that have no other delivery path (e.g. event handler throws). A `PeerObserver` interface for OpenTelemetry-style instrumentation (state transitions, RPC durations, metrics) is deferred to v2.

---

## 9. Reconnection Semantics

### 9.1 What Reconnection Does

| Behavior               | Description                                      |
| ---------------------- | ------------------------------------------------ |
| Transport reconnect    | WebSocket closes → SDK reconnects after backoff  |
| Session re-negotiation | Full SBP/SBRP handshake on each reconnect (v1)   |
| Handler preservation   | RPC handlers and subscriptions survive reconnect |
| State reset            | In-flight RPCs fail or remain pending per policy |

### 9.2 What Reconnection Does NOT Do (v1)

| Behavior              | Why Not                                                          |
| --------------------- | ---------------------------------------------------------------- |
| Session resume        | Protocol v1 doesn't support resumption (except SBRP daemon-side) |
| RPC retry             | Application must decide retry policy                             |
| Message replay        | Fire-and-forget events are lost if not delivered                 |
| Exactly-once delivery | Out of scope; use RPC for confirmation                           |

### 9.3 Reconnection Handling

```typescript
// Wait for current reconnection cycle
if (peer.reconnecting) {
  const outcome = await peer.reconnecting;
  if (outcome.status === "connected") {
    // Retry failed operations
  } else if (outcome.status === "failed") {
    showError(outcome.error);
  }
}

// RPC with reconnection awareness
const result = await peer.rpc.tryCall("save", data);
if (!result.ok && result.reconnected) {
  // Connection dropped and restored during this call.
  // Request may or may not have been delivered before the drop.
  // Decide retry based on operation idempotency.
}
```

### 9.4 SBRP Session Pause/Resume

In relay mode, when the daemon disconnects from the relay, the peer transitions to `"paused"` — the SBRP session is logically alive but traffic cannot flow.

**State model during pause:**

- `peer.state === "paused"` (distinct state, not a flag)
- `peer.connected === true` (session is alive)
- `peer.ready === false` (traffic cannot flow)
- `stateChange` event fires (`"active"` → `"paused"`)
- `sessionPaused` event fires
- RPC calls remain pending (up to limits) if `onDisconnect: "pause"`
- RPC calls fail immediately if `onDisconnect: "fail"` (default)

**Buffering ownership model:**

| Layer  | Buffering responsibility                                   |
| ------ | ---------------------------------------------------------- |
| SDK    | Client-side buffer (authoritative); enforces all limits    |
| Relay  | Best-effort forwarding; may drop if overwhelmed            |
| Daemon | Server-side buffer for paused clients (SBRP daemon config) |

**Pause lifecycle:**

1. Relay sends `session_paused` control frame to client
2. SDK transitions `"active"` → `"paused"`; emits `stateChange` and `sessionPaused`
3. Outbound messages buffered client-side (up to `maxBufferedEvents`)
4. When daemon reconnects, relay sends `session_resumed`
5. SDK transitions `"paused"` → `"active"`; emits `stateChange` and `sessionResumed`
6. Buffered messages sent; pending RPC calls continue waiting for response

If the session expires (daemon does not reconnect in time), the peer transitions to `"reconnecting"` or `"closed"` per policy.

---

## 10. Security Model (SBRP — Phase 5)

SBRP (Sideband Bridge Relay Protocol) provides end-to-end encryption over an untrusted relay. Phase 5 implements this on top of the existing peer lifecycle.

### 10.1 Threat Model

| Threat                        | Mitigation                                         |
| ----------------------------- | -------------------------------------------------- |
| **Relay reads content**       | E2EE via ChaCha20-Poly1305                         |
| **Relay impersonates daemon** | Ed25519 signatures; TOFU pinning                   |
| **MITM intercepts handshake** | Ephemeral X25519 signed by identity key            |
| **Replay attacks**            | Sequence numbers + 128-bit sliding window          |
| **Daemon key compromise**     | `onIdentityMismatch` callback for user decision    |
| **Silent auto-accept**        | `trustPolicy: "prompt"` requires explicit callback |

### 10.2 What's Encrypted vs. Visible

| Data                   | Encrypted | Visible to Relay |
| ---------------------- | --------- | ---------------- |
| RPC method names       | Yes       | No               |
| RPC parameters/results | Yes       | No               |
| Event names/data       | Yes       | No               |
| Message timing         | —         | Yes              |
| Message size           | —         | Yes              |
| Daemon ID              | —         | Yes              |
| Session ID             | —         | Yes              |

### 10.3 Negotiator API (Phase 5)

```typescript
// Client-side (browser / CLI)
function sbrpClientNegotiator(options: SbrpClientOptions): Negotiator;

// Server-side (daemon connecting to relay)
function sbrpDaemonNegotiator(options: SbrpDaemonOptions): Negotiator;
```

The old single `sbrpNegotiator()` was never shipped. Client and daemon roles require distinct negotiators because their handshake responsibilities differ (client verifies daemon identity; daemon presents identity and registers with relay).

### 10.4 TOFU Trust Policies

| Policy     | First Connection  | Mismatch      | Use Case             |
| ---------- | ----------------- | ------------- | -------------------- |
| `"auto"`   | Auto-accept, warn | Call callback | Development only     |
| `"prompt"` | Require callback  | Call callback | Production (default) |
| `"strict"` | Reject if no pin  | Abort         | High-security        |

```typescript
// Development: auto-accept (NOT RECOMMENDED for production)
const peer = createPeer({
  endpoint: "wss://relay.example.com",
  negotiator: sbrpClientNegotiator({
    daemonId: "dev-daemon",
    keyStorage,
    trustPolicy: "auto",
  }),
});

// Production: require explicit acceptance
const peer = createPeer({
  endpoint: "wss://relay.example.com",
  negotiator: sbrpClientNegotiator({
    daemonId: "prod-daemon",
    keyStorage,
    trustPolicy: "prompt",
    onFirstConnection: ({ fingerprint }) => {
      return showConfirmDialog(`Trust daemon ${fingerprint}?`);
    },
  }),
});

// High-security: pre-provisioned keys only
const peer = createPeer({
  endpoint: "wss://relay.example.com",
  negotiator: sbrpClientNegotiator({
    daemonId: "secure-daemon",
    keyStorage, // Must already contain the pinned key
    trustPolicy: "strict",
  }),
});
```

### 10.5 TOFU Lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│                     First Connection                              │
│  1. SDK checks keyStorage for pinned key                          │
│  2. No pin found:                                                 │
│     - "auto": Accept, pin, emit warning                           │
│     - "prompt": Call onFirstConnection (REQUIRED)                 │
│     - "strict": Abort with key_storage_error                      │
│  3. Events: stateChange → sessionPaused/active                    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Subsequent Connections                          │
│  1. SDK checks keyStorage for pinned key                          │
│  2. Pin found; compare against daemon's key from handshake        │
│  3a. Match → connection proceeds normally                         │
│  3b. Mismatch → call onIdentityMismatch() callback                │
│      - "strict": Abort (callback not called)                      │
│      - "auto"/"prompt": Call callback, default abort              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 11. Usage Examples

### 11.1 UC1: Local Development

**Browser (Client):**

```typescript
import { createPeer, sbpNegotiator } from "@sideband/peer";

using peer = createPeer({
  endpoint: "ws://localhost:8080",
  negotiator: sbpNegotiator(),
});

const unsub = peer.events.on("file.changed", (data) => {
  const { path, event } = data as { path: string; event: string };
  console.log(`${event}: ${path}`);
  location.reload();
});

peer.on("error", (error) => {
  console.error("Peer error:", error.code);
});

await peer.connect();
```

**Local Daemon (Server):**

```typescript
import { listen } from "@sideband/peer";
import { watch } from "fs";

const server = await listen({
  endpoint: "ws://0.0.0.0:8080",
  onConnection(peer) {
    peer.rpc.handle<{ path: string }, { content: string }>(
      "file.read",
      async ({ path }) => {
        return { content: await Bun.file(path).text() };
      },
    );

    peer.rpc.handle<{ path: string; content: string }, { success: boolean }>(
      "file.write",
      async ({ path, content }) => {
        await Bun.write(path, content);
        return { success: true };
      },
    );

    const watcher = watch("./src", { recursive: true }, (event, path) => {
      peer.events.emit("file.changed", { event, path });
    });

    peer.on("disconnected", () => watcher.close());
  },
});

console.log("Listening on", server.address);
```

### 11.2 UC2: E2EE Relay (Phase 5)

**Browser (Client):**

```typescript
import { createPeer, sbrpClientNegotiator } from "@sideband/peer";

const peer = createPeer({
  endpoint: "wss://relay.sideband.cloud",
  negotiator: sbrpClientNegotiator({
    daemonId: "daemon-prod-001",
    keyStorage: createBrowserKeyStorage(),
    trustPolicy: "prompt",
    onFirstConnection: ({ fingerprint }) => {
      return showConfirmDialog(`Trust daemon ${fingerprint}?`);
    },
    onIdentityMismatch: ({ expected, received }) => {
      return showSecurityDialog({
        title: "Security Warning",
        message: `Daemon identity changed!\nExpected: ${expected}\nReceived: ${received}`,
      });
    },
  }),
});

peer.on("sessionPaused", () => showToast("Daemon offline, waiting..."));
peer.on("sessionResumed", () => showToast("Daemon reconnected"));

await peer.connect();

const status = await peer.rpc.call("system.status");
```

**Cloud Daemon:**

```typescript
import { createPeer, sbrpDaemonNegotiator } from "@sideband/peer";

const peer = createPeer({
  endpoint: "wss://relay.sideband.cloud",
  negotiator: sbrpDaemonNegotiator({
    daemonId: process.env.DAEMON_ID!,
    serverIdentity: await loadIdentityKeyPair("./daemon-identity.key"),
  }),
});

peer.rpc.handle("system.status", () => ({
  version: "1.0.0",
  uptime: process.uptime(),
  memory: process.memoryUsage(),
}));

await peer.connect();
console.log("Daemon connected to relay");
```

### 11.3 UC3: Typed RPC

```typescript
// shared/api.ts — shared type definitions
export interface DaemonApi {
  "user.get": (params: { id: string }) => {
    id: string;
    name: string;
    email: string;
  };
  "user.list": (params: void) => { users: User[]; total: number };
  "user.update": (params: { id: string; data: Partial<User> }) => {
    success: boolean;
  };
}

// client.ts — browser
import type { DaemonApi } from "./shared/api";
import { createPeer, sbpNegotiator } from "@sideband/peer";

const peer = createPeer({ endpoint: "ws://localhost:8080" });
await peer.connect();

const api = peer.rpc.client<DaemonApi>();

const user = await api["user.get"]({ id: "123" });
//    ^? { id: string; name: string; email: string }

const { users, total } = await api["user.list"]();
//      ^? User[]

// server.ts — daemon
const server = await listen({
  endpoint: "ws://0.0.0.0:8080",
  onConnection(peer) {
    peer.rpc.handle<{ id: string }>("user.get", ({ id }) =>
      db.users.findById(id),
    );

    peer.rpc.handle("user.list", () =>
      db.users.all().then((users) => ({ users, total: users.length })),
    );
  },
});
```

---

## 12. References

### Internal

- [ADR-002: Naming Matrix](../adr/002-naming-matrix.md)
- [ADR-006: RPC Envelope](../adr/006-rpc-envelope.md)
- [ADR-009: Runtime Peer Lifecycle](../adr/009-runtime-peer-lifecycle.md)
- [ADR-010: RPC Correlation](../adr/010-rpc-correlation-cid.md)
- [ADR-011: Runtime Message Routing](../adr/011-runtime-message-routing.md)
- [ADR-012: WebSocket Transport Design](../adr/012-websocket-transport-design.md)
- [Project Structure](../architecture/project-structure.md)
- [SBP Protocol](../protocols/sbp/)
- [SBRP Protocol](../protocols/sbrp/)
- [RPC Spec](../protocols/rpc/)

### External

- [Socket.IO Client API](https://socket.io/docs/v4/client-api/) — Event patterns, reconnection
- [Phoenix Channels](https://hexdocs.pm/phoenix/channels.html) — Push/receive, presence
- [Ably Realtime](https://ably.com/docs/api/realtime-sdk) — Connection states, error handling
- [libp2p JavaScript](https://github.com/libp2p/js-libp2p) — Peer identity, protocols
