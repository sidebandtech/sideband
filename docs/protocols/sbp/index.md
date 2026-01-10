# Sideband Protocol (SBP)

SBP defines application-level framing for Sideband. It is topology-agnostic
and can be carried over relay (SBRP) or direct (SBDP) session layers.

## Scope

- Frame types and wire encoding
- Handshake, message, ack, error semantics
- Ordering and delivery guarantees

## Not Included

- Transport (see @sideband/transport)
- Encryption (see SBRP or SBDP)
- Authentication

## Documents

| Document                        | Status     |
| ------------------------------- | ---------- |
| [Wire Format](./wire-format.md) | Normative  |
| [Behavior](./behavior.md)       | Normative  |
| [Errors](./errors.md)           | Normative  |
| [Conformance](./conformance.md) | Supporting |

## Related ADRs

- ADR-001: Protocol versioning
- ADR-002: Naming matrix
- ADR-003: Control frame invariants
- ADR-004: Binary frame ID
- ADR-007: Immutable frame types
