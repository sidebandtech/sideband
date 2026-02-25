---
url: /protocols/sbdp/design.md
---
# SBDP Design

> **Authority**: Informational (Non-normative)\
> **Purpose**: Design decisions and open questions for the SBDP specification.\
> **Status**: Pre-specification — architectural direction is set; wire format and transport bindings are not yet defined.

This document records the design rationale and open questions for the Sideband Direct Protocol
(SBDP). It is a prerequisite to writing the normative SBDP specification. See ADR-015 for the
key architectural decisions.

***

## Goals

* Secure, authenticated SBP sessions without relay infrastructure.
* Same `Peer` SDK API as relay mode — no user-facing API changes.
* Works on local networks and daemon-to-daemon connectivity; handles NAT traversal via relay-
  assisted ICE signaling as a fallback path.

## Non-Goals

* Peer discovery (application responsibility).
* Replacing the relay for scenarios where NAT traversal requires it.
* New framing or RPC semantics — SBP frames are used unchanged.

***

## Relationship to SBRP

SBDP and SBRP are both session layers that wrap SBP frames with encryption. They differ in role
symmetry and relay dependency:

| Dimension       | SBRP                                        | SBDP                                   |
| --------------- | ------------------------------------------- | -------------------------------------- |
| Relay required  | Yes                                         | No                                     |
| Client identity | Anonymous                                   | Noise static key (X25519, TOFU pinned) |
| Daemon identity | Ed25519 (pinned via TOFU)                   | Noise static key (X25519, TOFU pinned) |
| Handshake       | Relay-mediated init/accept                  | Direct Noise XX exchange               |
| NAT traversal   | Relay handles it                            | ICE/STUN or relay-assisted fallback    |
| Pause/resume    | Relay signals pause when daemon disconnects | N/A — connection is direct             |

Both protocols deliver an encrypted `SessionChannel` to the runtime. The runtime and all higher
layers (router, RPC, events) are identical regardless of which session layer is active.

***

## Cryptographic Design

### Noise XX

The handshake uses [Noise XX](https://noiseprotocol.org/noise.html#interactive-handshake-patterns-fundamental),
which provides:

* Mutual authentication (both parties authenticate their static keys).
* Forward secrecy (ephemeral keys per session).
* Implicit MITM protection in both directions.

Key material:

| Key               | Type              | Scope                                                                                           |
| ----------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| Static keypair    | X25519            | Noise static key (TOFU pinned); required for both peers                                         |
| Identity keypair  | Ed25519           | Optional; if present, MUST be bound to Noise static key for cross-transport identity continuity |
| Ephemeral keypair | X25519            | Per-session, discarded after handshake                                                          |
| Session keys      | ChaCha20-Poly1305 | Per-direction, derived from Noise handshake                                                     |

Cipher suite is fixed (no negotiation) — same design principle as SBRP: one suite, zero
negotiation overhead.

### TOFU Identity Pinning

Both sides pin each other's static public key on first connection. Subsequent connections
verify against the pinned key. Key mismatch is a fatal error — same behavior as SBRP
(see `docs/protocols/sbrp/authentication.md`). Unlike SBRP, both peers (including
daemon/server implementations) MUST persist pinned keys via an `identityKeyStore`.

***

## Transport Options

SBDP is transport-agnostic. The session layer wraps whatever `TransportConnection` is provided:

| Scenario                        | Transport                        |
| ------------------------------- | -------------------------------- |
| Browser ↔ daemon (same network) | WebRTC DataChannel               |
| Browser ↔ daemon (NAT)          | WebRTC DataChannel with ICE/STUN |
| Daemon ↔ daemon                 | QUIC, TCP                        |

The transport implements `TransportConnection` from `@sideband/transport` (see ADR-005).

***

## NAT Traversal

For browser contexts, WebRTC ICE handles NAT hole-punching. The signaling exchange (SDP and ICE
candidates) requires a side channel. Two approaches:

**Option A — Out-of-band signaling (simple):** Application code exchanges ICE candidates via
any available channel (HTTP, existing SBRP relay, WebSocket). SDK provides ICE candidate
serialization helpers; transport assembly is application responsibility.

**Option B — Relay-assisted ICE (integrated):** The SBRP relay forwards ICE candidate frames
between client and daemon during the upgrade negotiation, then the SBDP session takes over.
The relay sees only opaque ICE candidate blobs — no keys.

Option B is preferred for the SDK integration path. It requires an SBRP extension to define
upgrade signaling message types and ordering.

***

## Session Lifecycle

SBDP does not have relay-mediated pause/resume (there is no relay to signal the peer). Instead:

* Connection loss maps directly to `reconnecting` in the `Peer` state machine.
* Reconnection uses the same retry policy as SBP sessions.
* TOFU-pinned keys persist across reconnections; each new handshake MUST re-verify against the
  pinned key.

***

## Open Questions

*These must be resolved before writing the normative specification.*

1. **Noise transcript details**: ADR-015 selected Noise XX, but the spec still needs exact
   transcript binding rules (capabilities/metadata binding, downgrade resistance markers).

2. **Session resumption**: Should SBDP support resuming an interrupted session (continuing
   sequence counters) or always create fresh sessions? SBRP punts this to the relay.

3. **Relay upgrade signal format**: What exact message type and encoding carries ICE candidates
   over SBRP? Needs coordination with the relay server design.

4. **WebRTC fingerprint binding**: WebRTC DTLS requires a certificate, not a raw key. The Noise
   XX static key and the DTLS certificate are independent unless explicitly bound. Without binding,
   a transport-layer MITM could observe connection metadata or selectively drop frames even though
   Noise XX protects payload confidentiality. The spec must define how to bind the DTLS certificate
   fingerprint to the Noise handshake (e.g., derive from shared entropy or verify against a hash
   exchanged during Noise XX).

5. **Multi-homed connections**: Can a daemon maintain both an SBRP relay connection and an SBDP
   direct connection simultaneously, with clients choosing? How does the SDK surface this?

6. **Relay-assisted discovery**: When a client connects to a daemon via relay, the daemon knows
   its own local addresses. Should the daemon advertise local discovery hints (LAN IP, mDNS name)
   through the relay session so the client can attempt a direct upgrade on subsequent connections?
   Without this, SBDP requires out-of-band address configuration, which makes it effectively
   opt-in-only for technical users. A `ConnectionBundle` or similar mechanism could make direct
   connections transparent.

***

## Related Documents

* [ADR-015](../../adr/015-p2p-direct-protocol.md): Key design decisions
* [SBDP Overview](index.md): Stub and relationship to other protocols
* [SBRP Specification](../sbrp/): Reference implementation for session layer pattern
* [Protocol Stack](../stack.md): Layer boundaries and wrapping rules
