---
url: /guide.md
---
# Getting Started

Sideband is a secure communication stack for TypeScript applications.

## Installation

```bash
bun add @sideband/peer
```

## Quick Example

```typescript
import { createPeer } from "@sideband/peer";

const peer = createPeer({
  peerId: "my-peer",
});

// Subscribe to messages
peer.subscribe("chat/*", (msg) => {
  console.log("Received:", msg.data);
});

// Publish a message
peer.publish("chat/general", { text: "Hello!" });
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
