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
  SUBJECT_CHANNELS,
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

// Wrap in a MessageFrame with `rpc` channel subject
// Method name lives in the envelope, not the subject
const subject = asSubject(SUBJECT_CHANNELS.RPC); // "rpc"
const messageFrame = createMessageFrame(subject, envelopeBytes);
const frameBytes = encodeFrame(messageFrame);

// ...send frameBytes over transport...

// On receive: decode frame, extract envelope, dispatch by envelope.m
const decodedFrame = decodeFrame(frameBytes);
if (decodedFrame.kind === FrameKind.Message) {
  const envelope = decodeRpcEnvelope(decodedFrame.data);
  if (isRpcResponse(envelope)) {
    console.log("result:", envelope.result);
  }
}

// Craft responses/notifications
const responseEnvelope = createRpcSuccessResponse(cid, { text: "hi back" });
// Notifications use `event` channel; event name lives in envelope.e
const notifyEnvelope = createRpcNotification("user.joined", { userId: "123" });

// Validate reserved subjects for routing
const validRpcSubject = asRpcSubject(SUBJECT_CHANNELS.RPC); // "rpc"
const validAppSubject = asRpcSubject("app/custom"); // custom sub-path
```

## What it provides

- Typed RPC envelopes with helpers and discriminated unions for requests, responses, and notifications
- Channel subjects (`rpc`, `event`, `stream`) and `app/` prefix constants, plus validator re-export (`asRpcSubject`)
- JSON encoder/decoder that handles FrameId ↔ hex, emits protocol errors on malformed input
- Integrates with runtime correlation ([`@sideband/runtime`](https://www.npmjs.com/package/@sideband/runtime)) and any transport carrying MessageFrames

## Specification

See the [RPC protocol specification](https://sideband.tech/protocols/rpc/) for envelope format details.

## License

Apache-2.0
