# Sideband Direct Protocol (SBDP)

> **Authority**: Navigation (Non-normative)  
> **Purpose**: Overview and future roadmap for direct P2P sessions.  
> **Status: Stub** — This protocol is not yet specified.

SBDP is the planned direct (peer-to-peer) session protocol for Sideband. It will provide secure SBP transport without a relay, using direct connectivity mechanisms such as WebRTC or DTLS-based channels.

## Status

SBDP is intentionally not specified yet to avoid premature abstraction. The current architecture ensures SBDP can be added without changes to SBP or higher layers.

## Relationship to Other Protocols

| Protocol | Role                                  |
| -------- | ------------------------------------- |
| SBP      | Application framing (used unchanged)  |
| SBRP     | Relay-based secure session            |
| SBDP     | Direct secure session (this protocol) |

## Delegation

This protocol delegates:

- **Wire format**: Inherits SBP frame structure (see [sbp/wire-format.md](../sbp/wire-format.md))
- **Error codes**: Reuses SBP error semantics (see [sbp/errors.md](../sbp/errors.md))
- **Ordering**: Inherits SBP ordering guarantees (see [sbp/behavior.md](../sbp/behavior.md))

This protocol will define:

- **P2P session establishment**: Direct connection setup
- **DTLS integration**: Secure transport (likely)
- **NAT traversal**: ICE/STUN/TURN or similar

## Design Principles (Preview)

- No relay dependency
- Secure session establishment (likely DTLS or Noise)
- Reuse SBP framing unchanged
- Pluggable transport (WebRTC, raw UDP, etc.)

## Document Authority

| Concern | Primary             | Supporting |
| ------- | ------------------- | ---------- |
| All     | _Not yet specified_ | —          |

## Related Documents

- [Protocol Architecture](../stack.md): Layer stack, wrapping rules
- [SBP Specification](../sbp/): Application framing (will be used unchanged)
- [SBRP Specification](../sbrp/): Reference implementation for session layer

_No normative specification exists at this time._
