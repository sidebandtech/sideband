# ADR-014: Peer SDK Session Signal Handling

- **Date**: 2026-02-25
- **Status**: Accepted
- **Affects**: SDK, Runtime

## Context

SBRP relay sessions can be paused mid-flight when the relay daemon loses its upstream connection. The protocol emits control signals (`session_paused`, `session_resumed`, `session_ended`, `session_pending`) to drive lifecycle transitions. The Peer SDK must surface these to application code without leaking relay internals.

Three design problems arise:

1. **How do signals cross the negotiator boundary?** Negotiators are stateless factories; adding an event emitter to the `Negotiator` interface would couple the runtime to specific protocols.
2. **What is `paused` from the SDK consumer's perspective?** Is it a distinct state or an implementation detail of the connection layer?
3. **What does `session_ended` mean, and does it differ between client and server peers?**

## Decision

### 1. Signal propagation via `subscribeSignals` on `NegotiationResult`

```ts
interface NegotiationResult {
  // ...
  subscribeSignals?: (handler: (signal: SessionSignal) => void) => () => void;
}
```

Returning an unsubscribe function gives the SDK precise lifecycle control: on each `negotiate()` call, `PeerImpl` intercepts `subscribeSignals`, wires the handler, and tears it down on session close or reconnect — re-subscribing fresh on retry. A callback option on `Negotiator` was rejected because it gives no mechanism to swap handlers across reconnects.

### 2. `paused` as a first-class Peer state

`paused` is visible in the public `PeerState` union. Hiding it would force consumers to infer pause indirectly from failed sends, which is worse DX and harder to reason about.

**Behavior during `paused`:**

| Operation       | Behavior                                                               |
| --------------- | ---------------------------------------------------------------------- |
| `sendRaw()`     | Rejects immediately with `PeerError("session_paused")`                 |
| RPC calls       | Policy-dependent: reject if `onDisconnect: "fail"`, queue if `"pause"` |
| Event publishes | Always buffered; flushed on `session_resumed`                          |

`sendRaw` rejects because it bypasses the SDK's queuing layer — callers own flow control. Events always buffer because dropping them during pause is silent data loss. RPC queuing is opt-in (`connectionPolicy.onDisconnect: "pause"`) because callers must acknowledge the memory trade-off.

**Event emission:**

- `sessionPaused` fires on entering `paused`.
- `sessionResumed` fires on returning to `active` from `paused`.
- `connected` does NOT re-fire on resume — only on a fresh connection (non-`paused` → `active`).
- `disconnected` fires whenever the peer leaves `{active, paused}` for any other state.

### 3. `session_ended` semantics differ by peer role

`session_ended` means the remote client left the relay; the link to the daemon remains open.

**Client peer (`createPeer`):** terminate the current session; let the retry policy decide whether to reconnect. Calling `disconnect()` would move permanently to `closed` — wrong, because the signal does not mean "this peer is gone forever".

**Accepted peer (`listen`):** call `disconnect()` directly. Accepted peers have no retry semantics and exist only for the duration of an inbound connection.

### 4. `session_pending` is a no-op

`session_pending` means the daemon reconnected to the relay but has not confirmed readiness. It triggers no state transition; if currently `paused`, peers remain `paused`. Only `session_resumed` returns the peer to `active`.

## Invariants

- Signals are processed only from `active` or `paused`; signals during `connecting`, `negotiating`, or `reconnecting` are dropped.
- `subscribeSignals` unsubscribe MUST be called before establishing a new subscription (enforced by `runLoop`).
- Client peers (`PeerImpl`) MUST NOT call `disconnect()` on `session_ended` — session termination must go through the session manager so the retry policy applies.

## Consequences

- Control signals (SBRP) remain invisible to the runtime core; `SessionSignal` is a generic type with no protocol-specific fields.
- Consumers observe a clean `paused` → `active` round-trip with automatic event and optional RPC resume — no manual retry plumbing needed.
- Non-SBRP negotiators returning no `subscribeSignals` are unaffected; `paused` is never entered.

## References

- ADR-009: Runtime Session Lifecycle
- ADR-013: Peer SDK Core Design Decisions
- `packages/runtime/src/session/types.ts` — `NegotiationResult`, `SessionSignal`
- `packages/peer/src/peer.ts` — `handleSessionSignal`, `transition`
- `packages/peer/src/listen.ts` — `ConnectedPeerImpl.handleSessionSignal`
