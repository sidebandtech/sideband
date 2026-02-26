# @sideband/peer

High-level SDK for Sideband. Handles connection lifecycle, typed RPC, pub/sub events, and reconnection on top of `@sideband/runtime` and `@sideband/transport-ws`.

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
import { listen } from "@sideband/peer/server";

const server = await listen({
  endpoint: "ws://0.0.0.0:8080",
  onConnection(peer) {
    peer.rpc.handle<{ id: number }, { name: string }>("user.get", (p) => ({
      name: p.id === 1 ? "Ada" : "Unknown",
    }));
  },
});

// server.connections — ReadonlyMap<string, AcceptedPeer>
await server.close();
```

## Reconnection

```ts
const peer = createPeer({
  endpoint: "ws://localhost:8080",
  retryPolicy: {
    mode: "on-error",
    maxAttempts: 5,
    initialDelayMs: 500,
    maxDelayMs: 10_000,
  },
  connectionPolicy: { onDisconnect: "pause" }, // buffer RPCs during reconnect
});

peer.on("reconnecting", () => console.log("lost, retrying…"));
await peer.whenReady(); // resolves when state reaches "active"
```

States: `idle → connecting → negotiating → active ↔ paused` (SBRP relay pause/resume). Reconnection: `active | paused | connecting | negotiating → reconnecting → connecting → …`. Terminal: any state → `closed`.

`connectionPolicy.onDisconnect`:

- `"fail"` (default) — RPC calls reject immediately when peer is not `"active"` (including `"paused"` / disconnected)
- `"pause"` — unsent calls are buffered from any non-ready state (including before first `connect()`) up to `rpcPolicy.disconnectBufferLimitBytes` (default 64 KiB), then flushed on activation

## SBRP relay mode (E2EE)

For end-to-end encrypted relay sessions via `@sideband/secure-relay`:

```ts
import { createPeer } from "@sideband/peer";
import {
  sbrpClientNegotiator,
  createMemoryIdentityKeyStore,
} from "@sideband/peer/sbrp";
import { asDaemonId } from "@sideband/secure-relay";

const store = createMemoryIdentityKeyStore();
const peer = createPeer({
  endpoint: "ws://relay.example.com",
  negotiator: sbrpClientNegotiator({
    daemonId: asDaemonId("target-daemon-id"),
    sessionId: 1n,
    identityKeyStore: store,
    trustPolicy: "auto",
  }),
});

// Relay may pause/resume sessions (e.g. daemon temporarily offline)
peer.on("sessionPaused", () => console.log("relay paused — traffic blocked"));
peer.on("sessionResumed", () => console.log("relay resumed — traffic flowing"));
```

When the relay pauses a session, the peer transitions to `"paused"`: `peer.ready` is `false`, `peer.connected` is `true`. In this state, RPC/event behavior follows `connectionPolicy.onDisconnect` (reject on `"fail"`, buffer on `"pause"`). On resume, the peer returns to `"active"` and flushes buffered calls/events.

Server side uses `sbrpDaemonNegotiator` with an `identityKeyPair`. See `@sideband/secure-relay` for details.

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

Key error codes: `rpc_timeout`, `rpc_cancelled`, `peer_closed`, `session_paused`, `buffer_overflow`, `invalid_pattern`.
Also used: `rpc_error`, `rpc_method_already_registered`, `not_connected`, `invalid_state`, `cancelled`.

## `using` support

```ts
using peer = createPeer({ endpoint: "ws://localhost:8080" });
await peer.connect();
// peer.disconnect() called automatically on scope exit
```

## What's not yet implemented

- **Streaming RPC** — `stream/` channel reserved for v2

For lower-level control, see [`@sideband/runtime`](https://www.npmjs.com/package/@sideband/runtime).

## License

Apache-2.0
