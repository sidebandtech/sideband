# @sideband/runtime

Transport-agnostic runtime primitives: peer wiring, frame routing, and RPC correlation utilities. Ships zero transport/UI code—pair it with `@sideband/transport-*` and [`@sideband/rpc`](https://www.npmjs.com/package/@sideband/rpc).

## Install

```bash
bun add @sideband/runtime
```

## Quick use

```ts
import { RpcCorrelationManager } from "@sideband/runtime";
import { createRpcRequest, decodeRpcEnvelope, encodeRpcEnvelope } from "@sideband/rpc";
import { generateFrameId } from "@sideband/protocol";

// Track pending RPCs with timeouts
const correlator = new RpcCorrelationManager(10_000);

// Outbound request
const cid = generateFrameId();
const request = createRpcRequest("user.get", cid, { id: 42 });
const wireBytes = encodeRpcEnvelope(request);
const pending = correlator.registerRequest(cid);

// ...send wireBytes inside a MessageFrame over your transport...

// Inbound response
const responseBytes = /* MessageFrame.data from remote peer */;
const envelope = decodeRpcEnvelope(responseBytes);
correlator.matchResponse(envelope.cid, envelope);

const response = await pending; // resolved or rejected on timeout/clear()
```

## What it provides

- RpcCorrelationManager: promise-based request/response tracking with timeouts and cleanup
- Runtime scaffolding without transport coupling; safe to embed in browser, Node, or service hosts
- Helpers to clear/reject all pending work when transports disconnect or peers drop

## License

Code: AGPL-3.0-or-later. Commercial licensing available via hello@sideband.tech.
