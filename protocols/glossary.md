---
url: /protocols/glossary.md
---
# Protocol Glossary

> **Authority**: Supporting (Reference)\
> **Purpose**: Canonical definitions for cross-protocol terminology.

Terms defined here are authoritative. Protocol-specific index.md files SHOULD link here and MAY include a Local Terminology section for protocol-scoped terms.

## Identity & Session

| Term         | Definition                                                          |
| ------------ | ------------------------------------------------------------------- |
| PeerId       | Stable identity of a peer node; survives reconnects                 |
| SessionId    | 8-byte identifier for a relay session (SBRP); bound to token claims |
| FrameId      | 16 opaque bytes identifying a frame instance on wire                |
| ConnectionId | Transient transport link identity; new per TCP/WebSocket            |

## Cryptographic

| Term          | Definition                                                                             |
| ------------- | -------------------------------------------------------------------------------------- |
| TOFU          | Trust-On-First-Use identity pinning; client pins daemon public key on first connection |
| Identity Key  | Long-lived Ed25519 keypair for daemon authentication                                   |
| Ephemeral Key | Per-session X25519 keypair for key exchange                                            |
| Session Key   | Derived HKDF key for symmetric encryption                                              |
| Replay Window | Bitmap-based sliding window for sequence validation                                    |

## Framing

| Term      | Definition                                                                  |
| --------- | --------------------------------------------------------------------------- |
| Frame     | Protocol data unit with header + payload; see FrameKind for variants        |
| FrameKind | Discriminant enum: Control, Message, Ack, Error (SBP) or frame types (SBRP) |
| Envelope  | RPC structure inside MessageFrame.data; see RPC envelope spec               |
| Payload   | Frame body after the header; semantics depend on frame type                 |

## Protocol Layers

| Term | Definition                                                      |
| ---- | --------------------------------------------------------------- |
| SBP  | Sideband Protocol - topology-agnostic application framing       |
| SBRP | Sideband Relay Protocol - E2EE sessions via relay server        |
| SBDP | Sideband Direct Protocol - P2P sessions (future)                |
| RPC  | Request/response/notification semantics inside SBP MessageFrame |

## SBRP-Specific

| Term                 | Definition                                                           |
| -------------------- | -------------------------------------------------------------------- |
| Relay                | Routing authority and token validator; not an encryption endpoint    |
| Client               | Session initiator with ephemeral keys; no persistent crypto identity |
| Daemon               | Long-lived agent with Ed25519 identity; reachable via relay          |
| Control Frame (SBRP) | Relay-generated notifications (0x20); distinct from SBP ControlFrame |
| Signal Frame         | Daemon-to-relay session lifecycle commands (ready/close)             |
| Nonce Monotonicity   | Sequence numbers must strictly increase per direction                |
