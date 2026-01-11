---
url: /protocols/rpc.md
---
# RPC Layer

> **Authority**: Navigation (Non-normative)\
> **Purpose**: Overview and navigation for RPC semantic layer.

RPC is a **semantic layer** carried inside SBP Message frames. It does not define framing, transport, or security—those are handled by SBP and the session layer (SBRP/SBDP).

## Relationship to SBP

RPC envelopes are encoded in `MessageFrame.data` with subjects prefixed `rpc/`. The frame ID provides request/response correlation.

## Delegation

This protocol delegates:

* **Wire format**: Inherits SBP frame structure (see [sbp/wire-format.md](../sbp/wire-format.md))
* **Error codes**: Reuses SBP protocol errors (1000-1999); defines application errors (2000+) in envelope.md
* **Ordering**: Inherits SBP ordering guarantees (see [sbp/behavior.md](../sbp/behavior.md))

This protocol defines:

* **Envelope format**: See [envelope.md](./envelope.md)
* **Correlation**: See [behavior.md](./behavior.md)
* **Subject namespacing**: See [envelope.md](./envelope.md)

## Errors

RPC does not define protocol-level error codes. It reuses:

* SBP protocol errors (1000-1999) — see [sbp/errors.md](../sbp/errors.md)
* Application errors (2000+) — defined per-method in envelope.md

This follows gRPC/JSON-RPC/tRPC convention: transport errors are delegated, only application errors are layer-specific.

## Documents

| Document                           | Status     |
| ---------------------------------- | ---------- |
| [envelope.md](./envelope.md)       | Normative  |
| [behavior.md](./behavior.md)       | Normative  |
| [conformance.md](./conformance.md) | Supporting |
| [streams.md](./streams.md)         | Reserved   |

## Document Authority

| Concern                    | Primary                            | Supporting |
| -------------------------- | ---------------------------------- | ---------- |
| Envelope structure         | [envelope.md](./envelope.md)       | —          |
| Request/response semantics | [behavior.md](./behavior.md)       | —          |
| Correlation                | [behavior.md](./behavior.md)       | —          |
| Test specification         | [conformance.md](./conformance.md) | —          |

## Recommended Reading Order

1. **index.md** (this document)
2. **[envelope.md](./envelope.md)** — wire format and validation
3. **[behavior.md](./behavior.md)** — semantics and timeouts

## Related ADRs

* ADR-006: RPC envelope
* ADR-010: RPC correlation (cid)
