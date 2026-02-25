# Getting Started

Sideband is a secure communication stack for TypeScript applications.

## Installation

```bash
bun add @sideband/peer
```

## Quick Example

```typescript
import { listen, createPeer } from "@sideband/peer";

// Server: register RPC handlers, push events to clients
const server = await listen({
  endpoint: "ws://0.0.0.0:8080",
  onConnection(peer) {
    peer.rpc.handle<{ path: string }, { content: string }>(
      "file.read",
      async ({ path }) => ({ content: await Bun.file(path).text() }),
    );
  },
});

// Client: call RPCs, subscribe to events
const peer = createPeer({ endpoint: "ws://localhost:8080" });
await peer.connect();

const { content } = await peer.rpc.call<{ content: string }>("file.read", {
  path: "./README.md",
});
```

## Packages

| Package                  | Description                              |
| ------------------------ | ---------------------------------------- |
| `@sideband/protocol`     | Wire format, frame types, encode/decode  |
| `@sideband/transport`    | Transport interface and shared utilities |
| `@sideband/runtime`      | Peer lifecycle, routing, subscriptions   |
| `@sideband/rpc`          | Typed RPC layer                          |
| `@sideband/peer`         | High-level SDK                           |
| `@sideband/secure-relay` | E2EE relay protocol                      |
