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
  createHandshakeFrame,
  createMessageFrame,
  createAckFrame,
  encodeFrame,
  decodeFrame,
  encodeHandshake,
  asPeerId,
  asSubject,
  generateFrameId,
} from "@sideband/protocol";

// Build a handshake frame
const handshake = createHandshakeFrame(
  encodeHandshake({
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
const msg = createMessageFrame({
  subject: asSubject("rpc/echo"),
  data: new TextEncoder().encode("hello"),
});
const msgBytes = encodeFrame(msg);

// Acknowledge a frame (references an existing frame's frameId)
const incoming = decodeFrame(bytes);
if (incoming.kind === FrameKind.Message) {
  const ack = createAckFrame(incoming.frameId);
  const ackBytes = encodeFrame(ack);
}
```

## What it provides

- **Branded types**: `PeerId`, `FrameId`, `Subject` with smart constructors (`asPeerId`, `asFrameId`, `asSubject`) for wire-safe validation
- **Frame codec**: `encodeFrame` / `decodeFrame` with invariant enforcement (validates subject compliance with reserved namespaces per ADR-008)
- **Frame builders**: `createHandshakeFrame`, `createMessageFrame`, `createAckFrame`, `createErrorFrame`
- **FrameId helpers**: `generateFrameId`, `frameIdToHex`, `frameIdFromHex` for correlation and logging
- **Handshake encode/decode**: `encodeHandshake` / `decodeHandshake` with validation
- **Protocol constants**: `PROTOCOL_NAME`, `FrameKind` enum, `ControlOp` enum, error code ranges
- **Type guards**: `isControlFrame`, `isMessageFrame`, `isAckFrame`, etc. for discriminated unions

For transport implementations, see [`@sideband/transport`](https://www.npmjs.com/package/@sideband/transport) (defines the Transport interface). For request correlation and RPC semantics, see [`@sideband/rpc`](https://www.npmjs.com/package/@sideband/rpc). Keep state machines, retries, and routing in [`@sideband/runtime`](https://www.npmjs.com/package/@sideband/runtime)—this package only defines the wire contract.

## License

Code: AGPL-3.0-or-later. Commercial licensing available via hello@sideband.tech.
