# Glossary

Concise definitions for terms used in Sideband protocol, transports, and runtime.

- **Peer**: A runtime process participating in Sideband; network-visible participant.
- **PeerId**: Stable identifier for a peer; persists across reconnects and transport changes.
- **Connection**: A single transport link (TCP/WebSocket/etc.) between two peers; `connectionId` differentiates links.
- **Session**: Optional logical continuity across reconnects between two peers; `sessionId` can be used for resumption.
- **Frame**: Base envelope on the wire. `FrameKind` discriminates variants.
  - **ControlFrame**: `FrameKind.Control` (handshake, ping/pong, close).
  - **MessageFrame**: `FrameKind.Message` (application data).
  - **AckFrame**: `FrameKind.Ack` (acknowledges another frame).
  - **ErrorFrame**: `FrameKind.Error` (protocol or application errors).
- **subject**: Routing key inside a `MessageFrame`; string.
- **data**: Opaque binary data in `MessageFrame` or `ControlFrame`; `Uint8Array`. Required in `MessageFrame`, optional in `ControlFrame`.
- **details**: Opaque binary error details in `ErrorFrame`; `Uint8Array`. Optional.
- **capabilities**: Feature flags advertised during handshake; string array.
- **metadata**: Namespaced key/value strings advertised during handshake.
