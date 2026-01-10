---
url: /protocols/sbdp.md
---
# Sideband Direct Protocol (SBDP)

SBDP is the planned direct (peer-to-peer) session protocol for Sideband.
It will provide secure SBP transport without a relay, using direct connectivity
mechanisms such as WebRTC or DTLS-based channels.

## Status

**Status:** Not yet specified

SBDP is intentionally not specified yet to avoid premature abstraction.
The current architecture ensures SBDP can be added without changes to SBP
or higher layers.

## Relationship to Other Protocols

| Protocol | Role                                  |
| -------- | ------------------------------------- |
| SBP      | Application framing (used unchanged)  |
| SBRP     | Relay-based secure session            |
| SBDP     | Direct secure session (this protocol) |

## Design Principles (Preview)

* No relay dependency
* Secure session establishment (likely DTLS or Noise)
* Reuse SBP framing unchanged
* Pluggable transport (WebRTC, raw UDP, etc.)

*No normative specification exists at this time.*
