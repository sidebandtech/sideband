# ADR 002: Naming Matrix for Protocol Types

- **Date**: 2025-11-22
- **Status**: Proposed
- **Tags**: protocol, transport, runtime

## Context

- Names for ids, timestamps, frame kinds, and wire keys have drifted across packages, which makes interop harder and confuses new contributors.
- We need a single source of truth that pins type names, property names, and wire-level keys, including how higher-level SDK concepts map onto protocol frames.
- The matrix should be concise enough to live near specs and code but explicit enough to guide future changes and AI-assisted edits.

## Decision

- Canonicalize on **Peer** as the intrinsic identity, using `PeerId` for type names and `peerId` for properties.
- Adopt the following naming matrix as the canonical reference for protocol-level types, wire keys, and SDK-facing naming.
- Wire keys (`t`, `id`, `ts`, `peerId`, `caps`, `s`, `b`) are internal to encode/decode; public TypeScript types expose descriptive names.
- Use these names in code, docs, tests, and public APIs; deviations require an ADR update.

**Rationale**: `PeerId` avoids collision with Node.js ecosystem terminology and aligns with modern P2P standards (libp2p, IPFS, WebRTC). `NodeId` created semantic ambiguity in browser contexts and confused process identity with network-visible peer identity.

### 1. Identity, timestamps, correlation

| Domain concept       | Type / Enum name | Field / Property | Wire key | Notes / invariants                                       |
| -------------------- | ---------------- | ---------------- | -------- | -------------------------------------------------------- |
| Peer identity        | `PeerId`         | `peerId`         | `peerId` | Stable identity of a peer node; survives reconnects      |
| Connection identity  | `ConnectionId`   | `connectionId`   | -        | Transient transport link identity; new per TCP/WebSocket |
| Session identity     | `SessionId`      | `sessionId`      | -        | Optional higher-level session across reconnects          |
| Frame identity       | `FrameId`        | `frameId`        | `id`     | Identifies this frame instance on the wire               |
| Correlation identity | `CorrelationId`  | `correlationId`  | -        | **Reserved for v2.**                                     |
| Trace identity (req) | `TraceId`        | `traceId`        | -        | Optional, spans multi-frame flows                        |
| Timestamp            | `Timestamp`      | `timestamp`      | `ts`     | `number` (ms since epoch)                                |

> `frameId` — In v1, used for request/response correlation and ACK linkage. Always present on every frame; auto-generated at construction to eliminate defensive checks in runtime/RPC layers.
> `correlationId` — Reserved for v2 when explicit tracing or multi-hop flows require separate correlation semantics.
> Helper: `generateFrameId()` creates a unique FrameId from 12 bytes of cryptographic randomness encoded as hex (16 chars).

### 2. Frames and variants

| Domain concept     | Type / Enum name | Field / Property                    | Wire key | Notes                                              |
| ------------------ | ---------------- | ----------------------------------- | -------- | -------------------------------------------------- |
| Frame discriminant | `FrameKind`      | `kind`                              | `t`      | Enum: `Control`, `Message`, `Ack`, `Error`         |
| Base frame         | `Frame`          | -                                   | -        | Union of all frame variants                        |
| Control frame      | `ControlFrame`   | `kind: FrameKind.Control`           | `t=0`    | Handshake / Ping / Pong / Close                    |
| Message frame      | `MessageFrame`   | `kind: FrameKind.Message`           | `t=1`    | Carries routable application data (RPC + pub/sub)¹ |
| Ack frame          | `AckFrame`       | `kind: FrameKind.Ack`; `ackFrameId` | `t=2`    | Acknowledges another frame²                        |
| Error frame        | `ErrorFrame`     | `kind: FrameKind.Error`             | `t=3`    | Represents protocol or app errors                  |

> 1. Message frames carry routable application data (RPC + pub/sub). Do not confuse with `AppMessage` (SDK type), which wraps decoded payloads.
> 2. `ackFrameId` references the target's `frameId`.

### 3. Control operations and payloads

| Domain concept    | Type / Enum name   | Field / Property | Wire key | Notes                                         |
| ----------------- | ------------------ | ---------------- | -------- | --------------------------------------------- |
| Control op        | `ControlOp`        | `op`             | `c`      | `Handshake`, `Ping`, `Pong`, `Close`          |
| Control data      | -                  | `data`           | -        | Optional opaque binary                        |
| Handshake payload | `HandshakePayload` | -                | -        | Contains `peerId`, `capabilities`, `metadata` |

> `c` is scoped to `ControlFrame` payloads only; never used in other frame types.
> `data` is an optional binary blob used for control frame metadata or handshake extensions.

### 4. Wire message vs application message

| Domain concept          | Type / Enum name | Field / Property  | Wire key | Notes                                       |
| ----------------------- | ---------------- | ----------------- | -------- | ------------------------------------------- |
| Routing key             | -                | `subject`         | `s`      | UTF-8 string in `MessageFrame`              |
| Raw message bytes       | -                | `data`            | `b`      | `Uint8Array`; wire is opaque bytes          |
| Wire message (frame)    | `MessageFrame`   | `subject`, `data` | `t=1`    | Routable, identity-bearing unit on the wire |
| App-level message (SDK) | `AppMessage`     | `subject`, `data` | -        | High-level concept in `@sideband/peer`      |

### 5. Errors

| Domain concept                    | Type / Enum name       | Field / Property     | Wire key | Notes                                        |
| --------------------------------- | ---------------------- | -------------------- | -------- | -------------------------------------------- |
| Protocol error code               | `ProtocolErrorCode`    | `code`               | -        | Enum, low range (e.g. 1000-1999)             |
| Application error code (optional) | `ApplicationErrorCode` | `code`               | -        | App-defined, high range (e.g. 2000+)         |
| Error frame details               | `ErrorFrame`           | `message`, `details` | -        | Optional `details` (binary); see note below. |

> `details` is an optional binary/structured payload (e.g. JSON, CBOR) carried alongside the error message.

### 6. Capabilities and metadata

| Domain concept    | Type / Enum name | Field / Property | Wire key | Notes                                            |
| ----------------- | ---------------- | ---------------- | -------- | ------------------------------------------------ |
| Capabilities list | -                | `capabilities`   | `caps`   | `string[]`, feature flags or protocol extensions |
| Peer metadata     | -                | `metadata`       | -        | `Record<string, string>` namespaced keys         |

### 7. Transports and runtime

| Domain concept            | Package / Type name           | Notes                                    |
| ------------------------- | ----------------------------- | ---------------------------------------- |
| Transport ABI and helpers | `@sideband/transport`         | Shared interfaces, no env-specific logic |
| Node.js/Bun transport     | `@sideband/transport-node`    | Node.js / Bun WebSocket adapters         |
| Browser transport         | `@sideband/transport-browser` | Browser / ServiceWorker adapters         |
| Protocol package          | `@sideband/protocol`          | `Frame`, `FrameKind`, encode/decode      |
| Runtime engine            | `@sideband/runtime`           | Peer lifecycle, routing, subscriptions   |
| Peer SDK                  | `@sideband/peer`              | High-level publish/subscribe/RPC API     |

### 8. RPC and pub/sub (higher level)

| Domain concept       | Type / Enum name         | Field / Property         | Notes                                              |
| -------------------- | ------------------------ | ------------------------ | -------------------------------------------------- |
| RPC request          | `RpcRequest`             | `id`, `method`, `params` | App-level type, carried in `MessageFrame.data`     |
| RPC response         | `RpcResponse`            | `id`, `result`, `error`  | Ditto                                              |
| Message handler kind | `HandlerKind` (optional) | -                        | For internal routing (RPC, event, broadcast, etc.) |

### 9. Helper API verbs (for AI assistants)

| Operation              | Function name          | Notes                                      |
| ---------------------- | ---------------------- | ------------------------------------------ |
| Generate frame ID      | `generateFrameId`      | `() -> FrameId`                            |
| Encode frame to bytes  | `encodeFrame`          | `Frame -> Uint8Array`                      |
| Decode bytes to frame  | `decodeFrame`          | `ArrayBufferView -> Frame`                 |
| Create message frame   | `createMessageFrame`   | `(subject, data, opts) -> MessageFrame`    |
| Create ack frame       | `createAckFrame`       | `(frameId, opts) -> AckFrame`              |
| Create error frame     | `createErrorFrame`     | `(code, message, opts) -> ErrorFrame`      |
| Create handshake frame | `createHandshakeFrame` | `(HandshakePayload, opts) -> ControlFrame` |

### AI usage hints (suitable as code comments)

> - Use `Frame` / `FrameKind` / `kind` for protocol-level variants.
> - Use `AppMessage` for application/pubsub semantics.
> - Use `peerId` for stable peer identity; `connectionId` is per link, `sessionId` spans reconnects.
> - Use `frameId` to identify frames; `correlationId` (or `traceId`) to link frames.
> - Map wire fields (`t`, `id`, `ts`, `peerId`, `caps`, `s`, `b`) only inside encode/decode; never expose them in public TS types.

## Consequences

- All packages align on shared names and wire keys with **PeerId** as the intrinsic identity, reducing ambiguity in docs, code, and AI-assisted edits.
- Eliminates naming collision with Node.js ecosystem and aligns with libp2p/IPFS/WebRTC conventions.
- Every frame has a `frameId` created by `generateFrameId()` at construction. This eliminates defensive `frameId === undefined` checks throughout runtime and RPC layers, improving code clarity and reducing bugs.
- Future additions (new frame kinds, error codes, capability keys) must extend this matrix and update the ADR.
- Tests and examples should assert the public property names while keeping wire keys scoped to codecs.
- Adding `connectionId`/`sessionId` is optional but recommended when distinguishing links or resumable sessions; codecs should keep those out-of-band unless explicitly encoded.
