---
url: /protocols.md
---
# Protocols

Sideband is a layered communication stack for browser-to-daemon communication, designed to work reliably behind NAT with end-to-end encryption.

> These specifications are implementation-neutral. You may implement them in any language or runtime, including proprietary systems, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) terms.

## Architecture

**Start here**: [Protocol Architecture](./architecture.md) defines layering, frame wrapping rules, and dependency invariants. All specifications below must be consistent with the architecture document.

```text
┌───────────────────────────────────────────────────┐
│ Application / SDK                                 │
├───────────────────────────────────────────────────┤
│ RPC (semantic envelopes inside MessageFrame.data) │
├───────────────────────────────────────────────────┤
│ SBP (application framing, routing, correlation)   │
├───────────────────────────────────────────────────┤
│ Session: SBRP (relay E2EE) or SBDP (direct P2P)   │
├───────────────────────────────────────────────────┤
│ Transport (WebSocket, WebRTC, etc.)               │
└───────────────────────────────────────────────────┘
```

| Layer          | Protocol | Status | Purpose                                |
| -------------- | -------- | ------ | -------------------------------------- |
| App Framing    | SBP      | v1     | Framing, multiplexing, message routing |
| Relay Session  | SBRP     | Draft  | E2EE sessions via relay server         |
| Direct Session | SBDP     | Design | P2P encryption (future)                |
| Semantic       | RPC      | v1     | Typed request/response patterns        |

::: info
RPC envelopes live inside `MessageFrame.data`. Session layers (SBRP/SBDP) encrypt entire SBP frames; they never inspect RPC content. See [architecture](./architecture.md) for wrapping rules.
:::

## SBP (Sideband Protocol)

Topology-agnostic framing used by all session layers. Defines frame types, message routing, and wire format.

[Read the SBP specification →](./sbp/)

## SBRP (Sideband Relay Protocol)

Default transport: secure, relay-based sessions with E2EE. The relay never sees plaintext.

[Read the SBRP specification →](./sbrp/)

## SBDP (Sideband Direct Protocol)

Future: direct P2P when both peers can establish a connection without relay.

[Read the SBDP specification →](./sbdp/)

## RPC

Typed request/response/notification semantics inside SBP message frames.

[Read the RPC specification →](./rpc/)

## Standard Documentation Pattern

Every Sideband protocol MUST contain these documents:

| Document                                       | Purpose                                              | Authority            | Required      |
| ---------------------------------------------- | ---------------------------------------------------- | -------------------- | ------------- |
| `index.md`                                     | Overview, intent, roles, delegation, authority table | Navigation only      | Yes           |
| `wire-format.md` or `cryptography-and-wire.md` | On-wire encoding, frame structure                    | Primary for encoding | Yes           |
| `behavior.md` or `state-machine.md`            | Runtime semantics, state transitions                 | Primary for behavior | Yes           |
| `errors.md`                                    | Error taxonomy, codes, retryability                  | Primary for errors   | Conditional\* |
| `conformance.md`                               | Testable invariants, test vectors                    | Test specification   | Yes           |

\*`errors.md` is required unless errors are fully delegated to a parent protocol via explicit statement in `index.md`.

**Deviations**: Any deviation from this pattern MUST be documented in the protocol's `index.md` with rationale.

### Authority Model

Documents have two authority levels:

* **Primary**: Defines canonical rules. Source of truth.
* **Supporting**: May reference and elaborate, but MUST NOT redefine.

When documents conflict:

1. **Same protocol**: Primary authority wins
2. **Cross-protocol**: architecture.md governs layer boundaries; lower-layer protocol is authoritative
3. **Unresolved**: File an issue; do not ship conflicting specs

### Authority Banners

Every protocol document MUST include an authority banner after the title:

```markdown
# Wire Format

> **Authority**: Primary (Normative)
> **Purpose**: Defines on-wire encoding for SBRP.
```

## Pattern Compliance Checklist

For each protocol, verify:

* \[ ] index.md has delegation section
* \[ ] index.md has authority table
* \[ ] index.md has recommended reading order
* \[ ] index.md contains no RFC 2119 keywords
* \[ ] All documents have authority banners with purpose line
* \[ ] Deviations from pattern are documented with rationale
* \[ ] Stubs have status banner (no RFC 2119 keywords)
