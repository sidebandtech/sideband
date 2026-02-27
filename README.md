# Sideband

[![CI](https://github.com/sidebandtech/sideband/actions/workflows/ci.yml/badge.svg)](https://github.com/sidebandtech/sideband/actions)
[![npm](https://img.shields.io/npm/v/@sideband/protocol.svg)](https://www.npmjs.com/package/@sideband/protocol)

Browser ↔ daemon communication — local or via cloud relay, without WebSocket code.

Sideband is for apps that run a local process (daemon, agent, service) and need a browser UI to talk to it — reliably, securely, and beyond localhost.

> **Early-stage.** APIs may evolve. If you're building on this, [reach out](mailto:hello@sideband.tech) — feedback shapes the protocol.

## Quick start

### Local (direct WebSocket)

```ts
import { listen } from "@sideband/peer/server";

// Daemon
const server = await listen({
  endpoint: "ws://localhost:8080",
  onConnection(peer) {
    peer.rpc.handle<{ msg: string }, string>("echo", (p) => p.msg);
  },
});
```

```ts
import { createPeer } from "@sideband/peer";

// Browser / client
const peer = createPeer({ endpoint: "ws://localhost:8080" });
await peer.connect();
const api = peer.rpc.client<{ echo: (p: { msg: string }) => string }>();
const result = await api["echo"]({ msg: "hello" }); // "hello"
```

### Cloud relay (beyond localhost)

```ts
import { listen, generateIdentityKeyPair } from "@sideband/cloud";

// Daemon — outbound connection to relay, no open port
const server = await listen({
  daemonId: process.env.SIDEBAND_DAEMON_ID,
  apiKey: process.env.SIDEBAND_API_KEY,
  identityKeyPair: await loadOrCreateIdentityKeyPair(),
  onConnection(peer) {
    peer.rpc.handle("echo", (p: { msg: string }) => p.msg);
  },
});
```

```ts
import { connect, createMemoryIdentityKeyStore } from "@sideband/cloud";

// Browser / client
const peer = connect({
  daemonId: "d_abc123",
  getAccessToken: () => auth.getSessionToken(),
  identityKeyStore: createMemoryIdentityKeyStore(),
});
await peer.whenReady();
const result = await peer.rpc.call("echo", { msg: "hello" }); // "hello"
```

## Packages

Most apps start with `@sideband/peer` (local) or `@sideband/cloud` (relay). Lower-level packages are for custom transports and advanced use cases.

| Package                                                                          | Role                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------- |
| [`@sideband/peer`](https://www.npmjs.com/package/@sideband/peer)                 | High-level SDK                              |
| [`@sideband/cloud`](https://www.npmjs.com/package/@sideband/cloud)               | Cloud relay SDK (relay.sideband.cloud)      |
| [`@sideband/protocol`](https://www.npmjs.com/package/@sideband/protocol)         | Wire format, frame types, codecs            |
| [`@sideband/transport`](https://www.npmjs.com/package/@sideband/transport)       | Transport ABI and shared utilities          |
| [`@sideband/runtime`](https://www.npmjs.com/package/@sideband/runtime)           | Session lifecycle, routing, RPC correlation |
| [`@sideband/rpc`](https://www.npmjs.com/package/@sideband/rpc)                   | Typed RPC layer                             |
| [`@sideband/secure-relay`](https://www.npmjs.com/package/@sideband/secure-relay) | E2EE relay protocol                         |
| [`@sideband/transport-ws`](https://www.npmjs.com/package/@sideband/transport-ws) | WebSocket transport (Browser/Node/Bun)      |
| [`@sideband/cli`](https://www.npmjs.com/package/@sideband/cli)                   | Developer CLI (coming soon)                 |

## Develop

```bash
bun install
bun test
```

Requires Bun ≥ 1.3.

## Docs

- **[Getting Started](https://sideband.tech/guide/)** — build your first browser ↔ daemon connection
- **[Protocols](https://sideband.tech/protocols/)** — SBP wire format, SBRP E2EE, and RPC envelope specs

## License

- **Code**: [Apache-2.0](LICENSE)
- **Docs**: CC BY 4.0
