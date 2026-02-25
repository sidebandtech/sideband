# RFC: @sideband/peer SDK

**Status:** Active
**Created:** 2026-01-13
**Updated:** 2026-02-25

## 1. Summary

`@sideband/peer` is a high-level SDK providing a developer-friendly API for real-time applications on the Sideband stack. It wraps `@sideband/runtime`, `@sideband/transport-ws`, and `@sideband/secure-relay` with three core capabilities:

- **Connection lifecycle** — Connect, reconnect, disconnect with observable state
- **RPC** — Type-safe remote procedure calls with correlation and timeouts
- **Events** — Fire-and-forget events with subject-based routing

**Target Developer:**

> Developers who start on localhost and expect to graduate to secure remote access without rewriting their stack.

This includes indie developers building local-first tools (AI agents, dev tools, desktop apps) who need browser↔daemon communication today, and secure relay access tomorrow.

---

## 2. Use Cases

### UC1: Local Development (Browser ↔ Local Daemon)

```text
Browser (UI) ←—— WebSocket ——→ Local Daemon (localhost:8080)
```

Direct WebSocket on loopback. Fast reconnection on daemon restart. Bidirectional RPC. No E2EE required.

### UC2: Remote Management (Browser ↔ Cloud Daemon via E2EE Relay)

```text
Browser ←—— E2EE (SBRP) ——→ Relay Server ←—— E2EE (SBRP) ——→ Cloud Daemon
```

End-to-end encrypted via ChaCha20-Poly1305 over an untrusted relay. TOFU identity pinning. Session pause/resume when daemon temporarily disconnects.

### UC3: Service Mesh (Daemon ↔ Daemon)

```text
Daemon A ←—— WebSocket/TCP ——→ Daemon B
```

Server-side listening, multiple concurrent connections. Application-level E2EE optional.

---

## 3. Out of Scope

- Data synchronization / CRDTs
- Service discovery (peers must know endpoints upfront)
- Multi-party group communication (point-to-point only)
- Offline-first / message queuing
- Streaming RPC
- Built-in presence

---

## 4. Design Principles

### 4.1 Layered Architecture

| Component          | Responsibility                                          |
| ------------------ | ------------------------------------------------------- |
| **PeerConnection** | Transport lifecycle, reconnection, negotiation          |
| **RpcClient**      | Request/response correlation, typed methods             |
| **Events**         | Fire-and-forget event emission and listening            |
| **Peer**           | Coordinator exposing the three above; no business logic |

### 4.2 Explicit Negotiator Selection

The negotiator determines the session protocol (SBP for direct, SBRP for relay). This is security-critical — URL-based auto-detection is deliberately avoided. Security posture must be explicit and auditable. Defaults to `sbpNegotiator()` for direct connections. See ADR-013.

### 4.3 Fail Fast

Invalid configuration and programming errors throw synchronously at the call site:

```typescript
peer.rpc.handle("user.get", handlerA);
peer.rpc.handle("user.get", handlerB); // PeerError{ code: "rpc_method_already_registered" }
```

---

## 5. Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        @sideband/peer                           │
│                                                                 │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │ PeerConnection  │  │  RpcClient   │  │      Events       │   │
│  │  (lifecycle +   │  │  (request/   │  │     (emit/on,     │   │
│  │   negotiation)  │  │   response)  │  │    fire-forget)   │   │
│  └────────┬────────┘  └──────┬───────┘  └─────────┬─────────┘   │
│           │                  │                    │             │
│  ┌────────┴──────────────────┴────────────────────┴──────────┐  │
│  │                         Peer                              │  │
│  │  (coordinator: wires connection + router + correlation)   │  │
│  └────────┬──────────────────────────────────────────────────┘  │
│           │                                                     │
│  ┌────────┴─────────────┐              ┌─────────────────────┐  │
│  │     Negotiator       │              │      Transport      │  │
│  │  (SBP or SBRP)       │              │    (WebSocket)      │  │
│  └──────────────────────┘              └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                                        │
         ▼                                        ▼
  @sideband/runtime                    @sideband/transport-ws
  @sideband/secure-relay               @sideband/transport
  @sideband/rpc                        @sideband/protocol
```

| Component          | Responsibility                                   |
| ------------------ | ------------------------------------------------ |
| **Peer**           | Wire components together; expose namespaces      |
| **PeerConnection** | Transport lifecycle; state machine; reconnection |
| **RpcClient**      | Correlation; typed clients; timeouts             |
| **Events**         | Subscriptions; client-side filtering             |
| **Negotiator**     | Session establishment (SBP/SBRP)                 |

---

## 6. API Reference

### 6.1 Factory Functions

```typescript
// Core factory
function createPeer(options: PeerOptions): Peer;

// Server — import from "@sideband/peer/server" (Node/Bun only)
function listen(options: ListenOptions): Promise<PeerServer>;

// Negotiator factories
function sbpNegotiator(opts?: {
  peerId?: string;
  capabilities?: string[];
  handshakeTimeoutMs?: number;
}): Negotiator;
// sbrpClientNegotiator / sbrpDaemonNegotiator — see §10

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
   * Pass sbrpClientNegotiator(...) for E2EE relay mode.
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
   *   rejected on disconnect. In-flight calls are not preserved across reconnects;
   *   applications must implement retry or idempotency if required.
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
   * Legal from "idle" (starts connection), "connecting", or "negotiating"
   * (returns the in-progress Promise). Throws synchronously from "active",
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

```text
idle → connecting → negotiating → active ↔ paused
active | paused | connecting | negotiating → reconnecting → connecting → …
any → closed  (terminal)
```

`"reconnecting"` creates `peer.reconnecting` promise (one per cycle).
`"paused"` does not create a `reconnecting` promise — the session is alive.

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
   * reconnected: true means the peer was not in "active" state when the call
   * was initiated (e.g., buffered before first connect or across a reconnect).
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

`AcceptedPeer` is the server-side view of a connection, handed to `ListenOptions.onConnection` after negotiation completes.

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
   * Pass sbrpDaemonNegotiator(...) for E2EE relay mode.
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

/** RPC-layer errors (timeout, cancellation, handler error). */
class RpcPeerError extends PeerError {}
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
  /** Outbound RPC buffer full (onDisconnect: "pause" only). */
  BufferOverflow: "buffer_overflow",
  /** Peer exists but is not connected or is reconnecting. */
  NotConnected: "not_connected",
  /** Send blocked because the session is temporarily paused by the relay. */
  SessionPaused: "session_paused",
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
    // Connection was lost and restored during this call; decide retry based on idempotency
  }
}
```

---

## 8. Observability

`onUnhandledError` (in `PeerOptions` and `ListenOptions`) is the observability hook — it captures errors that have no other delivery path (e.g. event handler throws). A `PeerObserver` interface for OpenTelemetry-style instrumentation is out of scope.

---

## 9. Reconnection Semantics

### 9.1 What Reconnection Does

| Behavior               | Description                                                                    |
| ---------------------- | ------------------------------------------------------------------------------ |
| Transport reconnect    | WebSocket closes → SDK reconnects after backoff                                |
| Session re-negotiation | Full SBP/SBRP handshake on each reconnect                                      |
| Handler preservation   | RPC handlers and subscriptions survive reconnect                               |
| State reset            | In-flight RPCs always fail; unsent calls buffer or fail per `connectionPolicy` |

### 9.2 Reconnection Handling

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
  // Peer was not active when the call was initiated.
  // Request may or may not have been delivered.
  // Decide retry based on operation idempotency.
}
```

### 9.3 SBRP Session Pause/Resume

In relay mode, when the daemon disconnects from the relay, the peer transitions to `"paused"` — the SBRP session is logically alive but traffic cannot flow.

**State model during pause:**

- `peer.state === "paused"` (distinct state, not a flag)
- `peer.connected === true` (session is alive)
- `peer.ready === false` (traffic cannot flow)
- `stateChange` event fires (`"active"` → `"paused"`)
- `sessionPaused` event fires
- RPC calls remain pending (up to limits) if `onDisconnect: "pause"`
- RPC calls fail immediately if `onDisconnect: "fail"` (default)

**Buffering ownership:**

| Layer      | Responsibility                                             |
| ---------- | ---------------------------------------------------------- |
| **SDK**    | Client-side buffer (authoritative); enforces all limits    |
| **Relay**  | Best-effort forwarding; may drop if overwhelmed            |
| **Daemon** | Server-side buffer for paused clients (SBRP daemon config) |

**Pause lifecycle:**

1. Relay sends `session_paused` control frame to client
2. SDK transitions `"active"` → `"paused"`; emits `stateChange` and `sessionPaused`
3. Outbound events buffered client-side (up to `eventPolicy.maxBufferedEvents`); unsent RPC calls buffered up to `rpcPolicy.disconnectBufferLimitBytes` if `onDisconnect: "pause"`
4. When daemon reconnects, relay sends `session_resumed`
5. SDK transitions `"paused"` → `"active"`; emits `stateChange` and `sessionResumed`
6. Buffered messages sent; pending RPC calls continue waiting for response

If the session expires (daemon does not reconnect in time), the peer transitions to `"reconnecting"` or `"closed"` per policy.

---

## 10. Security Model (SBRP)

SBRP (Sideband Bridge Relay Protocol) provides end-to-end encryption over an untrusted relay, built on top of the existing peer lifecycle.

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

### 10.3 Negotiator API

```typescript
// Client-side (browser / CLI)
function sbrpClientNegotiator(options: SbrpClientOptions): Negotiator;

// Server-side (daemon connecting to relay)
function sbrpDaemonNegotiator(options: SbrpDaemonOptions): Negotiator;
```

Client and daemon roles use distinct negotiators because their handshake responsibilities differ: the client verifies daemon identity via TOFU, while the daemon presents its identity key pair and registers with the relay. See ADR-013.

### 10.4 TOFU Trust Policies

| Policy     | First Connection | Mismatch                                       | Use Case             |
| ---------- | ---------------- | ---------------------------------------------- | -------------------- |
| `"auto"`   | Auto-accept      | Silent re-pin                                  | Development only     |
| `"prompt"` | Require callback | Call `onIdentityMismatch()`, abort if rejected | Production (default) |
| `"strict"` | Reject if no pin | Abort                                          | High-security        |

```typescript
// Development: auto-accept (NOT RECOMMENDED for production)
const peer = createPeer({
  endpoint: "wss://relay.example.com",
  negotiator: sbrpClientNegotiator({
    daemonId: "dev-daemon",
    sessionId,
    identityKeyStore,
    trustPolicy: "auto",
  }),
});

// Production: require explicit acceptance
const peer = createPeer({
  endpoint: "wss://relay.example.com",
  negotiator: sbrpClientNegotiator({
    daemonId: "prod-daemon",
    sessionId,
    identityKeyStore,
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
    sessionId,
    identityKeyStore, // Must already contain the pinned key
    trustPolicy: "strict",
  }),
});
```

### 10.5 TOFU Lifecycle

```text
┌──────────────────────────────────────────────────────────────────┐
│                     First Connection                             │
│  1. SDK checks identityKeyStore for pinned key                   │
│  2. No pin found:                                                │
│     - "auto": Accept, pin, emit warning                          │
│     - "prompt": Call onFirstConnection (REQUIRED)                │
│     - "strict": Abort with handshake_failed                      │
│  3. State transitions to "active" via stateChange event          │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Subsequent Connections                         │
│  1. SDK checks identityKeyStore for pinned key                   │
│  2. Pin found; compare against daemon's key from handshake       │
│  3a. Match → connection proceeds normally                        │
│  3b. Mismatch:                                                   │
│      - "strict": Abort (no callback)                             │
│      - "prompt": Call onIdentityMismatch(), abort if rejected    │
│      - "auto": Silent re-pin (no callback)                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 11. Usage Examples

### 11.1 Local Development

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
import { listen } from "@sideband/peer/server";
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

### 11.2 E2EE Relay

**Browser (Client):**

```typescript
import { createPeer } from "@sideband/peer";
import {
  sbrpClientNegotiator,
  createMemoryIdentityKeyStore,
} from "@sideband/peer/sbrp";

// relayUrl and sessionToken from POST /api/sessions
const { relayUrl, token: sessionToken } = await api.createSession({
  daemonId: "daemon-prod-001",
});

const peer = createPeer({
  endpoint: relayUrl, // e.g. wss://eu-1.relay.sideband.cloud
  negotiator: sbrpClientNegotiator({
    daemonId: "daemon-prod-001",
    sessionToken,
    identityKeyStore: createMemoryIdentityKeyStore(),
    trustPolicy: "prompt",
    onFirstConnection: ({ fingerprint }) => {
      return showConfirmDialog(`Trust daemon ${fingerprint}?`);
    },
    onIdentityMismatch: ({ expectedFingerprint, receivedFingerprint }) => {
      return showSecurityDialog({
        title: "Security Warning",
        message: `Daemon identity changed!\nExpected: ${expectedFingerprint}\nReceived: ${receivedFingerprint}`,
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
import { createPeer } from "@sideband/peer";
import { sbrpDaemonNegotiator } from "@sideband/peer/sbrp";

const peer = createPeer({
  endpoint: "wss://relay.sideband.cloud",
  negotiator: sbrpDaemonNegotiator({
    daemonId: process.env.DAEMON_ID!,
    identityKeyPair: await loadIdentityKeyPair("./daemon-identity.key"),
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

---

## 12. References

- [ADR-006: RPC Envelope](../adr/006-rpc-envelope.md)
- [ADR-009: Runtime Peer Lifecycle](../adr/009-runtime-peer-lifecycle.md)
- [ADR-010: RPC Correlation](../adr/010-rpc-correlation-cid.md)
- [ADR-011: Runtime Message Routing](../adr/011-runtime-message-routing.md)
- [ADR-012: WebSocket Transport Design](../adr/012-websocket-transport-design.md)
- [ADR-013: Peer SDK Design](../adr/013-peer-sdk-design.md)
- [Project Structure](../architecture/project-structure.md)
- [SBP Protocol](../protocols/sbp/)
- [SBRP Protocol](../protocols/sbrp/)
- [RPC Spec](../protocols/rpc/)
