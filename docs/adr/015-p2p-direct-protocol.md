# ADR-015: P2P Direct Protocol (SBDP)

- **Date**: 2026-02-25
- **Status**: Accepted
- **Affects**: Protocol, SDK, Transport

## Context

SBRP provides E2EE sessions via a relay server. This works for the primary use case (browser ↔
daemon behind NAT) but introduces relay latency and requires relay infrastructure. Two scenarios
call for a direct session layer (SBDP):

1. **Same-network access** — daemon and client are on the same LAN; relay adds unnecessary round-trip latency.
2. **Direct daemon-to-daemon** — two server-side peers in the same datacenter or VPC do not benefit from relay.

The existing architecture was designed to accommodate SBDP without changes to SBP or higher layers.
This ADR records the key design decisions before specification work begins, so that speculative P2P
design is not driven by premature implementation.

## Decisions

### 1. Defer until relay is stable

SBDP will not be specified until the hosted relay (SBRP) is production-stable and user demand for
direct sessions is validated. The architecture is ready; the implementation is intentionally deferred.

**Rationale:** Premature P2P complexity risks polluting the negotiator contract and transport ABI
before they are fully validated in production. The relay path gives real data on session lifecycle
edge cases that SBDP will inherit.

### 2. Noise XX (mutual authentication) — not Noise NK

SBRP uses asymmetric authentication: the daemon has an identity keypair; the client has no persistent
identity. SBDP requires mutual authentication because both sides are peers with equal standing.

**Chosen protocol:** Noise XX — both sides authenticate their Noise static keypairs (X25519)
during the handshake. If Sideband Ed25519 identities are used, they MUST be cryptographically
bound to the Noise static key (binding details deferred to the SBDP specification).

**Consequences:**

- Both parties must provision Noise static keypairs before a direct session.
- TOFU pinning applies to both directions independently.
- MITM detection works in both directions.
- `sbdpNegotiator()` requires a Noise static keypair from both sides (unlike `sbrpClientNegotiator`
  where the client has no persistent identity).

### 3. Transport is pluggable; no single P2P transport is mandated

SBDP is a session layer that wraps SBP frames — it does not mandate a specific P2P transport.

| Context           | Transport                                 |
| ----------------- | ----------------------------------------- |
| Browser ↔ browser | WebRTC DataChannel                        |
| Browser ↔ daemon  | WebRTC DataChannel (or QUIC if supported) |
| Daemon ↔ daemon   | QUIC, raw TCP                             |

Each transport implements `TransportConnection` (see ADR-005). SBDP does not inspect which
transport is in use.

### 4. NAT traversal via relay-assisted ICE signaling

Browser-based P2P requires ICE/STUN/TURN for NAT traversal. The preferred strategy is to use the
existing SBRP relay connection only for ICE candidate exchange (signaling), then transition to
a direct WebRTC DataChannel once the hole punch succeeds.

- **Happy path**: relay forwards ICE candidates → direct DataChannel connected → Noise XX
  handshake completes over the direct transport → SBRP connection closed. SBRP MUST NOT be
  closed before the direct SBDP session is cryptographically active.
- **Fallback**: if direct DataChannel cannot be established (symmetric NAT), remain on relay (SBRP).

The transition is modeled as a negotiator-managed channel switch (new `SessionChannel`), not as a
new public peer state. No user API change is needed; the active channel is an internal concern of
the negotiator/runtime boundary.

### 5. Peer discovery is out of scope for the SDK

SBDP assumes the remote peer's address (or ICE candidates) are known. How peers discover each other
is an application concern:

- **Local network**: mDNS / Bonjour, explicit IP configuration
- **Same datacenter**: service registry, DNS SRV
- **Internet**: rendezvous server, relay-assisted

Discovery APIs will not be added to `@sideband/peer`. Applications resolve addresses and pass them
to the transport.

## Invariants

- SBDP MUST treat SBP frames as opaque bytes — no inspection of subjects or frame content.
- Both peers in an SBDP session MUST provision Noise static keypairs (X25519) before the handshake
  begins.
- TOFU pinning MUST be applied in both directions.
- The transport ABI (ADR-005) is unchanged; SBDP introduces no new transport primitives.

## Alternatives Considered

**Noise NK / NX**: One-sided authentication like SBRP. Rejected because SBDP peers have symmetric
roles — forcing one side to be anonymous weakens the security model without simplifying the API.

**DTLS**: Widely deployed but not available as a WebCrypto primitive in browsers. Would require
a WASM implementation or platform-specific code path, complicating the transport abstraction.

**QUIC for browsers**: Not yet widely available via WebTransport in all targets. Deferred to a
later transport implementation; SBDP does not depend on it.

## Consequences

- `@sideband/sbdp` will be a new package (parallel to `@sideband/secure-relay`) when implemented.
- `sbdpNegotiator()` will live in `@sideband/peer` (same pattern as SBRP negotiators, see ADR-013).
- `@sideband/transport-webrtc` will be a separate package implementing the transport ABI for WebRTC.
- No changes to SBP, runtime, router, or RPC layers.
- Mutual TOFU means the daemon/server side will need an `identityKeyStore` to persist and validate
  inbound client keys — a new requirement compared to SBRP where clients are anonymous.
- Relay-assisted ICE signaling requires a coordination message type in the relay protocol — this
  will be specified as an SBRP extension when SBDP design begins.

## References

- ADR-005: Transport ABI
- ADR-009: Runtime Session Lifecycle (negotiator contract)
- ADR-013: Peer SDK Design (negotiator factory pattern)
- ADR-014: Session Signal Handling (pause/resume semantics for SBRP)
- `docs/protocols/sbdp/index.md`: SBDP protocol stub
- `docs/protocols/sbdp/design.md`: SBDP design document
- `docs/protocols/sbrp/`: Reference implementation for session layer pattern
