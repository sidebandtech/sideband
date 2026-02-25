---
url: /adr/016-relay-server-design.md
---
# ADR-016: Relay Server Design

* **Date**: 2026-02-25
* **Status**: Accepted
* **Affects**: Runtime, SDK, Transport

## Context

The hosted Sideband relay is the infrastructure that enables browser ↔ daemon communication
through NAT. It is the bridge between `sbrpClientNegotiator` (browser/client) and
`sbrpDaemonNegotiator` (local daemon). Without a relay endpoint, the E2EE value proposition
is theoretical.

The relay must:

1. Accept WebSocket connections from daemons and clients.
2. Pair them by `daemonId` and session parameters.
3. Forward binary frames between them without decryption.
4. Handle disconnects, session cleanup, and pause/resume signaling.

The platform is built on Cloudflare Workers. Any relay design must operate within Workers
constraints: no persistent memory between requests, stateless execution model by default.

## Decision

### 1. Cloudflare Durable Objects — one DO per `daemonId`

Each active daemon routing shard (one daemon + N clients) is owned by a Durable Object keyed by
`daemonId`. The DO holds WebSocket connections and forwards frames between paired endpoints.

**Rationale:** Durable Objects are the only Cloudflare-native primitive that provides:

* Persistent in-memory state across WebSocket lifetime
* Co-location of related connections within a single execution context
* Atomic session lifecycle management without external coordination

Alternatives considered and rejected:

| Option                    | Reason rejected                                                   |
| ------------------------- | ----------------------------------------------------------------- |
| KV / R2 for state         | No push semantics; polling is incompatible with WebSocket latency |
| Global Workers state      | Stateless; no connection affinity                                 |
| External Redis / Postgres | Adds infrastructure dependency and egress latency                 |

### 2. Frame forwarding is opaque (relay never decrypts)

The relay forwards raw binary WebSocket messages without parsing SBRP frame content.
Session key material never exists on the relay — only the two endpoints (daemon and client) hold
session keys.

**Rationale:** This is a security invariant of SBRP (see `docs/protocols/sbrp/threat-model.md`).
Violating it would undermine the core E2EE promise. The relay identifies sessions by `daemonId`
and validated token claims — it never reads frame payloads.

### 3. Authentication before WebSocket upgrade

All connections authenticate before the WebSocket handshake is completed. Authentication is
handled in the edge Worker (not the Durable Object) to prevent unauthenticated connections
from consuming DO resources.

**Auth model:**

* **Daemon connections**: Long-lived API key tied to an account and `daemonId`. Validated
  against the database on first connection; cached for the DO lifetime.
* **Client connections**: Short-lived signed token (JWT) scoped to a `daemonId` and TTL.
  Issued by the API server after the client authenticates.

### 4. Token-based session routing

Connection routing uses a fixed endpoint with token-derived routing:

```
wss://{region}.relay.sideband.cloud?token=<jwt>
```

The routing key (`daemonId`) is derived exclusively from validated token claims (`did`). It MUST
NOT be duplicated in the URL path — the token is the single source of truth for `daemonId`, `role`,
and `sid`. This eliminates URL-token mismatch validation, reduces metadata leakage in logs, and
removes client-side URL construction complexity.

The edge Worker validates the JWT before upgrade, extracts `did`, and routes to the Durable Object
keyed by `daemonId`. No database lookup is needed on every frame — the DO ID is deterministic
from the token's `did` claim.

Token delivery:

* **Query parameter**: `?token=<jwt>` — required for browser WebSocket compatibility
* **Authorization header**: `Authorization: Bearer <jwt>` — preferred for programmatic clients (daemons)

Security note: query-string tokens MUST be short-lived and redacted from logs/analytics.

### 5. Pause/resume signaling

When a client connection drops, the relay emits `Control(session_ended)` to the daemon; the
daemon's `AcceptedPeer` transitions to `closed` (no pause semantics for client drops — clients
are ephemeral from the relay's perspective).

When the daemon connection closes unexpectedly, the DO emits `Control(session_paused)` to affected
clients (relay-originated control), which maps to `SessionSignal{ type: "session_paused" }` in the
SDK (see ADR-014). During `paused`, the relay does not promise payload buffering; SDK-side
buffering policy (`connectionPolicy`, `eventPolicy`) remains authoritative. After daemon
reconnect, the relay emits `Control(session_pending)` and only emits `Control(session_resumed)`
after daemon `Signal(ready)` (see `docs/protocols/sbrp/state-machine.md`). If the session is terminated (e.g., daemon deregisters or auth
expires), the relay emits `Control(session_ended)`. The client terminates the current session;
retry behavior follows the client's retry policy (see ADR-014).

## Invariants

* Relay MUST NOT inspect SBRP frame payloads.
* Session pairing MUST be deterministic from `daemonId` alone (no random sharding).
* Unauthenticated WebSocket upgrades MUST be rejected at the edge Worker before reaching the DO.
* A DO instance is authoritative for exactly one `daemonId`; multiple DOs for the same `daemonId`
  MUST NOT be allowed.

## Consequences

* `sideband-platform/packages/relay/` — new package implementing the Durable Object and edge
  Worker routing logic.
* `apps/api/` — adds WebSocket upgrade endpoint routed to the relay DO.
* `db/` — adds relay session and API key tables.
* Relay package has no dependency on `@sideband/peer`. Frame routing decisions come from
  authenticated connection context (`daemonId`, role, token claims), not SBP payload parsing.
* Cloudflare Durable Object namespace must be declared in `wrangler.toml`.

## References

* ADR-009: Runtime Session Lifecycle
* ADR-014: Peer SDK Session Signal Handling
* ADR-015: P2P Direct Protocol (SBDP) — relay-assisted ICE signaling extension noted there
* `docs/protocols/sbrp/state-machine.md`: SBRP session states forwarded by relay
* `docs/protocols/sbrp/threat-model.md`: Security invariants the relay must uphold
* `docs/protocols/sbrp/control-codes.md`: Relay notification codes (pause, resume signals)
