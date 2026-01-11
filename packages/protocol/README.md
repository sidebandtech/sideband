# @sideband/protocol

Canonical Sideband wire contract: branded IDs, protocol constants/error codes, frame + handshake shapes, and binary codec. No I/O, runtime logic, or transport definitions.

## Install

```bash
bun add @sideband/protocol
```

## Quick use

```ts
import {
  FrameKind,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  createHandshakeFrame,
  createMessageFrame,
  encodeFrame,
  decodeFrame,
  encodeHandshake,
  asPeerId,
  asSubject,
} from "@sideband/protocol";

// Build a handshake frame
const handshake = createHandshakeFrame(
  encodeHandshake({
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    peerId: asPeerId("peer-123"),
    caps: ["rpc"],
  }),
);

// Encode for the wire
const bytes = encodeFrame(handshake);

// Decode on the other side
const frame = decodeFrame(bytes);
if (frame.kind === FrameKind.Control) {
  console.log("control frame received");
}

// Send an application message
const msg = createMessageFrame(
  asSubject("rpc/echo"),
  new TextEncoder().encode("hello"),
);
const msgBytes = encodeFrame(msg);
```

## What it provides

- **Branded types**: `PeerId`, `FrameId`, `Subject`, `ConnectionId`, `CorrelationId`, `StreamId` with smart constructors (`asPeerId`, `asFrameId`, `asSubject`, etc.) for wire-safe validation
- **Frame codec**: `encodeFrame` / `decodeFrame` with invariant enforcement (validates subject compliance with reserved namespaces per ADR-008)
- **Frame builders**: `createHandshakeFrame`, `createMessageFrame`, `createPingFrame`, `createPongFrame`, `createCloseFrame`
- **FrameId helpers**: `generateFrameId`, `frameIdToHex`, `frameIdFromHex` for correlation and logging
- **Handshake encode/decode**: `encodeHandshake` / `decodeHandshake` with validation
- **Protocol constants**: `PROTOCOL_NAME`, `PROTOCOL_ID`, `PROTOCOL_VERSION`, `FrameKind` enum, `ControlOp` enum, `ErrorCode` enum
- **Type guards**: `isControlFrame`, `isMessageFrame`, `isAckFrame`, `isErrorFrame`, `isValidFrameId`, etc.

For transport implementations, see [`@sideband/transport`](https://www.npmjs.com/package/@sideband/transport) (defines the Transport interface). For request correlation and RPC semantics, see [`@sideband/rpc`](https://www.npmjs.com/package/@sideband/rpc). Keep state machines, retries, and routing in [`@sideband/runtime`](https://www.npmjs.com/package/@sideband/runtime)—this package only defines the wire contract.

## Specification

See the [SBP protocol specification](https://sideband.tech/protocols/sbp/) for wire format details.

## License

Apache-2.0
