# ADR-011: Runtime Message Routing

- **Date**: 2025-01-11
- **Status**: Accepted
- **Affects**: Runtime

## Context

The runtime needs a message routing layer between the session (which delivers decoded frames) and application logic (which handles RPC, events, and custom protocols). The existing specs define subject namespaces (ADR-006, ADR-008) and RPC envelope structure (ADR-010), but do not specify:

1. How handlers are registered and matched
2. Dispatch ordering when multiple handlers match
3. Error propagation from handlers

**Scope:** This ADR defines the `Router` in `@sideband/runtime` — a lower-level building block for subject-based message dispatch. `@sideband/peer` provides higher-level `rpc.handle()` and `events.on()` APIs with its own internal dispatch; it does not use the Router. The Router is intended for advanced use cases: custom `app/` prefix protocols, or building alternative SDKs that need subject-level routing.

Key design goals:

- **Predictable**: Deterministic dispatch ordering
- **Composable**: Works for RPC, events, and custom protocols
- **Extensible**: Custom prefixes without hacks
- **Safe**: Hard to accidentally misuse (e.g., frameId reuse)

## Decision

### 1. Router API

The Router manages handler registration and dispatch:

```ts
interface Router {
  /** Register handler for exact subject match */
  route(
    subject: string,
    handler: MessageHandler,
    options?: RouteOptions,
  ): Unsubscribe;

  /** Register handler for subject prefix */
  routePrefix(
    prefix: string,
    handler: MessageHandler,
    options?: RouteOptions,
  ): Unsubscribe;

  /** Remove all handlers for a subject */
  unroute(subject: string): void;

  /** Clear all handlers */
  clear(): void;
}

interface RouteOptions {
  mode?: "exclusive" | "broadcast"; // Default: inferred from prefix
}

type Unsubscribe = () => void;
type MessageHandler = (msg: InboundMessage) => Promise<void> | void;
```

### 2. InboundMessage (not MessageContext)

The handler receives an `InboundMessage` with clear separation between general messaging and RPC:

```ts
interface InboundMessage {
  // Core message data
  readonly subject: Subject;
  readonly payload: Uint8Array;
  readonly peerId: PeerId;
  readonly session: Session;

  // Low-level frame access (read-only)
  readonly frame: Readonly<MessageFrame>;

  /** Send a response message (generates fresh frameId) */
  send(subject: Subject, data: Uint8Array): Promise<void>;

  /** RPC context (only present for `rpc` channel with valid envelope) */
  readonly rpc?: RpcContext;
}

interface RpcContext {
  readonly method: string;
  readonly params: unknown;
  readonly cid: FrameId;

  /** Reply with success result */
  reply(result?: unknown): Promise<void>;

  /** Reply with error */
  error(code: number, message: string, data?: unknown): Promise<void>;
}
```

**Key design:**

- `send()` is always available (generates fresh frameId internally)
- `rpc` is only present when envelope decodes successfully
- `frame` is read-only to prevent accidental frameId reuse; exposed for diagnostics and tracing only—application logic SHOULD NOT depend on frame internals
- `rpc.reply()` and `rpc.error()` handle correlation automatically

### 3. Subject Validation Policy

Subject prefixes are **policy-driven**, not type-locked:

```ts
interface SubjectPolicy {
  /** Exact-match channels (default: ["rpc", "event"]) */
  allowedChannels: string[];

  /** Channels that are reserved/rejected (default: ["stream"]) */
  reservedChannels: string[];

  /** Allowed prefixes (default: ["app/"]) */
  allowedPrefixes: string[];

  /** Custom classifier for dispatch semantics */
  classify?(subject: string): SubjectKind;
}

type SubjectKind = "rpc" | "event" | "custom" | "reserved";
```

**Validation order:**

1. Check `reservedChannels` → reject with `ErrorFrame{code: 1003}` (UnsupportedFeature)
2. Check `allowedChannels` (exact match) or `allowedPrefixes` (prefix match) → reject with `ErrorFrame{code: 1002}` (InvalidFrame) if no match
3. Run `classify()` if provided → determines dispatch semantics

**Precedence:** `reservedChannels` always takes precedence over `allowedChannels`. If a channel appears in both, it is reserved.

**Classification invariant:** If `classify()` returns `"rpc"`, the message MUST contain a valid RPC envelope; otherwise the message is rejected with `ErrorFrame{code: 1002}` (InvalidFrame: malformed payload). This prevents semantic spoofing where non-RPC messages bypass envelope validation.

**Default validation:**

| Subject  | Kind       | Default mode | Behavior                     |
| -------- | ---------- | ------------ | ---------------------------- |
| `rpc`    | `rpc`      | `exclusive`  | Single handler, must reply   |
| `event`  | `event`    | `broadcast`  | Fan-out, no reply            |
| `stream` | `reserved` | —            | Reject with ErrorFrame(1003) |
| `app/*`  | `custom`   | `broadcast`  | User-defined semantics       |

Note: `rpc`, `event`, and `stream` are exact-match channels. `app/` is a prefix supporting arbitrary sub-paths.

**Future extensibility:** Reserved channels (e.g., `stream`) may be reclassified by negotiators in future protocol versions. V2 negotiators can advertise streaming capability and override the default reserved status.

**Extensibility:**

```ts
// Allow custom prefixes for app protocols
const router = createRouter(
  {},
  {
    allowedChannels: ["rpc", "event"],
    reservedChannels: ["stream"],
    allowedPrefixes: ["app/", "debug/", "admin/"],
  },
);

router.routePrefix("debug/", debugHandler);
router.routePrefix("admin/", adminHandler, { mode: "exclusive" });
```

### 4. Dispatch Ordering

When multiple handlers match, dispatch follows deterministic rules:

**Matching priority:**

1. Exact match handlers (highest priority)
2. Prefix handlers (longest prefix first)

**Within each bucket:**

- Registration order (first registered, first called)

**Invocation:**

| Mode        | Behavior                                    |
| ----------- | ------------------------------------------- |
| `exclusive` | First matching handler only; others ignored |
| `broadcast` | All matching handlers invoked sequentially  |

**Why sequential broadcast?** Handlers are awaited sequentially—the next handler is invoked only after the previous one resolves. This ensures deterministic side-effects. Concurrent invocation would introduce race conditions and make debugging harder. If parallel execution is needed, handlers can spawn their own async tasks.

**Example (for `app/` prefix subjects):**

```ts
router.route("app/metrics/cpu", handlerA); // exact
router.routePrefix("app/metrics/", handlerB); // prefix (longer)
router.routePrefix("app/", handlerC); // prefix (shorter)

// Incoming: "app/metrics/cpu"
// Dispatch order: handlerA (exact), then handlerB (longer prefix), then handlerC
// For broadcast mode: all three called in order
// For exclusive mode: only handlerA called
```

Note: For `rpc` and `event` channels, dispatch is determined by envelope fields (`m` for RPC methods, `e` for event names), not by subject matching. The example above applies to `app/` prefix subjects and any custom prefixes.

### 5. RPC Dispatch Rules

For subjects classified as `rpc`:

1. Decode RPC envelope from payload
2. If envelope decoding fails → emit `ErrorFrame{code: 1002}` (InvalidFrame: malformed payload)
3. If no handler → reply `RpcError{code: 1101, message: "Method not found"}`
4. If handler doesn't reply within timeout → reply `RpcError{code: 1103, message: "Handler timeout"}`
5. If handler throws → reply `RpcError{code: 2000, message: error.message}` (default mapper)

**Note:** The frame itself is valid; only the payload (envelope) is malformed. This is a non-fatal error per SBP `InvalidFrame` semantics—the connection remains open; only the specific request fails.

**Timeout configuration:**

```ts
interface RouterConfig {
  rpcTimeoutMs: number; // Default: 30000 (30s)
}
```

### 6. Event Dispatch Rules

For the `event` channel:

1. Decode envelope (expect `RpcNotification`)
2. If decode fails → log warning, drop (no response)
3. Fan-out to all matching handlers (broadcast mode)
4. Handler errors → log warning, continue to next handler
5. No reply expected; `msg.rpc` is undefined

### 7. Error Propagation

Error handling is **configurable** via error mapper:

```ts
interface RouterConfig {
  /** Map handler errors to RPC error responses */
  errorMapper?: (error: Error, msg: InboundMessage) => RpcErrorPayload;
}

interface RpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}
```

**Default error mapper:**

```ts
const defaultErrorMapper = (error: Error): RpcErrorPayload => ({
  code: 2000, // Application error range
  message: error.message,
});
```

**Custom error mapper example:**

```ts
const router = createRouter({
  errorMapper: (error, msg) => {
    if (error instanceof ValidationError) {
      return { code: 2001, message: "Validation failed", data: error.details };
    }
    if (error instanceof NotFoundError) {
      return { code: 2002, message: "Resource not found" };
    }
    return { code: 2000, message: error.message };
  },
});
```

**Error code ranges** (see `docs/protocols/error-codes.md`):

| Range     | Owner          | Examples                                     |
| --------- | -------------- | -------------------------------------------- |
| 1000–1099 | SBP (protocol) | `InvalidFrame`, `ProtocolViolation`          |
| 1100–1199 | RPC (runtime)  | `UnsupportedMethod` (1101), `Timeout` (1103) |
| 2000+     | Application    | User-defined                                 |

### 8. Handler Scoping

The Router is a standalone object created via `createRouter()`. It has no built-in concept of session scoping — all handlers registered on a Router instance live until explicitly unsubscribed or `clear()` is called.

Session-scoped behavior is the caller's responsibility:

```ts
const router = createRouter();

// Long-lived handler
router.routePrefix("app/metrics/", metricsHandler);

// Session-scoped: unsubscribe when session closes
const unsub = router.route("app/session/state", sessionHandler);
session.on("closed", () => unsub());
```

For RPC and events, prefer the higher-level `peer.rpc.handle()` and `peer.events.on()` APIs from `@sideband/peer`, which handle lifecycle automatically. The Router API is for custom `app/` protocols or building alternative SDKs.

### 9. Preventing frameId Misuse

The API makes it hard to accidentally reuse frameId:

```ts
// WRONG: Exposing frame for modification
ctx.frame.frameId; // This would allow reuse

// RIGHT: Read-only frame, send() generates new frameId
msg.send(subject, data); // Always fresh frameId

// RIGHT: RPC reply uses cid for correlation, fresh frameId for response
msg.rpc.reply(result); // cid from request, new frameId
```

Implementation:

```ts
async function send(subject: Subject, data: Uint8Array): Promise<void> {
  const frame = createMessageFrame(subject, data); // Generates new frameId
  await session.send(encodeFrame(frame));
}

async function rpcReply(result: unknown): Promise<void> {
  const envelope: RpcSuccess = { t: "R", cid: this.cid, result };
  const frame = createMessageFrame(this.subject, encodeRpcEnvelope(envelope));
  await session.send(encodeFrame(frame));
}
```

## Alternatives Considered

| Alternative                       | Why Rejected                                                       |
| --------------------------------- | ------------------------------------------------------------------ |
| Type-locked `SubjectPrefix` union | Prevents custom prefixes; forces workarounds via `app/`            |
| `reply()` always available        | Confusing for events; RPC-specific methods belong in `rpc` context |
| Concurrent dispatch for all modes | Unpredictable ordering; sequential is safer default                |
| Glob/regex patterns               | Over-engineering for v1; prefix matching covers 95% of cases       |

## Consequences

- **Predictable dispatch**: Exact > prefix, registration order, documented rules
- **Safe API**: `send()` always generates fresh frameId; `frame` is read-only
- **Extensible prefixes**: Policy-driven, not type-locked
- **Clear RPC boundary**: `msg.rpc` only present when appropriate
- **Flexible error handling**: Custom mappers for domain-specific codes
- **Layered**: `@sideband/peer` provides high-level RPC/events APIs; the Router serves advanced use cases and custom protocols

## References

- ADR-006 (RPC envelope, channel subjects)
- ADR-008 (channel subject validation)
- ADR-009 (session lifecycle)
- ADR-010 (RPC correlation via `cid`)
- ADR-013 (peer SDK design — uses its own dispatch, not the Router)
- `docs/protocols/error-codes.md` (error code ranges)
