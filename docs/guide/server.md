# Server

`listen()` starts a server that accepts incoming peer connections. It returns a `PeerServer`
that manages the connection pool. Import from `@sideband/peer/server` — this subpath is
Node/Bun only and intentionally excluded from browser bundles.

---

## Basic Setup

```typescript
import { listen } from "@sideband/peer/server";

const server = await listen({
  endpoint: "ws://0.0.0.0:8080",
  onConnection(peer) {
    // peer is an ConnectedPeer
    peer.rpc.handle("greet", ({ name }) => `Hello, ${name}`);
  },
});

// Shutdown
await server.close();
```

---

## ConnectedPeer vs Peer

`ConnectedPeer` is the server-side counterpart to `Peer`. Key differences:

|                | `Peer` (client)                                                                   | `ConnectedPeer` (server)             |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| `connect()`    | Yes — initiates connection                                                        | No — already connected               |
| `reconnecting` | Yes — managed by Peer                                                             | No                                   |
| Valid states   | `idle \| connecting \| negotiating \| active \| paused \| reconnecting \| closed` | `active \| paused \| closed`         |
| Initial state  | `idle`                                                                            | `active`                             |
| `disconnect()` | Hard close, idempotent                                                            | Hard close, idempotent               |
| `whenReady()`  | Waits for `active`                                                                | Returns immediately (already active) |

`disconnect()` on an `ConnectedPeer` closes that one connection. `server.close()` closes all.

When a client reconnects, the server receives a fresh `ConnectedPeer` in `onConnection` — any
handlers or state attached to the previous instance are not carried over. Design server-side
per-connection setup to be re-initializable in `onConnection`.

---

## Connection Lifecycle

`onConnection` is called for each accepted peer, already in `active` state. Register handlers
before returning — the peer may receive messages immediately.

```typescript
const server = await listen({
  endpoint: "ws://0.0.0.0:8080",
  onConnection(peer) {
    console.log(`Connected: ${peer.peerId}`);

    peer.on("disconnected", () => {
      console.log(`Disconnected: ${peer.peerId}`);
    });

    peer.rpc.handle("echo", (params) => params);
  },
});
```

---

## Server Connection Pool

`server.connections` is a `ReadonlyMap<string, ConnectedPeer>` of all active connections:

```typescript
// Broadcast an event to all connected peers
for (const peer of server.connections.values()) {
  peer.events.emit("server.broadcast", { message: "hello everyone" });
}
```

`PeerId` is the identity from the handshake. For plain SBP connections, it is the `peerId`
declared in the client's `PeerOptions`. When an `ConnectedPeer` transitions to `closed`, it is
automatically removed from `server.connections`.

---

## Bidirectional RPC

The server can call RPC on connected clients — `ConnectedPeer` has the full `rpc` interface
including `rpc.call()`.

```typescript
const server = await listen({
  endpoint: "ws://0.0.0.0:8080",
  async onConnection(peer) {
    // Server calls client
    const info = await peer.rpc.call<{ version: string }>("client.info");
    console.log("Client version:", info.version);

    // Client calls server (registered handler)
    peer.rpc.handle("server.ping", () => ({ ok: true }));
  },
});
```

---

## Shutdown

`server.close()` transitions all `ConnectedPeer` connections to `"closed"` and stops accepting
new connections. It is idempotent.

```typescript
process.on("SIGTERM", () => server.close());
```

Handlers executing at the time of `close()` run to JavaScript completion. Graceful drain
(waiting for all in-flight handlers) is a v2 concern — see `docs/sdk/peer.md` Non-Goals.

---

## E2EE Server (SBRP Daemon)

For E2EE sessions, pass `relayDaemonNegotiator` in `ListenOptions`. See the [E2EE guide](e2ee.md).

---

## See Also

- [Concepts — Peers](concepts.md#peers)
- [E2EE Relay (SBRP)](e2ee.md)
- ADR-013: `/server` export split rationale
- `docs/sdk/peer.md` §6.1, §6.9 — `listen()` RFC
