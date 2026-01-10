# @sideband/runtime

RPC correlation utilities for Sideband. Tracks pending requests and matches incoming responses by correlation ID with automatic timeout handling.

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

- **RpcCorrelationManager**: Promise-based request/response tracking with configurable timeouts
  - `registerRequest(cid)` — register a pending request and get a promise
  - `matchResponse(cid, response)` — resolve a pending request with a response
  - `rejectRequest(cid, reason)` — reject a specific pending request
  - `clear()` — reject all pending requests (e.g., on disconnect)
  - `getPendingCount()` — get the number of pending requests

Ships zero transport or I/O code—safe to embed in browser, Node, or service hosts. See ADR-010 for correlation semantics.

## License

Apache-2.0
