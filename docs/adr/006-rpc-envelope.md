# ADR 006: Canonical RPC Envelope over MessageFrame

- **Date**: 2025-11-23
- **Status**: Accepted
- **Applies to**: RPC
- **Tags**: rpc, protocol-usage, type-safety

## Context

`MessageFrame` is intentionally generic (subject + opaque bytes) to keep the protocol minimal and stable. However, RPC users currently parse subject conventions manually and re-implement correlation and error handling in userland, violating "hard to misuse APIs."

The question is where to fix this: at the protocol layer (new frame kinds) or at the RPC layer (canonical envelope structure).

## Decision

1. **Keep `MessageFrame` unchanged** – the one and only application-level payload frame.

2. **Define a canonical RPC envelope** carried in `MessageFrame.data`: Request, Success Response, Error Response, Notification. Encoded as JSON (v1) or CBOR (v2+).

3. **Enforce subject namespacing**: all messages must use channel subjects (`rpc`, `event`, `stream`) or the `app/` prefix. Invalid subjects → `ProtocolViolation`.

4. **Zero protocol wire changes.** RPC semantics live at the `@sideband/rpc` layer, not the wire.

### Subject Namespace (Mandatory, Runtime-Validated)

All `MessageFrame.subject` values must be exact channel matches or use the `app/` prefix:

| Subject  | Purpose                     | Dispatch by    | Semantics        |
| -------- | --------------------------- | -------------- | ---------------- |
| `rpc`    | All RPC request/response    | `envelope.m`   | Request/Response |
| `event`  | All fire-and-forget events  | `envelope.e`   | Notification     |
| `stream` | Streaming (reserved for v2) | —              | (future)         |
| `app/*`  | Vendor-specific (fallback)  | Subject/custom | Custom semantics |

**Channel subjects model:** `rpc`, `event`, and `stream` are exact-match channels. The subject identifies the message _class_, not the specific method or event. Method/event dispatch happens via envelope fields (`m` for RPC methods, `e` for event names).

Benefits:

- Single source of truth (envelope owns semantics)
- No subject/envelope mismatch possible
- Simpler subject cardinality

Subjects outside these channels (or not prefixed with `app/`) are rejected at runtime with `ProtocolViolation`.

### Envelope Schema

Request (`t: "r"`): method name + optional params.
Success Response (`t: "R"`): optional result.
Error Response (`t: "E"`): code + message + optional data.
Notification (`t: "N"`): event name + optional data.

Correlation is explicit: responses copy the request's `cid` (correlation ID) field.
The `cid` field is set to the request frame's own `frameId` and copied unchanged by the server into all response envelopes.

See ADR-010 for the complete correlation design rationale.

Full schema at `docs/protocols/rpc/envelope.md`.

## Consequences

- **Zero wire changes**: protocol stays minimal and stable.
- **Type-safe RPC**: branded types + runtime validation enforce correctness.
- **Predictable, hard-to-misuse**: subjects and envelopes validated at runtime.
- **Respects layering**: RPC semantics belong above the protocol, not in it.
- **Future-proof**: envelope extensible for v2 (CBOR, streaming, etc.) without protocol bumps.

## Rationale for Rejection of Alternatives

**New frame kinds (Request/Response/Notification)**: Pushes RPC semantics into the protocol, violating the minimal charter and hardening patterns that should remain flexible.

**JSON-RPC 2.0**: Verbose, opaque to the protocol, no benefit over a canonical envelope at the RPC layer.
