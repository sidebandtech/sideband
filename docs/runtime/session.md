# Session Lifecycle

> **Authority**: Primary (Behavioral)  
> **Purpose**: Normative behavioral contract for session lifecycle, negotiators, retry policy, and termination ordering.  
> **Status: Stub** — Normative content is captured in [ADR-009](../adr/009-runtime-peer-lifecycle.md) pending promotion to this document.

## Layer Boundary

Session management sits between the transport (raw bytes) and the router (frame dispatch). It is responsible for negotiation, encryption wrapping, and lifecycle state — never for message routing or handler registration.

| Layer     | Responsibility                          | Does NOT handle            |
| --------- | --------------------------------------- | -------------------------- |
| Transport | Connection, byte streams                | Framing, security, routing |
| Session   | Negotiation, encryption, session state  | Message dispatch, handlers |
| Router    | Handler registry, dispatch, correlation | Connection management      |

## State Machine

```
Idle → Connecting → Negotiating → Active ⇄ RetryWait
                                 └──────────────────→ Idle (fatal / terminate())
```

| State         | Meaning                                               |
| ------------- | ----------------------------------------------------- |
| `Idle`        | No session. Initial and terminal state.               |
| `Connecting`  | Transport `connect()` in progress.                    |
| `Negotiating` | Transport open; negotiator establishing channel.      |
| `Active`      | Ready for message exchange.                           |
| `RetryWait`   | Waiting before retry attempt (retry must be enabled). |

## Invariants

- At most one `Session` may be `Active` per `Peer` in v1.
- `terminate()` MUST be idempotent and cancel pending retries.
- On retry, the existing session is replaced; retries never create parallel sessions.
- When a `SessionChannel` distinct from the transport is present, the runtime MUST close the channel before closing the transport.
- Negotiators MUST classify `ProtocolViolation` and `UnsupportedVersion` as fatal per SBP spec.
- Session `state` is observable; application code SHOULD NOT branch on internal states — use events instead.

## Full Specification

See [ADR-009](../adr/009-runtime-peer-lifecycle.md) for the complete normative spec including the `Negotiator` interface, `RetryPolicy`, `SessionEvents`, and termination ordering.
