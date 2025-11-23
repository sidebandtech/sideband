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
import { generateFrameId } from "@sideband/protocol";

// Build a request envelope (cid must equal the frame's frameId)
const cid = generateFrameId();
const request = createRpcRequest("echo", cid, { text: "hi" });
const bytes = encodeRpcEnvelope(request);

// ...send bytes as MessageFrame.data...

// Receive + decode
const envelope = decodeRpcEnvelope(bytes);
if (isRpcResponse(envelope)) {
  console.log("result:", envelope);
}

// Craft responses/notifications
const ok = createRpcSuccessResponse(cid, { text: "hi" });
const err = createRpcErrorResponse(cid, 500, "oops");
const note = createRpcNotification(`${SUBJECT_PREFIXES.EVENT}user.joined`, {
  userId: "123",
});

// Validate reserved subjects for routing (rpc/, event/, stream/, app/)
const rpcSubject = asRpcSubject(`${SUBJECT_PREFIXES.RPC}echo`);
```

## What it provides

- Typed RPC envelopes with helpers and discriminated unions for requests, responses, and notifications
- Reserved subject helpers (`rpc/`, `event/`, `stream/`, `app/`) plus validator re-export (`asRpcSubject`)
- JSON encoder/decoder that handles FrameId ↔ hex, emits protocol errors on malformed input
- Integrates with runtime correlation ([`@sideband/runtime`](https://www.npmjs.com/package/@sideband/runtime)) and any transport carrying MessageFrames

## License

Code: AGPL-3.0-or-later. Commercial licensing available via hello@sideband.tech.
