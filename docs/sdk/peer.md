# RFC: @sideband/peer SDK

**Status:** Draft
**Created:** 2026-01-13
**Updated:** 2026-01-14

## 1. Summary

`@sideband/peer` is a high-level SDK providing a developer-friendly API for real-time applications on the Sideband stack. It wraps `@sideband/runtime`, `@sideband/transport-ws`, and `@sideband/secure-relay` with three core capabilities:

- **Connection lifecycle** — Connect, reconnect, disconnect with observable state
- **RPC** — Type-safe remote procedure calls with correlation and timeouts
- **Events** — Fire-and-forget events with subject-based routing

**Target Developer:**

> Developers who start on localhost and expect to graduate to secure remote access without rewriting their stack.

This includes indie developers building local-first tools (AI agents, dev tools, desktop apps) who need browser↔daemon communication today, and secure relay access tomorrow.

**Design Goals:**

1. Progressive disclosure: `createDirectPeer()` for localhost, explicit negotiators for relay
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
// Direct mode: explicit sbpNegotiator()
const peer = createPeer({
  endpoint: "ws://localhost:8080",
  negotiator: sbpNegotiator(),
});

// Relay mode: explicit sbrpNegotiator() with required options
const peer = createPeer({
  endpoint: "wss://relay.example.com",
  negotiator: sbrpNegotiator({
    daemonId: "my-daemon",
    keyStorage: createBrowserKeyStorage(),
  }),
});
```

**Why no auto-detection:**

- URL patterns are unreliable (self-hosted relays, TLS for direct P2P)
- Security posture should be explicit and auditable
- Enables future protocols (TURN, QUIC+SBRP) without API changes

### 4.3 Progressive Disclosure with Sugar Wrappers

For common patterns, sugar wrappers reduce boilerplate while keeping behavior explicit:

```typescript
// Sugar: createDirectPeer() = createPeer() + sbpNegotiator()
const peer = createDirectPeer({
  endpoint: "ws://localhost:8080",
  reconnect: true,
});

// Sugar: createRelayPeer() = createPeer() + sbrpNegotiator()
const peer = createRelayPeer({
  endpoint: "wss://relay.example.com",
  sbrp: { daemonId: "my-daemon", keyStorage },
});
```

### 4.4 Type Safety Without Ceremony

Full TypeScript inference without requiring manual casts:

```typescript
interface Api {
  getUser: { params: { id: string }; result: User };
  listUsers: { params: void; result: User[] }; // No params
}

const api = peer.rpc.client<Api>();
const user = await api.getUser({ id: "123" }); // user: User inferred
const users = await api.listUsers(); // No params required
```

### 4.5 Fail Fast, Fail Loud

Invalid configuration throws synchronously at construction:

```typescript
// Throws: "trustPolicy 'prompt' requires onFirstConnection callback"
createPeer({
  endpoint: "wss://relay.example.com",
  negotiator: sbrpNegotiator({
    daemonId: "x",
    keyStorage,
    trustPolicy: "prompt", // But no callback provided
  }),
});
```

### 4.6 Policy vs Mechanism Separation

Behavior is configurable via policy objects, not hardcoded:

```typescript
const peer = createPeer({
  endpoint: "ws://localhost:8080",
  negotiator: sbpNegotiator(),
  // Override default policies
  rpcPolicy: { defaultTimeoutMs: 5_000 },
  eventPolicy: { maxPatternSubscriptions: 100 },
  connectionPolicy: { onDisconnect: "pause" },
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
// ─── Core Factory (Explicit Negotiator Required) ───────────────

function createPeer(options: PeerOptions): Peer;

// ─── Sugar Wrappers ────────────────────────────────────────────

/** Direct connection with SBP negotiator */
function createDirectPeer(options: DirectPeerOptions): Peer;

/** E2EE relay connection with SBRP negotiator */
function createRelayPeer(options: RelayPeerOptions): Peer;

// ─── Server ────────────────────────────────────────────────────

function listen(options: ListenOptions): Promise<PeerServer>;

// ─── Negotiator Factories ──────────────────────────────────────

function sbpNegotiator(options?: SbpNegotiatorOptions): Negotiator;
function sbrpNegotiator(options: SbrpNegotiatorOptions): Negotiator;

// ─── Endpoint Helpers (Validation Only) ────────────────────────

function wsEndpoint(url: string, options?: WsEndpointOptions): WsEndpoint;
```

### 6.2 PeerOptions

```typescript
interface PeerOptions {
  /**
   * Connection target.
   * String URLs are validated but NOT interpreted for protocol selection.
   */
  endpoint: string | TransportEndpoint;

  /**
   * Session negotiator. REQUIRED.
   * - sbpNegotiator(): Direct SBP handshake (no E2EE)
   * - sbrpNegotiator(): E2EE relay with TOFU identity
   */
  negotiator: Negotiator;

  /** Stable peer identity (auto-generated if omitted) */
  peerId?: PeerId;

  /** Custom transport factory (defaults to platform-detected WebSocket) */
  transport?: TransportFactory;

  /** Per-transport options (e.g., TLS config, buffer limits) */
  transportOptions?: TransportOptions;

  // ─── Policy Objects ──────────────────────────────────────────

  /** Connection/reconnection behavior */
  connectionPolicy?: Partial<ConnectionPolicy>;

  /** RPC defaults and limits */
  rpcPolicy?: Partial<RpcPolicy>;

  /** Event defaults and limits */
  eventPolicy?: Partial<EventPolicy>;

  // ─── Convenience Aliases ─────────────────────────────────────

  /** Shorthand: connectionPolicy.reconnect */
  reconnect?: boolean | ReconnectPolicy;

  /** Shorthand: connectionPolicy.connectTimeoutMs */
  connectTimeoutMs?: number;

  /** Shorthand: rpcPolicy.defaultTimeoutMs */
  rpcTimeoutMs?: number;

  // ─── Observability ───────────────────────────────────────────

  /** Observer for external instrumentation (OpenTelemetry, etc.) */
  observer?: PeerObserver;

  /** Fallback for errors when no listener attached (default: console.warn) */
  onUnhandledError?: ((error: PeerError) => void) | null;
}

// ─── Sugar Wrapper Options ─────────────────────────────────────

interface DirectPeerOptions extends Omit<PeerOptions, "negotiator"> {
  /** SBP negotiator options (optional) */
  sbp?: SbpNegotiatorOptions;
}

interface RelayPeerOptions extends Omit<PeerOptions, "negotiator"> {
  /** SBRP negotiator options (required) */
  sbrp: SbrpNegotiatorOptions;
}
```

### 6.3 Policy Objects

```typescript
// ─── Connection Policy ─────────────────────────────────────────

interface ConnectionPolicy {
  /** Reconnection behavior */
  reconnect: ReconnectPolicy;

  /**
   * Behavior for in-flight operations when connection drops.
   * - "fail": Operations fail immediately with ConnectionClosed (default)
   * - "pause": Operations remain pending, subject to timeout and buffer limits
   *
   * "pause" semantics:
   * - Outbound messages buffered client-side up to pauseBufferLimitBytes
   * - Operations remain pending until response, timeout, or pause expiry
   * - Fails with BufferOverflow if buffer limit exceeded
   * - Fails with PauseTimeout if pauseTimeoutMs exceeded
   *
   * IMPORTANT: "pause" does NOT auto-retry. Sent requests are NOT re-sent.
   * SDK cannot know if a request was delivered before disconnect.
   */
  onDisconnect: "fail" | "pause";

  /** Connection timeout in ms (default: 30_000) */
  connectTimeoutMs: number;

  /**
   * Max buffer for paused operations in bytes (default: 1 MiB).
   * This is the CLIENT-SIDE buffer only. Relay buffering is best-effort.
   */
  pauseBufferLimitBytes?: number;

  /** Max time to pause operations before failing in ms (default: 60_000) */
  pauseTimeoutMs?: number;
}

interface ReconnectPolicy {
  enabled: boolean; // Default: false
  initialDelayMs: number; // Default: 1_000
  maxDelayMs: number; // Default: 30_000
  maxAttempts: number; // Default: Infinity
  jitter: number; // Default: 0.2 (20%)
  /** Classify which errors should trigger reconnect */
  shouldRetry?: (error: PeerError) => boolean;
}

// ─── RPC Policy ────────────────────────────────────────────────

interface RpcPolicy {
  /** Subject channel for all RPC messages (default: "rpc") */
  channel: string;
  /** Default timeout for calls in ms (default: 10_000) */
  defaultTimeoutMs: number;
  /** Max concurrent pending calls (default: 100) */
  maxPendingCalls: number;
  /**
   * Payload codec for RPC requests/responses.
   * - "json": JSON encoding (default, human-readable, debuggable)
   *
   * Note: v1 supports JSON only. CBOR may be added in v2 for binary efficiency.
   */
  codec?: "json";
  /** Error mapper for handler exceptions */
  errorMapper?: (error: Error, context: RpcHandlerContext) => RpcErrorPayload;
}

// ─── Event Policy ─────────────────────────────────────────────

interface EventPolicy {
  /** Subject channel for all event messages (default: "event") */
  channel: string;
  /** Max exact subscriptions per peer (default: 1000) */
  maxSubscriptions: number;
  /**
   * Max pattern subscriptions (default: 50).
   * Pattern matching is O(patterns) per event; this limit prevents accidents.
   */
  maxPatternSubscriptions: number;
  /** Buffer limit for outbound events in bytes (default: 1 MiB) */
  bufferLimitBytes: number;
  /** Behavior when buffer limit exceeded */
  onBufferFull: "drop-oldest" | "drop-newest" | "error";
}
```

### 6.4 Negotiators

```typescript
// ─── SBP: Direct Mode ──────────────────────────────────────────

interface SbpNegotiatorOptions {
  /** Peer identity (auto-generated if omitted) */
  peerId?: PeerId;
  /** Advertised capabilities */
  capabilities?: string[];
  /** Peer metadata */
  metadata?: Record<string, string>;
  /** Handshake timeout in ms (default: 30_000) */
  handshakeTimeoutMs?: number;
}

// ─── SBRP: E2EE Relay Mode ─────────────────────────────────────

/**
 * Key provisioning source - exactly one must be provided.
 * Discriminated union ensures type-safe mutual exclusivity.
 */
type KeySource =
  | {
      /**
       * Daemon's Ed25519 identity public key (32 bytes).
       * Use for pre-provisioned keys (high-security, "strict" trust policy).
       */
      identityKey: Uint8Array;
      controlPlaneUrl?: never;
    }
  | {
      /**
       * Control plane URL for automatic key fetching on first connection.
       * Fetches from: GET {controlPlaneUrl}/daemons/{daemonId}/public-key
       * Must be HTTPS (http:// rejected at construction).
       */
      controlPlaneUrl: string;
      identityKey?: never;
    };

type SbrpNegotiatorOptions = KeySource & {
  /** Target daemon identifier (required) */
  daemonId: string;

  /**
   * Retry policy for controlPlaneUrl key fetch.
   * Default: { maxAttempts: 3, initialDelayMs: 500, maxDelayMs: 5000 }
   */
  keyFetchRetry?: KeyFetchRetryOptions;

  /**
   * Storage for TOFU identity pins.
   * Required for persisting trust across sessions.
   */
  keyStorage: KeyStorage;

  /** Client identity keypair (auto-generated if omitted) */
  clientIdentity?: IdentityKeyPair;

  // ─── Trust Policy ────────────────────────────────────────────

  /**
   * Trust policy for new daemon connections.
   * - "auto": Auto-accept new keys (development only; NOT recommended)
   * - "prompt": Require explicit confirmation via onFirstConnection (default)
   * - "strict": Reject unpinned connections; keys must be pre-provisioned
   *
   * Default: "prompt"
   */
  trustPolicy?: TrustPolicy;

  /**
   * Callback for "prompt" policy when connecting to unpinned daemon.
   * REQUIRED if trustPolicy === "prompt" (the default).
   * Return true to accept and pin, false to abort.
   */
  onFirstConnection?: (info: FirstConnectionInfo) => Promise<boolean>;

  /**
   * Callback when daemon identity changed (pin mismatch).
   * Return true to accept new key (replaces pin), false to abort.
   * Default: abort with identity_mismatch error.
   */
  onIdentityMismatch?: (info: IdentityMismatchInfo) => Promise<boolean>;

  // ─── Daemon-Side Options ─────────────────────────────────────

  /**
   * Server identity keypair (daemon mode only).
   * Required when acting as a daemon accepting client connections.
   */
  serverIdentity?: IdentityKeyPair;

  /**
   * Whether this daemon supports session resumption.
   * - true (default): Daemon tracks session state
   * - false: Sessions auto-expire on disconnect
   */
  resumable?: boolean;

  /**
   * (Daemon-side only) Buffer limit for messages during client pause.
   * When daemon acts as server, this limits buffered messages for
   * clients whose relay connection is paused.
   * Default: 1 MiB
   */
  pauseBufferLimitBytes?: number;

  /**
   * (Daemon-side only) Max duration to buffer messages during pause.
   * After this, session expires and client must reconnect.
   * Default: 60_000 (1 minute)
   */
  maxPauseDurationMs?: number;
};

type TrustPolicy = "auto" | "prompt" | "strict";

interface KeyFetchRetryOptions {
  maxAttempts?: number; // Default: 3
  initialDelayMs?: number; // Default: 500
  maxDelayMs?: number; // Default: 5000
  jitter?: number; // Default: 0.2
}

interface KeyStorage {
  get(daemonId: string): Promise<Uint8Array | null>;
  set(daemonId: string, publicKey: Uint8Array): Promise<void>;
  delete(daemonId: string): Promise<void>;
}

interface FirstConnectionInfo {
  daemonId: string;
  fingerprint: string; // "SHA256:XX:XX:..."
}

interface IdentityMismatchInfo {
  daemonId: string;
  expected: string; // Fingerprint of pinned key
  received: string; // Fingerprint of new key
}
```

### 6.5 Peer Interface

```typescript
interface Peer {
  // ─── Identity ────────────────────────────────────────────────
  readonly peerId: PeerId;
  readonly remotePeerId: PeerId | undefined; // Available after connect

  // ─── Connection State ────────────────────────────────────────
  readonly state: PeerState;

  /** True when session is established (state === "active"). Crypto state valid. */
  readonly connected: boolean;

  /**
   * True when session is paused (SBRP mode only).
   * Daemon temporarily disconnected from relay; messages buffering.
   * Always false in direct mode (SBP).
   */
  readonly paused: boolean;

  /**
   * True when traffic can flow immediately.
   * Use this for "can I send?" checks.
   * - Direct mode (SBP): same as `connected`
   * - Relay mode (SBRP): `connected && !paused`
   */
  readonly ready: boolean;

  /**
   * Promise that resolves when reconnection completes.
   * Undefined if not currently reconnecting.
   */
  readonly reconnecting: Promise<ReconnectionOutcome> | undefined;

  // ─── Lifecycle ───────────────────────────────────────────────
  connect(): Promise<void>;
  disconnect(reason?: string): Promise<void>;

  // ─── Events ──────────────────────────────────────────────────
  on<K extends keyof PeerEventMap>(
    event: K,
    handler: PeerEventMap[K],
  ): Unsubscribe;
  once<K extends keyof PeerEventMap>(
    event: K,
    handler: PeerEventMap[K],
  ): Unsubscribe;
  off<K extends keyof PeerEventMap>(event: K, handler?: PeerEventMap[K]): void;

  // ─── Namespaces ──────────────────────────────────────────────
  readonly rpc: RpcClient;
  readonly events: Events;

  // ─── Advanced (Escape Hatches) ───────────────────────────────
  readonly advanced: {
    /** Raw session for custom frame handling */
    readonly session: Session | undefined;
    /** Router for custom subject registration (app/, stream/) */
    readonly router: Router;
    /**
     * Send a framed message on a custom subject.
     * Respects session encryption (SBRP mode encrypts automatically).
     */
    sendFramed(subject: Subject, data: Uint8Array): Promise<void>;
    /** Subscribe to raw incoming frames (before RPC/events routing) */
    onFrame(
      handler: (frame: Frame, context: FrameContext) => void,
    ): Unsubscribe;
  };
}

type PeerState =
  | "idle" // Not connected, not connecting
  | "connecting" // Transport connection in progress
  | "negotiating" // Handshake/E2EE in progress
  | "active" // Ready for messages
  | "reconnecting" // Waiting before retry attempt
  | "closed"; // Explicitly closed; terminal state, no reconnection

/**
 * State Machine Diagram:
 *
 *       ┌───────────────────────────────────────────────────────────────┐
 *       │                                                               │
 *       ▼                                                               │
 *   ┌──────┐   connect()   ┌────────────┐   handshake   ┌────────────┐ │
 *   │ idle │──────────────▶│ connecting │──────────────▶│ negotiating│ │
 *   └──────┘               └────────────┘               └────────────┘ │
 *       ▲                        │                            │        │
 *       │                        │ error                      │ success│
 *       │                        ▼                            ▼        │
 *       │                  ┌────────────┐              ┌────────────┐  │
 *       │                  │ reconnect- │◀─────────────│   active   │  │
 *       │                  │    ing     │  disconnect  └────────────┘  │
 *       │                  └────────────┘       │             │        │
 *       │                        │              │             │ SBRP   │
 *       │              exhausted │              │             ▼        │
 *       │                        │              │      [sessionPaused] │
 *       │                        ▼              │      (state=active)  │
 *       │                  ┌────────────┐       │             │        │
 *       └──────────────────│   closed   │◀──────┴─────────────┘        │
 *                          └────────────┘                              │
 *                                                                      │
 * Note: In SBRP mode, sessionPaused/sessionResumed events fire while   │
 * state remains "active". The session is logically alive; only the     │
 * daemon's relay connection is interrupted.                            │
 */

type ReconnectionOutcome =
  | { status: "connected"; attempt: number }
  | { status: "exhausted"; attempts: number; lastError: PeerError }
  | { status: "aborted"; reason: "disconnect_called" | "closed" };
```

**Which API should I use?**

| Need                         | API                           | Example                                 |
| ---------------------------- | ----------------------------- | --------------------------------------- |
| Sync check before send       | `peer.ready`                  | `if (peer.ready) peer.rpc.call(...)`    |
| Check session established    | `peer.connected`              | `if (peer.connected) showSessionInfo()` |
| Check pause state (SBRP)     | `peer.paused`                 | `if (peer.paused) showPauseIndicator()` |
| React to state changes       | `peer.on("stateChange", ...)` | Update UI on connect/disconnect         |
| Wait for reconnection        | `await peer.reconnecting`     | Retry after reconnect completes         |
| Fire-and-forget notification | `peer.on("connected", ...)`   | Log connection events                   |

> **Note:** `peer.connected` means "session established" (crypto state valid). Use `peer.ready` to check if traffic can flow immediately. In SBRP mode, `connected && !ready` means the session is paused.

### 6.6 Peer Events

```typescript
interface PeerEventMap {
  // ─── Connection Lifecycle ────────────────────────────────────

  /** State machine transition */
  stateChange: (state: PeerState, previousState: PeerState) => void;

  /**
   * Session established, ready for messages.
   * In SBRP mode, always follows identityVerified.
   */
  connected: (info: ConnectedEvent) => void;

  /** Connection lost or closed */
  disconnected: (info: DisconnectedEvent) => void;

  // ─── Reconnection ────────────────────────────────────────────

  /** Reconnection attempt starting */
  reconnecting: (info: ReconnectingEvent) => void;

  /** All reconnection attempts exhausted */
  reconnectExhausted: (info: ReconnectExhaustedEvent) => void;

  // ─── E2EE Identity (SBRP mode only) ──────────────────────────

  /**
   * Daemon identity verified (first connection or reconnect).
   * ALWAYS emitted BEFORE connected event in SBRP mode.
   */
  identityVerified: (info: IdentityVerifiedEvent) => void;

  // ─── Relay Session (SBRP mode only) ──────────────────────────

  /** Daemon disconnected from relay; messages queued */
  sessionPaused: () => void;

  /** Daemon reconnected to relay; messages resuming */
  sessionResumed: () => void;

  // ─── Errors ──────────────────────────────────────────────────

  /** Error occurred (may or may not be fatal) */
  error: (error: PeerError) => void;
}

interface ConnectedEvent {
  peerId: PeerId;
  capabilities: string[];
  metadata: Record<string, string>;
  /** True if daemon supports session resumption (SBRP mode only) */
  resumable?: boolean;
}

interface DisconnectedEvent {
  reason: string;
  graceful: boolean; // true if disconnect() called
  willReconnect: boolean; // true if reconnection enabled and will attempt
}

interface ReconnectingEvent {
  attempt: number;
  delayMs: number;
  maxAttempts: number; // Infinity if unlimited
  lastError?: PeerError;
}

interface ReconnectExhaustedEvent {
  attempts: number;
  lastError: PeerError;
}

interface IdentityVerifiedEvent {
  fingerprint: string; // "SHA256:XX:XX:..."
  firstConnection: boolean; // true if newly pinned
}
```

### 6.7 RpcClient

```typescript
interface RpcClient {
  /**
   * Call a remote method.
   * @param method Logical method name (e.g., "getUser")
   *               Wire subject: rpcPolicy.channel (dispatch by envelope.m)
   */
  call<TParams = unknown, TResult = unknown>(
    method: string,
    params?: TParams,
    options?: RpcCallOptions,
  ): Promise<TResult>;

  /**
   * Call with explicit success/failure result.
   * Never throws; returns discriminated union.
   */
  tryCall<TParams = unknown, TResult = unknown>(
    method: string,
    params?: TParams,
    options?: RpcCallOptions,
  ): Promise<RpcCallResult<TResult>>;

  /**
   * Register a method handler.
   * Envelope field `m` determines which handler receives the request.
   */
  handle<TParams = unknown, TResult = unknown>(
    method: string,
    handler: RpcHandler<TParams, TResult>,
  ): Unsubscribe;

  /** Remove a method handler */
  unhandle(method: string): void;

  /**
   * Create a typed RPC client with full method inference.
   * Returns a proxy where each key becomes an RPC method call.
   */
  client<T extends RpcMethodMap>(): TypedRpcClient<T>;

  /**
   * Call with explicit wire subject (escape hatch).
   * Does NOT use rpcPolicy.channel.
   */
  callRaw(
    subject: Subject,
    params?: unknown,
    options?: RpcCallOptions,
  ): Promise<unknown>;

  /** Number of pending RPC calls awaiting response */
  readonly pendingCount: number;

  /** True if at maxPendingCalls (per policy) */
  readonly atCapacity: boolean;

  /** Check if an error should be retried */
  shouldRetry(error: unknown): boolean;
}

interface RpcCallOptions {
  /** Override default timeout */
  timeoutMs?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /**
   * Override connection policy for this call.
   * - "fail": This call fails immediately if disconnected (default)
   * - "pause": This call remains pending until response, timeout, or pause expiry
   *
   * Note: "pause" does NOT auto-retry. Sent requests are NOT re-sent.
   */
  onDisconnect?: "fail" | "pause";
}

type RpcCallResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: PeerError;
      /**
       * True if connection dropped AND became ready again before this call resolved.
       * Does NOT indicate whether the request was delivered before the drop.
       * Caller must decide retry strategy based on operation idempotency.
       */
      reconnected: boolean;
    };

type RpcHandler<TParams, TResult> = (
  params: TParams,
  context: RpcHandlerContext,
) => TResult | Promise<TResult>;

interface RpcHandlerContext {
  /** Remote peer ID */
  readonly peerId: PeerId;
  /** Logical method name (without prefix) */
  readonly method: string;
  /** Full wire subject (for advanced use) */
  readonly subject: Subject;
  /**
   * Frame ID of the incoming request (32 lowercase hex chars).
   * Used for request/response correlation per ADR-006.
   * The response frame's correlation ID will reference this frameId.
   */
  readonly frameId: FrameIdHex;
}

// ─── Branded Types ─────────────────────────────────────────────

/** Hex representation of frame ID (32 lowercase chars) */
type FrameIdHex = string & { readonly __brand: "FrameIdHex" };

// ─── Typed RPC ─────────────────────────────────────────────────

interface RpcMethodDef<TParams = void, TResult = void> {
  params: TParams;
  result: TResult;
}

type RpcMethodMap = Record<string, RpcMethodDef<unknown, unknown>>;

/**
 * Typed RPC client with conditional params handling.
 * - void params: method() with no arguments required
 * - optional params: method() or method(params)
 * - required params: method(params) required
 */
type TypedRpcClient<T extends RpcMethodMap> = {
  [K in keyof T]: T[K]["params"] extends void
    ? (options?: RpcCallOptions) => Promise<T[K]["result"]>
    : undefined extends T[K]["params"]
      ? (
          params?: T[K]["params"],
          options?: RpcCallOptions,
        ) => Promise<T[K]["result"]>
      : (
          params: T[K]["params"],
          options?: RpcCallOptions,
        ) => Promise<T[K]["result"]>;
};
```

### 6.8 Events

```typescript
interface Events {
  /**
   * Emit a fire-and-forget event.
   * @param eventName Logical event name (e.g., "user.created")
   *                  Wire subject: eventPolicy.channel (dispatch by envelope.e)
   * @returns Promise that resolves when sent (NOT delivered)
   */
  emit<T = unknown>(
    eventName: string,
    data?: T,
    options?: EmitOptions,
  ): Promise<void>;

  /**
   * Listen for an event.
   * Envelope field `e` determines which handlers receive the event.
   */
  on<T = unknown>(eventName: string, handler: EventHandler<T>): Unsubscribe;

  /**
   * Listen for events matching a pattern.
   *
   * WARNING: Pattern matching is CLIENT-SIDE. All events are received
   * and filtered locally. Cost is O(patterns) per event.
   *
   * Supported patterns (NATS-style):
   * - "user.*" matches "user.created", "user.deleted" (single segment)
   * - "metrics.>" matches "metrics.cpu.load", "metrics.memory" (any depth)
   *
   * @throws {PeerError} If maxPatternSubscriptions exceeded (per policy)
   */
  onPattern<T = unknown>(
    pattern: string,
    handler: PatternEventHandler<T>,
    options?: PatternSubscribeOptions,
  ): PatternSubscription;

  /** Remove event listener (all handlers if handler omitted) */
  off(eventName: string, handler?: EventHandler): void;

  /**
   * Emit with explicit wire subject (escape hatch).
   * Does NOT use eventPolicy.channel.
   */
  emitRaw(subject: Subject, data: Uint8Array): Promise<void>;

  /** Current send buffer status (for flow control) */
  readonly bufferStatus: BufferStatus;

  /** Listen for backpressure events */
  onBackpressure(handler: (status: BufferStatus) => void): Unsubscribe;

  /** Current subscription statistics */
  readonly subscriptionStats: SubscriptionStats;
}

interface EmitOptions {
  /** Skip if buffer is full instead of error/queue */
  dropIfFull?: boolean;
  /** Priority for queue ordering (higher = first) */
  priority?: number;
}

interface PatternSubscribeOptions {
  /**
   * Acknowledge O(N) cost when exceeding soft limits.
   * Required if maxPatternSubscriptions would be exceeded.
   */
  acknowledgePerformanceCost?: boolean;
}

interface PatternSubscription extends Unsubscribe {
  /** Whether filtering happens server-side or client-side */
  readonly filteringMode: "server" | "client";
}

type EventHandler<T> = (data: T, context: EventContext) => void;

type PatternEventHandler<T> = (
  eventName: string, // Actual event that matched
  data: T,
  context: EventContext,
) => void;

interface EventContext {
  /** Remote peer ID */
  readonly peerId: PeerId;
  /** Logical event name */
  readonly eventName: string;
  /** Wire subject (channel) */
  readonly subject: Subject;
  /** Frame ID as hex string */
  readonly frameId: FrameIdHex;
}

interface BufferStatus {
  pendingBytes: number;
  limitBytes: number;
  utilization: number; // 0-1
  highWater: boolean; // True if above 75%
}

interface SubscriptionStats {
  exactCount: number;
  patternCount: number;
  hotEvents: Array<{ eventName: string; count: number }>;
}
```

### 6.9 Server Listening

```typescript
interface ListenOptions {
  /** Endpoint to listen on (e.g., "ws://0.0.0.0:8080") */
  endpoint: string | TransportEndpoint;

  /** Session negotiator (required) */
  negotiator: Negotiator;

  /** Server identity */
  peerId?: PeerId;

  /** Custom transport factory */
  transport?: TransportFactory;

  /** Policy objects */
  connectionPolicy?: Partial<ConnectionPolicy>;
  rpcPolicy?: Partial<RpcPolicy>;
  eventPolicy?: Partial<EventPolicy>;

  /**
   * Called for each accepted connection AFTER negotiation.
   * Handshake complete, peerId known, rpc/events ready.
   */
  onConnection: (peer: Peer) => void | Promise<void>;

  /**
   * Called when a connection ends (from either side).
   */
  onDisconnection?: (peer: Peer, reason: DisconnectReason) => void;

  /**
   * Called on server-level errors (not per-connection errors).
   */
  onError?: (error: Error) => void;

  /**
   * Optional authorization callback.
   * Called during negotiation with connection context.
   * Return true to accept, false to reject.
   */
  authorize?: (context: AuthorizeContext) => boolean | Promise<boolean>;
}

interface DisconnectReason {
  code: string;
  message: string;
  graceful: boolean; // true if peer.disconnect() was called
}

interface AuthorizeContext {
  /** Remote peer ID from handshake */
  peerId: PeerId;
  /** Transport-level info */
  transport: TransportInfo;
  /** Claims from token (if provided) */
  claims?: Record<string, unknown>;
}

interface TransportInfo {
  remoteAddress?: string;
  headers?: Record<string, string>; // Node/Bun only
  query?: URLSearchParams;
}

interface PeerServer {
  readonly connections: ReadonlyMap<PeerId, Peer>;
  readonly address: string;

  /** Gracefully close all connections and stop listening */
  close(): Promise<void>;
}

// Note: PeerServer is callback-only (no event emitter).
// Connection events are handled via ListenOptions.onConnection/onDisconnection.
// This avoids API duplication and "missed event" races.
```

---

## 7. Error Taxonomy

### 7.1 PeerError Class Hierarchy

```typescript
/**
 * Base error class for all peer SDK errors.
 */
class PeerError extends Error {
  readonly code: PeerErrorCode;
  readonly layer: ErrorLayer;
  readonly fatal: boolean;
  readonly willReconnect: boolean;
  readonly details: PeerErrorDetails;
  readonly cause?: Error;

  /** True if error is transient and retry may succeed */
  isRecoverable(): boolean;

  /** Suggested retry delay in ms, or undefined if not recoverable */
  suggestedRetryDelayMs(): number | undefined;

  /** Type guards */
  isTransportError(): this is TransportPeerError;
  isRpcError(): this is RpcPeerError;
  isSbrpError(): this is SbrpPeerError;
}

type ErrorLayer =
  | "transport"
  | "negotiation"
  | "rpc"
  | "event"
  | "protocol"
  | "sbrp";

// ─── Subclasses for Distinct Handling ──────────────────────────

/** Transport-layer failures (wraps TransportError) */
class TransportPeerError extends PeerError {
  readonly layer: "transport";
  readonly transportKind: TransportErrorKind;
}

/** RPC request/response failures */
class RpcPeerError extends PeerError {
  readonly layer: "rpc";
  readonly method?: string;
}

/** SBRP relay/session failures */
class SbrpPeerError extends PeerError {
  readonly layer: "sbrp";
  readonly sessionId?: bigint;
  readonly daemonId?: string;
}

// ─── Narrow Subclasses for Common Catch Patterns ───────────────

/** RPC timeout (frequent catch target) */
class RpcTimeoutError extends RpcPeerError {
  readonly code: "rpc_timeout";
}

/** Connection lost unexpectedly */
class ConnectionLostError extends TransportPeerError {
  readonly code: "connection_closed";
}

/** TOFU identity mismatch */
class IdentityMismatchError extends SbrpPeerError {
  readonly code: "identity_mismatch";
  readonly expectedFingerprint: string;
  readonly receivedFingerprint: string;
}

/** Buffer overflow during pause */
class BufferOverflowError extends PeerError {
  readonly code: "buffer_overflow";
  readonly layer: "rpc" | "event";
  readonly bufferBytes: number;
  readonly limitBytes: number;
}

/** Pause timeout exceeded */
class PauseTimeoutError extends PeerError {
  readonly code: "pause_timeout";
  readonly pausedDurationMs: number;
  readonly limitMs: number;
}
```

### 7.2 Error Details

```typescript
interface PeerErrorDetails {
  // ─── Wire Context ────────────────────────────────────────────
  readonly wireCode?: number;
  readonly sessionId?: bigint;
  readonly frameId?: FrameIdHex;

  // ─── RPC Context ─────────────────────────────────────────────
  readonly method?: string;
  readonly validationErrors?: readonly ValidationError[];

  // ─── SBRP Context ────────────────────────────────────────────
  readonly daemonId?: string;
  readonly retryAfterSec?: number; // For rate_limited

  // ─── Transport Context ───────────────────────────────────────
  readonly transportKind?: TransportErrorKind;
  readonly closeCode?: number;

  // ─── E2EE Context ────────────────────────────────────────────
  readonly expectedFingerprint?: string;
  readonly receivedFingerprint?: string;
}

interface ValidationError {
  readonly path: string; // e.g., "params.userId"
  readonly message: string;
  readonly code?: string; // e.g., "required", "type_mismatch"
}
```

### 7.3 Error Codes

```typescript
enum PeerErrorCode {
  // ─── Transport (fatal, may reconnect) ────────────────────────
  ConnectionFailed = "connection_failed",
  ConnectionTimeout = "connection_timeout",
  ConnectionClosed = "connection_closed",
  NetworkOffline = "network_offline",
  TlsFailure = "tls_failure",

  // ─── Negotiation (fatal, may reconnect) ──────────────────────
  HandshakeFailed = "handshake_failed",
  HandshakeTimeout = "handshake_timeout",
  AuthenticationFailed = "authentication_failed",
  IdentityMismatch = "identity_mismatch",
  IdentityNotPinned = "identity_not_pinned", // Strict mode rejection
  UnsupportedVersion = "unsupported_version",

  // ─── RPC (non-fatal, per-request) ────────────────────────────
  RpcTimeout = "rpc_timeout",
  RpcMethodNotFound = "rpc_method_not_found",
  RpcInvalidParams = "rpc_invalid_params",
  RpcInternalError = "rpc_internal_error",
  RpcCancelled = "rpc_cancelled",

  // ─── Pause/Buffer (non-fatal, per-operation) ────────────────
  BufferOverflow = "buffer_overflow",
  PauseTimeout = "pause_timeout",

  // ─── E2EE (fatal, no reconnect) ──────────────────────────────
  DecryptionFailed = "decryption_failed",
  ReplayDetected = "replay_detected",
  SequenceError = "sequence_error",

  // ─── Protocol (fatal, may reconnect) ─────────────────────────
  ProtocolViolation = "protocol_violation",
  InvalidFrame = "invalid_frame",
  UnsupportedFeature = "unsupported_feature",

  // ─── SBRP Relay (wire codes) ─────────────────────────────────
  Unauthorized = "unauthorized",
  Forbidden = "forbidden",
  DaemonNotFound = "daemon_not_found",
  DaemonOffline = "daemon_offline",
  SessionNotFound = "session_not_found",
  SessionExpired = "session_expired",
  MalformedFrame = "malformed_frame",
  PayloadTooLarge = "payload_too_large",
  InvalidFrameType = "invalid_frame_type",
  RateLimited = "rate_limited",
  RelayInternalError = "relay_internal_error",

  // ─── Key Provisioning ────────────────────────────────────────
  KeyFetchFailed = "key_fetch_failed",
  KeyFetchTimeout = "key_fetch_timeout",
  InvalidKeyFormat = "invalid_key_format",
}
```

### 7.4 Error Code Mapping to Wire Codes

| PeerErrorCode      | Wire Source    | Wire Code | Notes                   |
| ------------------ | -------------- | --------- | ----------------------- |
| ProtocolViolation  | SBP ErrorFrame | 1000      |                         |
| UnsupportedVersion | SBP ErrorFrame | 1001      |                         |
| InvalidFrame       | SBP ErrorFrame | 1002      |                         |
| UnsupportedFeature | SBP ErrorFrame | 1003      |                         |
| RpcMethodNotFound  | RpcError       | 1101      |                         |
| RpcTimeout         | RpcError       | 1103      | Also local timeout      |
| RpcInvalidParams   | Application    | 2001+     | Convention              |
| RpcInternalError   | Application    | 2000      | Catch-all               |
| Unauthorized       | SBRP Control   | 0x0101    |                         |
| Forbidden          | SBRP Control   | 0x0102    |                         |
| DaemonNotFound     | SBRP Control   | 0x0201    |                         |
| DaemonOffline      | SBRP Control   | 0x0202    | Non-terminal            |
| SessionNotFound    | SBRP Control   | 0x0301    |                         |
| SessionExpired     | SBRP Control   | 0x0302    |                         |
| MalformedFrame     | SBRP Control   | 0x0401    |                         |
| PayloadTooLarge    | SBRP Control   | 0x0402    |                         |
| InvalidFrameType   | SBRP Control   | 0x0403    |                         |
| RateLimited        | SBRP Control   | 0x0901    | Non-terminal            |
| RelayInternalError | SBRP Control   | 0x0601    |                         |
| DecryptionFailed   | SDK-only       | —         | Never on wire           |
| IdentityMismatch   | SDK-only       | —         | Never on wire           |
| KeyFetchFailed     | SDK-only       | —         | Never on wire           |
| Transport errors   | SDK-only       | —         | From TransportErrorKind |
| BufferOverflow     | SDK-only       | —         | Pause buffer exceeded   |
| PauseTimeout       | SDK-only       | —         | Pause duration exceeded |

### 7.5 Error Fatality and Recovery

Normative table defining error behavior. SDK sets these flags; user code cannot override.

| ErrorCode             | fatal | willReconnect | isRecoverable() | Notes                              |
| --------------------- | ----- | ------------- | --------------- | ---------------------------------- |
| connection_failed     | false | yes           | true            | Network issue; will retry          |
| connection_timeout    | false | yes           | true            | Network issue; will retry          |
| connection_closed     | false | yes           | true            | Transport dropped; will retry      |
| network_offline       | false | yes           | true            | Browser offline event              |
| tls_failure           | true  | no            | false           | Certificate/security issue         |
| handshake_failed      | false | yes           | true            | May succeed on retry               |
| handshake_timeout     | false | yes           | true            | May succeed on retry               |
| authentication_failed | true  | no            | false           | Credentials invalid                |
| identity_mismatch     | true  | no            | false           | TOFU violation; requires action    |
| identity_not_pinned   | true  | no            | false           | Strict mode; key not provisioned   |
| unsupported_version   | true  | no            | false           | Protocol incompatible              |
| rpc_timeout           | false | n/a           | true            | Per-request; retry manually        |
| rpc_method_not_found  | false | n/a           | false           | Handler missing; fix code          |
| rpc_invalid_params    | false | n/a           | false           | Caller error; fix params           |
| rpc_internal_error    | false | n/a           | true            | Server error; may retry            |
| rpc_cancelled         | false | n/a           | false           | Intentional cancellation           |
| buffer_overflow       | false | n/a           | false           | Reduce send rate or increase limit |
| pause_timeout         | false | yes           | true            | Session will reconnect             |
| decryption_failed     | true  | no            | false           | Crypto failure; session corrupt    |
| replay_detected       | true  | no            | false           | Security violation                 |
| protocol_violation    | true  | no            | false           | Peer misbehaving                   |
| daemon_offline        | false | yes           | true            | Daemon will reconnect              |
| session_expired       | false | yes           | true            | Will establish new session         |
| rate_limited          | false | n/a           | true            | Wait and retry                     |

> **Note:** `willReconnect` is "yes" only if reconnect policy is enabled.
> `n/a` means the error doesn't affect connection state (per-operation errors).

### 7.6 Error Handling Patterns

```typescript
// Global error handler (observability)
peer.on("error", (error) => {
  logger.error("Peer error", {
    code: error.code,
    layer: error.layer,
    fatal: error.fatal,
    willReconnect: error.willReconnect,
    details: error.details,
  });
});

// RPC with typed catch
try {
  const result = await peer.rpc.call("user.get", { id: "123" });
} catch (error) {
  if (error instanceof RpcTimeoutError) {
    return retry();
  }
  if (error instanceof RpcPeerError) {
    console.warn("RPC failed:", error.method, error.code);
  }
  throw error;
}

// Recovery helper
try {
  await peer.rpc.call("operation", params);
} catch (error) {
  if (error instanceof PeerError && error.isRecoverable()) {
    const delay = error.suggestedRetryDelayMs() ?? 1000;
    await sleep(delay);
    return retry();
  }
  throw error;
}

// Non-throwing RPC
const result = await peer.rpc.tryCall("user.get", { id: "123" });
if (result.ok) {
  console.log(result.value);
} else {
  console.error(result.error.code);
  if (result.reconnected) {
    // Connection was lost and restored during call
  }
}
```

---

## 8. Observability

### 8.1 PeerObserver Interface

```typescript
interface PeerObserver {
  /** Called when an error occurs (before event emission) */
  onError?(error: PeerError, peer: Peer): void;

  /** Called on state transition */
  onStateChange?(from: PeerState, to: PeerState, peer: Peer): void;

  /** Called after successful RPC call */
  onRpcComplete?(info: RpcCompleteInfo): void;

  /** Called on RPC timeout or error */
  onRpcError?(error: PeerError, method: string, durationMs: number): void;

  /** Called periodically with connection metrics */
  onMetrics?(metrics: PeerMetrics): void;
}

interface RpcCompleteInfo {
  method: string;
  durationMs: number;
  requestSize: number;
  responseSize: number;
}

interface PeerMetrics {
  state: PeerState;
  connectedDurationMs: number;
  messagesSent: number;
  messagesReceived: number;
  bytesSent: number;
  bytesReceived: number;
  rpcInflight: number;
  rpcCompleted: number;
  rpcFailed: number;
  reconnectAttempts: number;
}
```

### 8.2 OpenTelemetry Example

```typescript
import { createPeer, PeerObserver } from "@sideband/peer";
import { metrics, trace } from "@opentelemetry/api";

const meter = metrics.getMeter("sideband");
const errorCounter = meter.createCounter("peer.errors");
const rpcDuration = meter.createHistogram("peer.rpc.duration");

const observer: PeerObserver = {
  onError(error) {
    errorCounter.add(1, {
      code: error.code,
      layer: error.layer,
      fatal: String(error.fatal),
    });
  },
  onRpcComplete({ method, durationMs }) {
    rpcDuration.record(durationMs, { method, status: "ok" });
  },
  onRpcError(error, method, durationMs) {
    rpcDuration.record(durationMs, {
      method,
      status: "error",
      code: error.code,
    });
  },
};

const peer = createPeer({
  endpoint: "ws://localhost:8080",
  negotiator: sbpNegotiator(),
  observer,
});
```

---

## 9. Reconnection Semantics

### 9.1 What Reconnection Does

| Behavior               | Description                                      |
| ---------------------- | ------------------------------------------------ |
| Transport reconnect    | WebSocket closes → SDK reconnects after backoff  |
| Session re-negotiation | Full SBP/SBRP handshake on each reconnect (v1)   |
| Handler preservation   | RPC handlers and subscriptions survive reconnect |
| State reset            | In-flight RPCs fail; no transparent retry        |

### 9.2 What Reconnection Does NOT Do (v1)

| Behavior              | Why Not                                                          |
| --------------------- | ---------------------------------------------------------------- |
| Session resume        | Protocol v1 doesn't support resumption (except SBRP daemon-side) |
| RPC retry             | Application must decide retry policy                             |
| Message replay        | Fire-and-forget events are lost if not delivered                 |
| Exactly-once delivery | Out of scope; use RPC for confirmation                           |

### 9.3 Typed Reconnection Handling

```typescript
// Check reconnection state
if (peer.reconnecting) {
  const outcome = await peer.reconnecting;
  if (outcome.status === "connected") {
    // Retry failed operations
  } else if (outcome.status === "exhausted") {
    // Show permanent failure UI
  }
}

// RPC with reconnection awareness
const result = await peer.rpc.tryCall("save", data, { onDisconnect: "pause" });
if (!result.ok && result.reconnected) {
  // Connection dropped and restored during this call
  // Request may or may not have been delivered; decide retry based on idempotency
}
```

### 9.4 SBRP Session Pause/Resume

In relay mode, when the daemon disconnects from the relay:

> **Invariant:** `state === "active"` means _cryptographic session is established_.
> It does **not** guarantee transport availability. Use `peer.ready` for that.

**State model during pause:**

- `peer.state` remains `"active"` (session is logically alive)
- `peer.connected` remains `true`
- `peer.paused` becomes `true`
- `peer.ready` becomes `false`
- Only `sessionPaused` event fires; no `stateChange` event
- RPC calls remain pending (up to limits) if `onDisconnect: "pause"`
- RPC calls fail immediately if `onDisconnect: "fail"` (default)

**Buffering ownership model:**

| Layer  | Buffering responsibility                                   |
| ------ | ---------------------------------------------------------- |
| SDK    | Client-side buffer (authoritative); enforces all limits    |
| Relay  | Best-effort forwarding; may drop if overwhelmed            |
| Daemon | Server-side buffer for paused clients (SBRP daemon config) |

All pause limits (`pauseBufferLimitBytes`, `pauseTimeoutMs`) are enforced **client-side**.
Relay buffering is an implementation detail and not relied upon for correctness.

**Pause lifecycle:**

1. Relay sends `session_paused` control frame to client
2. SDK emits `sessionPaused` event; `peer.paused` becomes `true`
3. Outbound messages buffered client-side (up to `pauseBufferLimitBytes`)
4. When daemon reconnects, relay sends `session_resumed`
5. SDK emits `sessionResumed` event; `peer.paused` becomes `false`
6. Buffered messages sent; pending RPC calls continue waiting for response

**Expiry lifecycle:**

If daemon doesn't reconnect within `maxPauseDurationMs`:

1. Relay sends `session_expired` control frame
2. SDK emits `disconnected` with `reason: "session_expired"`
3. `peer.state` transitions to `"reconnecting"` (if enabled) or `"closed"`
4. Reconnection cycle starts with full handshake (new session)

---

## 10. Security Model

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

### 10.3 TOFU Trust Policies

| Policy     | First Connection  | Mismatch      | Use Case             |
| ---------- | ----------------- | ------------- | -------------------- |
| `"auto"`   | Auto-accept, warn | Call callback | Development only     |
| `"prompt"` | Require callback  | Call callback | Production (default) |
| `"strict"` | Reject if no pin  | Abort         | High-security        |

```typescript
// Development: auto-accept (NOT RECOMMENDED)
sbrpNegotiator({
  daemonId: "dev-daemon",
  keyStorage,
  trustPolicy: "auto",
});

// Production: require explicit acceptance
sbrpNegotiator({
  daemonId: "prod-daemon",
  keyStorage,
  trustPolicy: "prompt",
  onFirstConnection: ({ fingerprint }) => {
    return showConfirmDialog(`Trust daemon ${fingerprint}?`);
  },
});

// High-security: pre-provisioned keys only
sbrpNegotiator({
  daemonId: "secure-daemon",
  keyStorage, // Must already contain pinned key
  trustPolicy: "strict",
});
```

### 10.4 TOFU Lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│                     First Connection                              │
│  1. SDK checks keyStorage for pinned key                          │
│  2. No pin found:                                                 │
│     - "auto": Accept, pin, emit warning                           │
│     - "prompt": Call onFirstConnection (REQUIRED)                 │
│     - "strict": Abort with identity_not_pinned error              │
│  3. Event: identityVerified { firstConnection: true }             │
│  4. Event: connected                                              │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Subsequent Connections                          │
│  1. SDK checks keyStorage for pinned key                          │
│  2. Pin found; compare against daemon's key from handshake        │
│  3a. Match → identityVerified { firstConnection: false }          │
│  3b. Mismatch → call onIdentityMismatch() callback                │
│      - "strict": Abort (callback not called)                      │
│      - "auto"/"prompt": Call callback, default abort              │
└──────────────────────────────────────────────────────────────────┘
```

### 10.5 Key Storage Implementations

```typescript
// Browser: localStorage
import { createBrowserKeyStorage } from "@sideband/peer";

const keyStorage = createBrowserKeyStorage({
  prefix: "myapp:tofu:", // Optional namespace
});

// Node/Bun: File-based
import { createFileKeyStorage } from "@sideband/peer";

const keyStorage = createFileKeyStorage("~/.myapp/keys/");

// Custom: Bring your own
const keyStorage: KeyStorage = {
  async get(daemonId) {
    return (await db.tofuKeys.findOne({ daemonId })?.publicKey) ?? null;
  },
  async set(daemonId, publicKey) {
    await db.tofuKeys.upsert({ daemonId, publicKey });
  },
  async delete(daemonId) {
    await db.tofuKeys.delete({ daemonId });
  },
};
```

---

## 11. Usage Examples

### 11.1 UC1: Local Development

**Browser (Client):**

```typescript
import { createDirectPeer } from "@sideband/peer";

const peer = createDirectPeer({
  endpoint: "ws://localhost:8080",
  reconnect: true,
});

peer.events.on("file.changed", ({ path, event }) => {
  console.log(`${event}: ${path}`);
  location.reload();
});

peer.on("error", (error) => {
  if (error.fatal) {
    showToast("Connection lost, reconnecting...");
  }
});

await peer.connect();
```

**Local Daemon (Server):**

```typescript
import { listen, sbpNegotiator } from "@sideband/peer";
import { watch } from "fs";

const server = await listen({
  endpoint: "ws://0.0.0.0:8080",
  negotiator: sbpNegotiator(),
  onConnection(peer) {
    console.log("Browser connected:", peer.remotePeerId);

    peer.rpc.handle("file.read", async ({ path }) => {
      return { content: await Bun.file(path).text() };
    });

    peer.rpc.handle("file.write", async ({ path, content }) => {
      await Bun.write(path, content);
      return { success: true };
    });

    const watcher = watch("./src", { recursive: true }, (event, path) => {
      peer.events.emit("file.changed", { event, path });
    });

    peer.on("disconnected", () => watcher.close());
  },
});

console.log("Listening on", server.address);
```

### 11.2 UC2: E2EE Relay

**Browser (Client):**

```typescript
import { createRelayPeer, createBrowserKeyStorage } from "@sideband/peer";

const peer = createRelayPeer({
  endpoint: "wss://relay.sideband.cloud",
  sbrp: {
    daemonId: "daemon-prod-001",
    controlPlaneUrl: "https://api.myapp.com",
    keyStorage: createBrowserKeyStorage(),
    trustPolicy: "prompt",
    onFirstConnection: ({ fingerprint }) => {
      showToast(`Connecting to new daemon: ${fingerprint}`);
      return true;
    },
    onIdentityMismatch: ({ expected, received }) => {
      return showSecurityDialog({
        title: "Security Warning",
        message: `Daemon identity changed!\nExpected: ${expected}\nReceived: ${received}`,
        confirmLabel: "Trust New Key",
        cancelLabel: "Disconnect",
      });
    },
  },
  reconnect: { maxAttempts: 10 },
});

peer.on("identityVerified", ({ fingerprint, firstConnection }) => {
  if (firstConnection) console.log("Pinned new daemon:", fingerprint);
});

peer.on("sessionPaused", () => showToast("Daemon offline, waiting..."));
peer.on("sessionResumed", () => showToast("Daemon reconnected"));

await peer.connect();

const status = await peer.rpc.call("system.status");
```

**Cloud Daemon:**

```typescript
import {
  createPeer,
  sbrpNegotiator,
  loadIdentityKeyPair,
} from "@sideband/peer";

const identity = await loadIdentityKeyPair("./daemon-identity.key");

const peer = createPeer({
  endpoint: "wss://relay.sideband.cloud",
  negotiator: sbrpNegotiator({
    daemonId: process.env.DAEMON_ID!,
    serverIdentity: identity,
    controlPlaneUrl: "https://api.myapp.com",
    keyStorage: createFileKeyStorage("./keys/"),
  }),
  reconnect: true,
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
// shared/api.ts — Shared type definitions
export interface DaemonApi {
  "user.get": {
    params: { id: string };
    result: { id: string; name: string; email: string };
  };
  "user.list": {
    params: void; // No params required
    result: { users: User[]; total: number };
  };
  "user.update": {
    params: { id: string; data: Partial<User> };
    result: { success: boolean };
  };
}

// client.ts — Browser
import type { DaemonApi } from "./shared/api";
import { createDirectPeer } from "@sideband/peer";

const peer = createDirectPeer({ endpoint: "ws://localhost:8080" });
await peer.connect();

const api = peer.rpc.client<DaemonApi>();

const user = await api["user.get"]({ id: "123" });
//    ^? { id: string; name: string; email: string }

const { users, total } = await api["user.list"](); // No params
//      ^? User[]

// server.ts — Daemon
peer.rpc.handle<
  DaemonApi["user.get"]["params"],
  DaemonApi["user.get"]["result"]
>("user.get", async ({ id }) => db.users.findById(id));

peer.rpc.handle<void, DaemonApi["user.list"]["result"]>(
  "user.list",
  async () => ({ users: await db.users.all(), total: await db.users.count() }),
);
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
