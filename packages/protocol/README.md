# @sideband/protocol

Canonical Sideband wire contract: branded IDs, protocol constants/error codes, frame + handshake shapes, binary codec, and the raw transport interface. No I/O or runtime logic.

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
  encodeFrame,
  decodeFrame,
  encodeHandshake,
  asSubject,
} from "@sideband/protocol";

// Build a handshake frame
const handshake = createHandshakeFrame(
  encodeHandshake({
    protocol: "sideband",
    version: "1",
    peerId: "peer-123" as any, // typically from runtime
    caps: ["rpc"],
  }),
);

// Encode for the wire
const bytes = encodeFrame(handshake);

// Decode on the other side
const frame = decodeFrame(bytes);
if (frame.kind === FrameKind.Control && frame.op === 0 /* Handshake */) {
  console.log("handshake ok");
}

// Send an application payload
const msg = createMessageFrame({
  subject: asSubject("rpc/echo"),
  data: new TextEncoder().encode("hello"),
});
const msgBytes = encodeFrame(msg);
```

## What it provides

- Wire-safe types: branded IDs, subject validation, typed frames
- Protocol constants/enums and standardized error codes
- Handshake payload helpers (encode/decode + validation)
- Binary frame codec with invariants enforced on encode/decode
- `RawTransport` interface for browser/node transport implementations

Keep business logic, retries, and state machines in `@sideband/runtime` or transports—this package only defines the contract.

## License

Code: AGPL-3.0-or-later. Commercial licensing available via hello@sideband.tech.
