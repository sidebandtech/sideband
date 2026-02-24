# Message Routing

> **Authority**: Primary (Behavioral)
> **Purpose**: Normative behavioral contract for handler registration, dispatch ordering, and error propagation.
> **Status: Stub** — Normative content is captured in [ADR-011](../adr/011-runtime-message-routing.md) pending promotion to this document.

## Layer Boundary

The router dispatches decoded `MessageFrame` payloads to registered handlers. It has no knowledge of transport connections or session encryption.

## Dispatch Ordering

1. Exact-match handlers take priority over prefix handlers.
2. Among prefix handlers, longer prefix wins.
3. Within each bucket, handlers are called in registration order.
4. `exclusive` mode: first matching handler only. `broadcast` mode: all matching handlers sequentially.

## Subject Classification

| Subject  | Kind       | Default mode |
| -------- | ---------- | ------------ |
| `rpc`    | `rpc`      | `exclusive`  |
| `event`  | `event`    | `broadcast`  |
| `stream` | `reserved` | — (rejected) |
| `app/*`  | `custom`   | `broadcast`  |

## Invariants

- `send()` always generates a fresh `frameId`; `frame` is read-only to prevent accidental reuse.
- If `classify()` returns `"rpc"`, the message MUST contain a valid RPC envelope; otherwise it is rejected with `ErrorFrame{code: 1002}`.
- `reservedChannels` always take precedence over `allowedChannels`.
- Event handler errors are logged and do not abort dispatch to remaining handlers.
- Session-scoped handlers are cleared after the `closed` event fires.
- `cid` is echoed unchanged from request to response; `frameId` is hop-local and never reused for correlation.

## Full Specification

See [ADR-011](../adr/011-runtime-message-routing.md) for the complete normative spec including the `Router` interface, `InboundMessage`, `RpcContext`, `SubjectPolicy`, RPC/event dispatch rules, and error propagation.
