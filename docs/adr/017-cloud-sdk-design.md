# ADR-017: Cloud SDK Design

- **Date**: 2026-02-27
- **Status**: Accepted
- **Affects**: Runtime, SDK

## Context

`relay.sideband.cloud` embeds a time-limited JWT in every WebSocket URL (`?token=<jwt>`).
`PeerOptions.endpoint` is a static string — reconnects reuse it unchanged, causing 401 rejections
when the token expires. Daemon presence tokens also expire (1 hour) with no renewal mechanism,
and users had to decode the JWT `sid` claim manually to construct relay URLs.

## Decision

### 1. `Negotiator.getConnectionParams()` — dynamic endpoint per attempt

A new optional method on the `Negotiator` interface in `@sideband/runtime`:

```typescript
interface NegotiatorConnectionParams {
  endpoint?: string; // overrides PeerOptions.endpoint for this attempt
  headers?: Record<string, string>; // extra headers (Node.js ws only)
}

interface Negotiator {
  getConnectionParams?(): Promise<NegotiatorConnectionParams>;
  // ...
}
```

Called before each connect attempt; result scoped to that attempt (no caching). If it throws,
the attempt fails and the peer retries per `retryPolicy`. Runs in sequence before `negotiate()`
for the same attempt — implementors may store transient state (e.g., a fetched token) between
the two calls without data races.

**Why not `endpoint` factory in `PeerOptions`?** The negotiator that resolves an endpoint also
knows how to authenticate against it. A separate factory in `PeerOptions` has no synchronization
guarantee with negotiator state.

### 2. `@sideband/cloud` — separate package

SaaS URLs and deployment-specific logic are isolated in `@sideband/cloud`. Core packages
(`@sideband/peer`, `@sideband/runtime`) contain no references to `*.sideband.cloud`.

Entry points:

- `connect(opts)` — cloud client; returns a `Peer` that auto-fetches relay sessions
- `listen(opts)` — cloud daemon; outbound relay connection with session demultiplexing

**Why not `@sideband/peer/cloud` subpath?** SaaS URLs don't belong in the open-source core —
they'd appear in bundle output and lock the core to a specific hosted product.

**Why not merge into `@sideband/peer`?** The daemon path pulls in `@sideband/transport-ws` and
a relay-specific mux loop, bloating browser bundles and conflating the generic SDK with a
specific hosted deployment model.

### 3. `RelayDaemonTransport` — inverted transport for daemon relay

Daemons do not bind a local port. The relay multiplexes frames from multiple client sessions
onto a single outbound WebSocket, each tagged by `SessionID`. `RelayDaemonTransport` implements
`Transport.listen()` by connecting outbound and demultiplexing incoming frames by `SessionID`
into virtual `RelayVirtualConn` instances.

```text
relay.sideband.cloud
    │ one outbound WebSocket per daemon
    │ SBRP frames multiplexed by SessionID
    ↓
RelayDaemonTransport.listen()
    │ HandshakeInit (new SID) → create RelayVirtualConn → handler(vconn)
    │ known SID → route frame to existing RelayVirtualConn
    │ SID=0 Control → rate_limited: continue; other: reconnect
    ↓
sbrpDaemonNegotiator per session → AcceptedPeer → onConnection(peer)
```

`peerListen()` is unchanged — it sees a stream of `TransportConnection` objects regardless of
whether they come from a local server or relay mux. Slow consumers are terminated (backpressure).
Consecutive malformed frames trigger reconnect with backoff (circuit breaker against log storms
on protocol version mismatch).

## Invariants

- `getConnectionParams()` MUST run before `negotiate()` for every attempt, in sequence.
- `@sideband/peer` and `@sideband/runtime` MUST NOT reference any `*.sideband.cloud` URLs.

## References

- ADR-013: Peer SDK Core Design Decisions
- ADR-016: Relay Server Design
- `packages/runtime/src/session/types.ts` — `Negotiator`, `NegotiatorConnectionParams`
- `packages/cloud/src/connect.ts` — `CloudClientNegotiator`
- `packages/cloud/src/listen.ts` — `RelayDaemonTransport`, `RelayVirtualConn`, `runMux`
