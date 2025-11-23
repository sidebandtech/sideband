# ADR 006: Canonical RPC Envelope over MessageFrame

- **Date**: 2025-11-23
- **Status**: Accepted
- **Tags**: rpc, protocol-usage, type-safety

## Context

`MessageFrame` is intentionally generic (subject + opaque bytes) to keep the protocol minimal and stable. However, RPC users currently parse subject conventions manually and re-implement correlation and error handling in userland, violating "hard to misuse APIs."

The question is where to fix this: at the protocol layer (new frame kinds) or at the RPC layer (canonical envelope structure).

## Decision

1. **Keep `MessageFrame` unchanged** – the one and only application-level payload frame.

2. **Define a canonical RPC envelope** carried in `MessageFrame.data`: Request, Success Response, Error Response, Notification. Encoded as JSON (v1) or CBOR (v2+).

3. **Enforce subject namespacing**: all messages must start with `rpc/`, `event/`, `stream/`, or `app/`. Invalid subjects → `ProtocolViolation`.

4. **Zero protocol wire changes.** RPC semantics live at the `@sideband/rpc` layer, not the wire.

### Subject Namespace (Mandatory, Runtime-Validated)

All `MessageFrame.subject` values must match one of these prefixes:

| Prefix    | Purpose                       | Example                  | Allowed senders | Semantics        |
| --------- | ----------------------------- | ------------------------ | --------------- | ---------------- |
| `rpc/`    | RPC request/response          | `rpc/getUser`            | both            | Request/Response |
| `event/`  | Fire-and-forget pub/sub event | `event/user.joined`      | both            | Notification     |
| `stream/` | Streaming (reserved for v2)   | `stream/abc123/chunk`    | reserved        | (future)         |
| `app/`    | Vendor-specific (fallback)    | `app/com.example/mydata` | both            | Custom semantics |

Subjects outside these prefixes are rejected at runtime with `ProtocolViolation`.

### Envelope Schema

Request (`t: "r"`): method name + optional params.
Success Response (`t: "R"`): optional result.
Error Response (`t: "E"`): code + message + optional data.
Notification (`t: "N"`): event name + optional data.

Correlation is implicit: responses reference the request's `frameId` via `ackFrameId`.

Full schema at `docs/specs/rpc-envelope.md`.

## Consequences

- **Zero wire changes**: protocol stays minimal and stable.
- **Type-safe RPC**: branded types + runtime validation enforce correctness.
- **Predictable, hard-to-misuse**: subjects and envelopes validated at runtime.
- **Respects layering**: RPC semantics belong above the protocol, not in it.
- **Future-proof**: envelope extensible for v2 (CBOR, streaming, etc.) without protocol bumps.

## Rationale for Rejection of Alternatives

**New frame kinds (Request/Response/Notification)**: Pushes RPC semantics into the protocol, violating the minimal charter and hardening patterns that should remain flexible.

**JSON-RPC 2.0**: Verbose, opaque to the protocol, no benefit over a canonical envelope at the RPC layer.
