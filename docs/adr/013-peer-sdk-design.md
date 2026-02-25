# ADR-013: Peer SDK Core Design Decisions

- **Date**: 2026-02-24
- **Status**: Accepted
- **Affects**: SDK, Runtime, Transport

## Context

`@sideband/peer` is the primary consumer-facing SDK wrapping the runtime and transport layers. Several design choices have cross-layer normative implications — they constrain implementation across `@sideband/secure-relay`, `@sideband/runtime`, and `@sideband/peer`. This ADR formalizes the two most architecturally significant decisions from the RFC development cycle.

## Decisions

### 1. SBRP Negotiator Role Separation

**Options:**

- A) Single `sbrpNegotiator(options: SbrpNegotiatorOptions)` with all options in one bag
- B) Discriminated union: `sbrpNegotiator({ role: "client" | "daemon", ...options })`
- C) Separate factories per role

**Chosen:** C (separate factories)

```typescript
/** Client-side SBRP (browser or CLI connecting to a daemon) */
function sbrpClientNegotiator(options: SbrpClientOptions): Negotiator;

/** Daemon-side SBRP (service accepting relay connections) */
function sbrpDaemonNegotiator(options: SbrpDaemonOptions): Negotiator;
```

**Rationale:** `SbrpNegotiatorOptions` mixes client-only fields (TOFU pinning, `onFirstConnection`, `trustPolicy`, `controlPlaneUrl`) with daemon-only fields (`serverIdentity`, `resumable`, `pauseBufferLimitBytes`). Options A and B allow invalid combinations to compile and fail only at runtime — violating the "hard to misuse" design goal. Separate factories give each role a dedicated, focused type with unambiguous autocomplete and error messages.

**Note:** The single `sbrpNegotiator()` function was abandoned during design — it was never shipped. No migration/deprecation path is needed.

### 2. NATS-Style Event Pattern Syntax

**Decision:** Pub/sub event names and subscription patterns use NATS-style dot-separated syntax.

**Grammar:**

```
event_name = segment ("." segment)*
segment    = token | "*" | ">"
token      = 1*SAFE_CHAR
SAFE_CHAR  = ALPHA | DIGIT | "-" | "_"
```

**Wildcards** (subscription patterns only; invalid in literal event names):

| Wildcard | Meaning                                                 |
| -------- | ------------------------------------------------------- |
| `*`      | Matches exactly one segment                             |
| `>`      | Matches one or more segments; MUST be the final segment |

**Constraints:**

- Max length: 255 bytes UTF-8
- Case-sensitive: `User.Created` ≠ `user.created`
- No empty segments, no leading/trailing dots
- `**` is explicitly forbidden (this is not a glob syntax)
- `*` and `>` must each occupy an entire segment

**Normative rules:**

1. Patterns are validated at `onPattern()` call time.
2. Invalid patterns throw `PeerError` with code `invalid_pattern`.
3. `**` MUST be rejected with an error directing the user to `>`.

**Rationale:** NATS semantics are proven in production messaging systems, have a simple non-regex matching implementation, and are familiar to pub/sub developers. Explicit prohibition of `**` prevents confusion with filesystem glob patterns.

## Consequences

- `@sideband/peer` exposes `sbrpClientNegotiator` and `sbrpDaemonNegotiator`. They live in peer (not secure-relay) because peer already depends on runtime for `Negotiator`/`SbpNegotiator`, while secure-relay stays a pure crypto library with zero runtime dependencies.
- `@sideband/peer` validates event patterns client-side via `onPattern()` / `validatePattern()`.
- All documentation and examples MUST use `>` (not `**`) for multi-segment wildcard patterns.

## References

- `docs/sdk/peer.md` §6.4, §6.8 — Peer SDK RFC (SBRP negotiator and pub/sub API)
- ADR-008: Channel Subject Validation
- ADR-006: RPC Envelope
