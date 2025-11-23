# ADR 001: Protocol Versioning & Compatibility

- **Date**: 2025-11-22
- **Status**: Accepted
- **Tags**: protocol, frames, handshake

## Context

- `@sideband/protocol` is the foundation for all transports and runtimes. Breaking wire changes ripple through every package.
- Current implementation encodes frames in a binary envelope with a JSON handshake. Version fields exist (`PROTOCOL_VERSION = "1"`) but policy was undocumented.
- We need predictable rules for adding fields, handling unknown data, and reacting to version skew.

## Decision

- Version label: `"sideband/1"` (`PROTOCOL_ID`). Version is asserted during handshake; all frames on a connection share the same major version.
- Negotiation: no downgrade/upgrade; v1 endpoints accept only `version === "1"` and `protocol === "sideband"`. Future negotiation, if needed, will happen via a new major version handshake.
- Compatibility rules for v1:
  - Additive only: new optional fields, new `ControlOp`, new capability strings are allowed without a major bump.
  - Unknown fields/caps/metadata MUST be ignored, not rejected.
  - Reserved bits in the frame header MUST stay zero; receiving non-zero reserved bits is a protocol error and should close the connection.
  - Mandatory field changes (renames/removals) require a new major version.
- Error behavior on skew:
  - If `protocol` or `version` is unsupported, send `ErrorFrame{code=UnsupportedVersion}` then close.
  - If a frame is malformed or uses a reserved bit/type, send `ErrorFrame{code=ProtocolViolation}` or `InvalidFrame` then close.
- Deprecation: v1 features may be deprecated via docs/caps but remain accepted until v2 exists; removal happens only in a new major version.

## Consequences

- Implementations can evolve v1 by adding optional data without breaking peers.
- Tests must include cases where unknown `caps`/metadata are ignored and reserved bits cause rejection.
- Transports should surface version errors early (during handshake) to avoid partial session setup.
- Future major versions will introduce a new handshake version string and may reuse the same framing with different semantics; coexistence requires either separate listeners or a negotiator shim.
