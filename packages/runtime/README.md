# @sideband/runtime

Transport-agnostic Sideband runtime pieces: session lifecycle, message routing, and RPC correlation. Most apps should use `@sideband/peer`; reach for `@sideband/runtime` when you need custom transports or want direct control over session and routing behavior.

## Features

- **SessionManager**: Connect -> negotiate -> active with retry/backoff and lifecycle events
- **Router**: Subject validation, handler registry, RPC dispatch, and error mapping
- **RpcCorrelationManager**: Pending RPC tracking with timeouts and explicit `cid` correlation
- **SbpNegotiator**: Built-in SBP handshake negotiator for direct connections

## Install

```bash
bun add @sideband/runtime
```

## Quick start: session + router

```ts
import {
  createRouter,
  createSessionManager,
  SbpNegotiator,
  type Session,
} from "@sideband/runtime";
import { asPeerId, isMessageFrame } from "@sideband/protocol";
import {
  LoopbackTransport,
  unsafeAsTransportEndpoint,
} from "@sideband/transport";

const router = createRouter();

router.route("rpc", async (msg) => {
  // Dispatch by method name from envelope (msg.rpc.method)
  if (msg.rpc?.method === "user.get") {
    const userId = (msg.rpc.params as { id: number }).id;
    await msg.rpc.reply({ id: userId, name: "Ada" });
  }
});

let activeSession: Session | undefined;

// LoopbackTransport is for tests; use wsTransport() + wsEndpoint() in production.
// unsafeAsTransportEndpoint brands a raw string without URL validation.
const transport = new LoopbackTransport();
const endpoint = unsafeAsTransportEndpoint("loopback://test");

const manager = createSessionManager({
  endpoint,
  transportFactory: (endpoint) => transport.connect(endpoint),
  negotiator: new SbpNegotiator({ peerId: asPeerId("browser-ui") }),
  onFrame: async (frame) => {
    if (!activeSession || !isMessageFrame(frame)) return;
    const sessionLike = {
      peerId: activeSession.peerId,
      send: (data: Uint8Array) => activeSession.sendRaw(data),
    };
    const errorBytes = await router.dispatch(frame, sessionLike);
    if (errorBytes) {
      await activeSession.sendRaw(errorBytes);
    }
  },
});

activeSession = await manager.connect();
```

Notes:

- `Router.dispatch()` expects `MessageFrame` and returns encoded ErrorFrame bytes when subject validation or RPC envelope decoding fails. Send those bytes back on the session channel.
- `SessionManager` only decodes frames; higher layers own validation and routing.

## Quick start: RPC correlation

```ts
import { RpcCorrelationManager } from "@sideband/runtime";
import { createRpcRequest, decodeRpcEnvelope, encodeRpcEnvelope } from "@sideband/rpc";
import { generateFrameId } from "@sideband/protocol";

const correlator = new RpcCorrelationManager(10_000);

const cid = generateFrameId();
const request = createRpcRequest("user.get", cid, { id: 42 });
const requestPayload = encodeRpcEnvelope(request);

const pending = correlator.registerRequest(cid);
// send requestPayload inside a MessageFrame over your transport...

const responsePayload = /* MessageFrame.data from remote peer */;
const envelope = decodeRpcEnvelope(responsePayload);
correlator.matchResponse(envelope.cid, envelope);

const response = await pending;
```

## Core concepts

**SessionManager**

- `connect()` establishes a session with a negotiator and emits lifecycle events.
- `on(event, handler)` subscribes to `connecting`, `negotiating`, `active`, `retrying`, `closed`, and identity events.
- Retry is opt-in via `retryPolicy` and uses exponential backoff with jitter.

**Router**

- Validates subjects against a policy and dispatches by deterministic ordering.
- RPC subjects use exclusive dispatch with timeout handling and error mapping.
- Event and custom subjects broadcast to all matching handlers.

**Subject policy defaults**

- Allowed channels: `rpc`, `event` (exact-match)
- Reserved channels: `stream` (rejected with `ErrorCode.UnsupportedFeature`)
- Allowed prefixes: `app/` (for custom sub-paths)
- Use `createRouter(config, subjectPolicy)` to override.

**Negotiators**

- `SbpNegotiator` implements the SBP handshake (direct peer-to-peer).
- SBRP is not built in. Integrate `@sideband/secure-relay` by implementing a custom `Negotiator` that returns a wrapped `SessionChannel`.

## References

- [Session lifecycle (ADR-009)](https://sideband.tech/adr/009-runtime-peer-lifecycle)
- [RPC correlation (ADR-010)](https://sideband.tech/adr/010-rpc-correlation-cid)
- [Routing semantics (ADR-011)](https://sideband.tech/adr/011-runtime-message-routing)
- [Subject validation (ADR-008)](https://sideband.tech/adr/008-subject-namespace-validation)

## License

Apache-2.0
