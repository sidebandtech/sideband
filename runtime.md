---
url: /runtime.md
---
# Runtime Behavioral Contracts

> **Authority**: Navigation (non-normative)
> **Purpose**: Index and layer boundary for runtime behavioral contracts.

The `runtime/` layer defines externally observable behavioral contracts for `@sideband/runtime` — the session lifecycle, message routing, and RPC correlation semantics that peer and application layers depend on.

These contracts sit above wire encoding. Wire-level rules remain in [`docs/protocols/`](../protocols/). Runtime docs may reference protocol docs; they MUST NOT restate or redefine wire-level invariants.

## Documents

| Document                   | Scope                                                      | Authority |
| -------------------------- | ---------------------------------------------------------- | --------- |
| [session.md](./session.md) | Session states, negotiators, retry, termination            | Primary   |
| [router.md](./router.md)   | Handler registration, dispatch ordering, error propagation | Primary   |

## Key Invariants

* A `Peer` owns zero or more `Session` instances; at most one may be `Active` per peer in v1.
* Session retry is opt-in and per-session; it uses exponential backoff.
* `Router` dispatch is deterministic: exact match before prefix, registration order within each bucket.
* `cid` (correlation ID) is set by the request and echoed unchanged by the response; the runtime matches on `cid`, never on `frameId`.

## ADRs

* [ADR-009](../adr/009-runtime-peer-lifecycle.md) — Session lifecycle design and negotiator interface
* [ADR-010](../adr/010-rpc-correlation-cid.md) — RPC correlation via `cid`
* [ADR-011](../adr/011-runtime-message-routing.md) — Message routing and dispatch rules
