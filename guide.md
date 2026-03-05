---
url: /guide.md
---
# Getting Started

Sideband is a secure communication stack for TypeScript applications.

## Zero-Infrastructure Start

The fastest way to get a browser talking to a local daemon — no infrastructure required:

```bash
npx sideband
```

This starts a relay-connected daemon and prints a Quick Connect URL
(`https://sideband.cloud/connect#qc=...`). Open it in any browser to connect and
call RPC methods over E2EE in under 30 seconds. Requires an API key from
[sideband.cloud](https://sideband.cloud) — run `npx sideband init --api-key sbnd_dak_...`
once to save it.

See the [CLI README](https://github.com/sidebandtech/sideband/tree/main/packages/cli) for
full usage (`--json` mode, built-in RPC methods, QC renewal).

***

## SDK Installation

For integrating Sideband into your own application:

```bash
bun add @sideband/peer
```

## Quick Example

```typescript
import { listen } from "@sideband/peer/server";
import { createPeer } from "@sideband/peer";

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

## Guides

Recommended order for new users:

| Guide                           | Description                                                   |
| ------------------------------- | ------------------------------------------------------------- |
| [Concepts](concepts.md)         | 1) Mental model: peers, sessions, subjects, state machine     |
| [RPC](rpc.md)                   | 2) Request/response patterns, typed clients, errors, timeouts |
| [Events](events.md)             | 3) Fire-and-forget events, NATS pattern subscriptions         |
| [Server](server.md)             | 4) `listen()`, AcceptedPeer, connection management            |
| [E2EE Relay](e2ee.md)           | 5) End-to-end encrypted sessions via SBRP and TOFU            |
| [Testing](testing.md)           | 6) LoopbackTransport and integration testing patterns         |
| [Self-Hosting](self-hosting.md) | Relay architecture and self-hosted deployment                 |

## Packages

| Package                  | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `@sideband/protocol`     | Wire format, frame types, encode/decode                  |
| `@sideband/transport`    | Transport interface and shared utilities                 |
| `@sideband/runtime`      | Peer lifecycle, routing, subscriptions                   |
| `@sideband/rpc`          | Typed RPC layer                                          |
| `@sideband/peer`         | High-level SDK                                           |
| `@sideband/secure-relay` | E2EE relay protocol                                      |
| `@sideband/cloud`        | `relay.sideband.cloud` integration (`connect`, `listen`) |
| `sideband`               | CLI — `npx sideband` zero-infrastructure daemon          |
