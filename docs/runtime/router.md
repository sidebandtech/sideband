# Message Routing

> **Authority**: Primary (Behavioral)  
> **Purpose**: Normative behavioral contract for handler registration, dispatch ordering, and error propagation.

The router dispatches decoded `MessageFrame` payloads to registered handlers. It has no knowledge
of transport connections or session encryption. See ADR-011 for the full normative specification.

## Layer Boundary

| Layer   | Responsibility                          | Does NOT handle            |
| ------- | --------------------------------------- | -------------------------- |
| Session | Negotiation, encryption, session state  | Message dispatch, handlers |
| Router  | Handler registry, dispatch, correlation | Connection management      |
| Handler | Application logic                       | Frame framing or routing   |

---

## Subject Classification

Every inbound `MessageFrame` is classified by subject before dispatch:

| Subject  | Kind       | Dispatch mode                                                 |
| -------- | ---------- | ------------------------------------------------------------- |
| `rpc`    | `rpc`      | `exclusive` — first matching handler only; handler MUST reply |
| `event`  | `event`    | `broadcast` — all matching handlers; no reply                 |
| `stream` | `reserved` | Rejected — `ErrorFrame{code: 1003}`                           |
| `app/*`  | `custom`   | `broadcast` by default; configurable                          |

Subjects are validated against the canonical subject policy (ADR-008). Subject validation is
separate from handler presence: unhandled RPC requests map to RPC "method not found", while
unhandled events/custom subjects are dropped after classification.

---

## Dispatch Ordering

1. Exact-match handlers take priority over prefix handlers.
2. Among prefix handlers, longer prefix wins.
3. Within the same bucket, handlers are called in registration order.
4. In `exclusive` mode (RPC), only the first matching handler is invoked.
5. In `broadcast` mode (event, custom), all matching handlers are invoked sequentially.

---

## Handler Registration

The runtime `Router` itself is not session-scoped. Handlers stay registered until explicitly
unsubscribed or `router.clear()` is called; callers may layer session-scoped cleanup on top.

```typescript
// Register for the session lifetime
const unsubscribe = router.route("rpc", rpcDispatchHandler);

// Prefix match (app/*)
const unsubscribePrefix = router.routePrefix("app/", customHandler);

// Deregister
unsubscribe();
unsubscribePrefix();
```

Registering the same method twice is allowed at the router level — the `"rpc_method_already_registered"`
error is enforced by the `Peer` SDK layer, not the router.

---

## Inbound Message Shape

Every handler receives an `InboundMessage`:

```typescript
interface InboundMessage {
  readonly subject: Subject;
  readonly payload: Uint8Array;
  readonly peerId: PeerId;
  readonly session: Session;
  readonly frame: Readonly<MessageFrame>; // read-only: frameId must not be reused

  send(subject: Subject, data: Uint8Array): Promise<void>; // fresh frameId always generated
  readonly rpc?: RpcContext; // present only when subject === "rpc" and envelope is valid
}

interface RpcContext {
  readonly method: string;
  readonly params: unknown;
  readonly cid: FrameId; // echo unchanged in response
  reply(result?: unknown): Promise<void>;
  error(code: number, message: string, data?: unknown): Promise<void>;
}
```

---

## RPC Dispatch Rules

- The `rpc` subject is `exclusive` — only one handler matches per request.
- The handler MUST call `rpc.reply()` or `rpc.error()` exactly once. Failing to reply causes
  the caller to wait until its timeout fires.
- If the message has subject `rpc` but an invalid RPC envelope, the router rejects it with
  `ErrorFrame{code: 1002}` (see `docs/protocols/rpc/`).
- `cid` is the request's correlation ID — it MUST be echoed in the response. `frameId` is
  hop-local and is never used for RPC correlation (see ADR-010).

---

## Event Dispatch Rules

- The `event` subject is `broadcast` — all registered handlers receive the message.
- Handler errors do not abort dispatch to remaining handlers. Errors are forwarded through the
  router/runtime error handling pipeline.
- No reply is sent for event messages. If a handler calls `send()`, it creates a new independent
  message, not a response.

---

## Invariants

- `send()` always generates a fresh `frameId`. The `frame` field is read-only to prevent
  accidental frameId reuse (see ADR-004, ADR-007).
- `reservedChannels` always take precedence over `allowedChannels`.
- Event handler errors are logged and do not abort dispatch to remaining handlers.
- Handler lifecycle is explicit (`unsubscribe` / `clear`) unless a higher layer adds session
  cleanup behavior.
- `cid` is echoed unchanged from request to response; `frameId` is hop-local and never reused
  for correlation.

---

## Full Specification

See [ADR-011](../adr/011-runtime-message-routing.md) for the complete normative spec, including
the `Router` interface, `SubjectPolicy`, and error propagation details.

## Related Documents

- ADR-008: Channel Subject Validation
- ADR-010: RPC Correlation via `cid`
- ADR-011: Runtime Message Routing (normative)
- `docs/protocols/rpc/envelope.md` — RPC wire format
- `docs/runtime/session.md` — Session lifecycle (caller-managed integration with router)
