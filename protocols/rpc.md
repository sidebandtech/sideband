---
url: /protocols/rpc.md
---
# RPC Layer

RPC is a **semantic layer** carried inside SBP Message frames. It does not
define framing, transport, or security—those are handled by SBP and the
session layer (SBRP/SBDP).

## Relationship to SBP

RPC envelopes are encoded in `MessageFrame.data` with subjects prefixed `rpc/`.
The frame ID provides request/response correlation.

## Documents

| Document                  | Status    |
| ------------------------- | --------- |
| [Envelope](./envelope.md) | Normative |

## Related ADRs

* ADR-006: RPC envelope
* ADR-010: RPC correlation (cid)
