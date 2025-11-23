# @sideband/rpc

Canonical RPC envelope layer over Sideband message frames: typed request/response/notification shapes, reserved subject helpers, JSON codec, and guards for safe handling.

## Install

```bash
bun add @sideband/rpc
```

## Quick use

```ts
import {
  createRpcRequest,
  createRpcSuccessResponse,
  createRpcErrorResponse,
  createRpcNotification,
  encodeRpcEnvelope,
  decodeRpcEnvelope,
  isRpcResponse,
  SUBJECT_PREFIXES,
  asRpcSubject,
} from "@sideband/rpc";
import {
  generateFrameId,
  createMessageFrame,
  encodeFrame,
  decodeFrame,
  asSubject,
  FrameKind,
} from "@sideband/protocol";

// Build an RPC request envelope
const cid = generateFrameId(); // Correlation ID = frame's frameId
const methodName = "echo";
const request = createRpcRequest(methodName, cid, { text: "hi" });
const envelopeBytes = encodeRpcEnvelope(request);

// Wrap in a MessageFrame with rpc/ subject
const subject = asSubject(`${SUBJECT_PREFIXES.RPC}${methodName}`); // "rpc/echo"
const messageFrame = createMessageFrame({ subject, data: envelopeBytes });
const frameBytes = encodeFrame(messageFrame);

// ...send frameBytes over transport...

// On receive: decode frame, extract envelope, dispatch by subject
const decodedFrame = decodeFrame(frameBytes);
if (decodedFrame.kind === FrameKind.Message) {
  const envelope = decodeRpcEnvelope(decodedFrame.data);
  if (isRpcResponse(envelope)) {
    console.log("result:", envelope.result);
  }
}

// Craft responses/notifications
const responseEnvelope = createRpcSuccessResponse(cid, { text: "hi back" });
const notifyEnvelope = createRpcNotification(
  `${SUBJECT_PREFIXES.EVENT}user.joined`,
  { userId: "123" },
);

// Validate reserved subjects for routing (rpc/, event/, stream/, app/)
const validSubject = asRpcSubject(`${SUBJECT_PREFIXES.RPC}echo`);
```

## What it provides

- Typed RPC envelopes with helpers and discriminated unions for requests, responses, and notifications
- Reserved subject helpers (`rpc/`, `event/`, `stream/`, `app/`) plus validator re-export (`asRpcSubject`)
- JSON encoder/decoder that handles FrameId ↔ hex, emits protocol errors on malformed input
- Integrates with runtime correlation ([`@sideband/runtime`](https://www.npmjs.com/package/@sideband/runtime)) and any transport carrying MessageFrames

## License

Code: AGPL-3.0-or-later. Commercial licensing available via hello@sideband.tech.
