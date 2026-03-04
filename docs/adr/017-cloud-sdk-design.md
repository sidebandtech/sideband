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

- `connect(opts)` — cloud client; two auth modes (see §3)
- `listen(opts)` — cloud daemon; outbound relay connection with session demultiplexing

**Why not `@sideband/peer/cloud` subpath?** SaaS URLs don't belong in the open-source core —
they'd appear in bundle output and lock the core to a specific hosted product.

**Why not merge into `@sideband/peer`?** The daemon path pulls in `@sideband/transport-ws` and
a relay-specific mux loop, bloating browser bundles and conflating the generic SDK with a
specific hosted deployment model.

### 3. `connect()` auth modes — account vs. Quick Connect

`connect()` accepts two mutually exclusive auth modes (discriminated union at the type level):

**Account path** (`{ daemonId, getAccessToken }`): standard persistent sessions. A fresh relay
session is fetched from `api.sideband.cloud` on every connect attempt (relay rejects reused
sessionIds with 409 — treated as retryable ghost-socket collision here). `daemonId` is known
upfront. Reconnects automatically on transport drops.

**Quick Connect path** (`{ quickConnectCode }`): one-shot bootstrap using a short-lived code as
the sole credential. `redeemQuickConnectCode()` is called once — it returns the relay URL, a
session JWT, and the `daemonId` resolved server-side. After redeem, `qcRedeemed` is set to `true`
and any further `getConnectionParams()` call throws `PeerError(InvalidState)` (fatal), preventing
silent re-redeem attempts.

**Why consume-first?** The server atomically transitions the code to `redeemed` before checking
whether the daemon is online (there is no race-free pre-check). A 409 response means the code is
already burned and the daemon was offline — retrying would produce a misleading 404. The SDK
classifies 409 as fatal in QC mode so callers surface the true error immediately: "get a new code."

**Why is QC non-reconnecting?** QC codes are single-use by design. Persisting a session after the
initial bootstrap is the account path's responsibility; QC serves the "no-login" first-contact
scenario. Attempting auto-reconnect with a burned code would stall until `maxAttempts` is exhausted.

### 4. `RelayDaemonTransport` — inverted transport for daemon relay

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
- In QC mode, `getConnectionParams()` MUST NOT be called a second time after a successful redeem.
- 409 from the relay in account mode is retryable; in QC mode it is fatal (code is burned).

## References

- ADR-013: Peer SDK Core Design Decisions
- ADR-016: Relay Server Design
- `packages/runtime/src/session/types.ts` — `Negotiator`, `NegotiatorConnectionParams`
- `packages/cloud/src/connect.ts` — `CloudClientNegotiator`
- `packages/cloud/src/listen.ts` — `RelayDaemonTransport`, `RelayVirtualConn`, `runMux`
