# @sideband/peer

High-level SDK for Sideband. Handles connection lifecycle, typed RPC, pub/sub events, and reconnection on top of `@sideband/runtime` and `@sideband/transport-ws`.

> **Alpha.** Core lifecycle, RPC, and events are implemented. SBRP relay mode is not yet available.

## Install

```bash
bun add @sideband/peer
```

## Quick start

### Client (browser or Node/Bun)

```ts
import { createPeer } from "@sideband/peer";

const peer = createPeer({ endpoint: "ws://localhost:8080" });
await peer.connect();

// Typed RPC
const api = peer.rpc.client<{
  "user.get": (p: { id: number }) => { name: string };
}>();
const user = await api["user.get"]({ id: 1 });

// Events
const unsub = peer.events.on("user.updated", (data) => console.log(data));

await peer.disconnect();
```

### Server (Node/Bun)

```ts
import { listen } from "@sideband/peer";

const server = await listen({
  endpoint: "ws://0.0.0.0:8080",
  onConnection(peer) {
    peer.rpc.handle("user.get", (params) => {
      const { id } = params as { id: number };
      return { name: id === 1 ? "Ada" : "Unknown" };
    });
  },
});

// server.connections — ReadonlyMap<string, AcceptedPeer>
await server.close();
```

## Reconnection

```ts
const peer = createPeer({
  endpoint: "ws://localhost:8080",
  retryPolicy: { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 10_000 },
  connectionPolicy: { onDisconnect: "pause" }, // buffer RPCs during reconnect
});

peer.on("reconnecting", () => console.log("lost, retrying…"));
await peer.whenReady(); // resolves when state reaches "active"
```

States: `idle → connecting → negotiating → active ↔ paused`. Reconnection: `active | paused → reconnecting → connecting → …`. Terminal: any state → `closed`.

`connectionPolicy.onDisconnect`:

- `"fail"` (default) — in-flight and queued RPC calls are rejected immediately on disconnect
- `"pause"` — unsent calls are buffered (up to `rpcPolicy.disconnectBufferLimitBytes`, default 64 KiB) and flushed on reconnect

## Events (NATS patterns)

```ts
peer.events.on("chat.message", (data) => {
  /* exact match */
});
peer.events.onPattern("chat.*", (name, data) => {
  /* single-segment wildcard */
});
peer.events.onPattern("metrics.>", (name, data) => {
  /* multi-segment suffix */
});
peer.events.emit("chat.message", { text: "hi" });
```

Subscriptions survive reconnects. Outbound events buffer during disconnection (up to `eventPolicy.maxBufferedEvents`, default 128; oldest evicted on overflow).

## Error handling

```ts
import { PeerError, PeerErrorCode } from "@sideband/peer";

peer.on("error", (err) => {
  if (err instanceof PeerError) {
    // err.code — see PeerErrorCode for all values
  }
});
```

Key error codes: `rpc_timeout`, `rpc_cancelled`, `peer_closed`, `buffer_overflow`, `invalid_pattern`.

## `using` support

```ts
using peer = createPeer({ endpoint: "ws://localhost:8080" });
await peer.connect();
// peer.disconnect() called automatically on scope exit
```

## What's not yet implemented

- **SBRP relay mode** — `sbrpClientNegotiator` / `sbrpDaemonNegotiator` for E2EE relay sessions; requires `@sideband/secure-relay` negotiator integration
- **Streaming RPC** — `stream/` channel reserved for v2

For lower-level control, see [`@sideband/runtime`](https://www.npmjs.com/package/@sideband/runtime).

## License

Apache-2.0
