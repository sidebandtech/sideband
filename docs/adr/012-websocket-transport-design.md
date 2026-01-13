# ADR 012: WebSocket Transport Design Decisions

- **Date**: 2025-01-13
- **Status**: Accepted
- **Applies to**: @sideband/transport-ws
- **Tags**: transport, websocket, api-design

## Context

The `@sideband/transport-ws` package implements the Transport ABI (ADR-005) for WebSocket connections. Several API design decisions required choosing between alternatives with different tradeoffs for usability, security, and correctness.

This ADR documents the key decisions and rejected alternatives for future reference.

## Architectural Invariants

These constraints are non-negotiable and apply to all decisions below:

1. **Opaque payloads**: Transport MUST treat message payloads as opaque bytes. No SBP/SBRP/RPC semantics at this layer. This preserves layer boundaries and future-proofs alternative session stacks.

2. **Topology-agnostic**: Transport behavior MUST NOT branch on relay vs direct topology. Only endpoint URLs and options differ. Runtime stays topology-agnostic.

3. **No reconnection**: Transport only reports state, close, and errors. Reconnection and backoff policies belong in `@sideband/runtime` or `@sideband/peer`. This avoids hidden policies and keeps transport minimal.

## Decisions

### 1. Single entry point vs separate browser/node exports

**Options**:

- A) Single `wsTransport()` with runtime detection
- B) Separate `@sideband/transport-ws/browser` and `/node` imports

**Chosen**: A (single entry point)

**Rationale**: Simpler for users. Bundlers tree-shake unused code anyway. The `platform` override enables testing browser code in Node. Conditional exports in package.json still provide optimal bundles.

### 2. WebSocket subprotocol enforcement default

**Options**:

- A) Enforce by default (`requireSelection: true`)
- B) Pass-through by default (`requireSelection: false`)

**Chosen**: B (pass-through by default)

**Rationale**: Transport layer should be generic. WebSocket subprotocol enforcement is Sideband-specific policy that belongs in application configuration, not transport defaults. This keeps transport-ws usable for non-Sideband WebSocket connections without fighting defaults.

Sideband applications explicitly opt-in: `{ subprotocols: { offer: ["sideband.v1"], requireSelection: true } }`.

> **Note**: WebSocket subprotocols (`Sec-WebSocket-Protocol`) are distinct from application protocols (SBP/SBRP). Transport handles WebSocket-level negotiation; application protocol negotiation happens at the SBP layer.

### 3. Auth mode in browser

**Options**:

- A) Default to query (browsers can't set headers anyway)
- B) Throw if mode not specified (force explicit choice)
- C) Silently fall back to query

**Chosen**: B (throw if not specified)

**Rationale**: Query params are visible in logs, URLs, and browser history. Developers must consciously accept this security tradeoff. Silent fallback (C) hides the problem. Default to insecure (A) is wrong.

### 4. Send buffer overflow behavior

**Options**:

- A) Reject `send()` call with `buffer_overflow`
- B) Close connection
- C) Block until buffer drains

**Chosen**: A (reject with `buffer_overflow`)

**Rationale**: Rejection is explicit and recoverable. Connection close is surprising and unrecoverable. Blocking violates non-blocking `send()` semantics in ABI. Caller can check `pendingSendBytes` for proactive backpressure. Using dedicated `buffer_overflow` kind (vs `transport_failure`) enables distinct handling in retry logic.

### 5. Inbound buffer overflow behavior

**Options**:

- A) Drop messages silently
- B) Close connection with error
- C) Apply backpressure to sender

**Chosen**: B (close connection)

**Rationale**: Silent drops violate message delivery guarantees. WebSocket has no native backpressure mechanism for inbound data. Closing is the only safe option to prevent OOM.

**Normative rule**: On inbound buffer overflow, implementations MUST close the connection with close code 1011 ("Internal Error") and `TransportError(kind: "buffer_overflow")`.

### 6. Origin validation with missing Origin header

**Options**:

- A) Reject connections without Origin
- B) Allow connections without Origin

**Chosen**: B (allow)

**Rationale**: Origin is browser-only. Non-browser clients (CLI tools, other servers) legitimately don't send it. Rejecting would break CLI-to-daemon and service-to-service use cases. Origin is for DNS rebinding protection, not authentication.

**Default policy**:

- Localhost endpoints → `"localhost"` (allow only localhost origins)
- Non-localhost endpoints → `"any"` (allow all origins)

> **Warning**: The `"any"` default is intentionally permissive for development. Production servers SHOULD configure `originPolicy` explicitly based on their security requirements.

### 7. Endpoint normalization

**Options**:

- A) Full canonicalization (sort query params, normalize ports, trailing slashes)
- B) Minimal validation (scheme check, strip hash only)

**Chosen**: B (minimal)

**Rationale**: ABI says endpoint is opaque, for diagnostics only. Canonicalization creates false expectation that endpoints can be compared for equality. Different URLs should remain different endpoints.

### 8. Server WebSocket subprotocol selection

**Options**:

- A) Fixed list only (`offer: ["sideband.v1"]`), select first match
- B) Callback for custom logic (`select: (offered) => ...`)
- C) Both: list for common case, callback for advanced

**Chosen**: C (both)

**Rationale**: Most servers just need a list. But version negotiation ("prefer v2, fall back to v1") or custom logic (logging, metrics) needs a callback. Callback is proactive (called during handshake), not reactive (after selection).

## Close Code Semantics

Implementations MUST use these WebSocket close codes:

| Code | Condition                               | TransportErrorKind  |
| ---- | --------------------------------------- | ------------------- |
| 1000 | Graceful close                          | (none)              |
| 1003 | Text frame received                     | `transport_failure` |
| 1009 | Single message exceeds `maxMessageSize` | `message_too_large` |
| 1011 | Inbound buffer overflow                 | `buffer_overflow`   |

**Graceful close**: Close code 1000 resolves the `closed` promise with `{ graceful: true }` and no `TransportError`. All other codes resolve with `{ graceful: false, error: TransportError(...) }`.

**1006 heuristic**: Code 1006 (abnormal closure) provides no reason. Implementations MUST use traffic history to disambiguate:

- 1006 + no bytes exchanged → `connection_refused` (connection failed before establishment)
- 1006 + bytes exchanged → `abnormal_close` (connection dropped mid-session)

This heuristic requires internal traffic counters (`ioBytes: { sent, received }`). The counters need not be public API, but MUST be tracked for correct error classification.

## Non-goals

Explicitly out of scope for `@sideband/transport-ws`:

- **Reconnection / backoff** → `@sideband/runtime` or `@sideband/peer`
- **Connection pooling** → `@sideband/peer`
- **Protocol framing (SBP/SBRP)** → `@sideband/protocol`, `@sideband/secure-relay`
- **Authentication verification** → Relay server / `@sideband/runtime`
- **Message serialization** → `@sideband/protocol`
- **Heartbeat policy** → `@sideband/runtime`

Transport is minimal: it connects, sends bytes, receives bytes, and closes. Everything else belongs in higher layers.

## Consequences

- API is simple for common cases (`wsTransport()` + `wsEndpoint()`) while allowing advanced configuration
- Security-sensitive choices (auth mode, origin validation) require explicit opt-in
- Transport remains generic and reusable for non-Sideband WebSocket connections
- Error handling is predictable: `buffer_overflow` is recoverable on send, fatal on receive
- Close codes are deterministic and testable

## Related

- ADR-005: Transport ABI Package
- `docs/protocols/transport/websocket.md`: WebSocket-specific behavioral spec
- `docs/protocols/transport/errors.md`: Error taxonomy including `buffer_overflow`
- `docs/protocols/transport/conformance.md`: Conformance test matrix
