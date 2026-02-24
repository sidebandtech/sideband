# Sideband

[![CI](https://github.com/sidebandtech/sideband/actions/workflows/ci.yml/badge.svg)](https://github.com/sidebandtech/sideband/actions)
[![npm](https://img.shields.io/npm/v/@sideband/protocol.svg)](https://www.npmjs.com/package/@sideband/protocol)

Browser ↔ local daemon communication — without WebSocket code.

Sideband is for apps that run a local process (daemon, agent, service) and need a browser UI to talk to it — reliably, securely, and beyond localhost.

> **Early-stage.** APIs may evolve. If you're building on this, [reach out](mailto:hello@sideband.tech) — feedback shapes the protocol.

## Quick start

```ts
import { createPeer, listen } from "@sideband/peer";

// Daemon
const server = await listen({
  endpoint: "ws://localhost:8080",
  onConnection(peer) {
    peer.rpc.handle("echo", (params) => (params as { msg: string }).msg);
  },
});

// Browser / client
const peer = createPeer({ endpoint: "ws://localhost:8080" });
await peer.connect();
const api = peer.rpc.client<{ echo: (p: { msg: string }) => string }>();
const result = await api["echo"]({ msg: "hello" }); // "hello"
```

## Packages

Most apps start with `@sideband/peer`. Lower-level packages are for custom transports and advanced use cases.

| Package                                                                          | Role                                        | Status  |
| -------------------------------------------------------------------------------- | ------------------------------------------- | ------- |
| [`@sideband/peer`](https://www.npmjs.com/package/@sideband/peer)                 | High-level SDK                              | alpha   |
| [`@sideband/protocol`](https://www.npmjs.com/package/@sideband/protocol)         | Wire format, frame types, codecs            | stable  |
| [`@sideband/transport`](https://www.npmjs.com/package/@sideband/transport)       | Transport ABI and shared utilities          | stable  |
| [`@sideband/runtime`](https://www.npmjs.com/package/@sideband/runtime)           | Session lifecycle, routing, RPC correlation | stable  |
| [`@sideband/rpc`](https://www.npmjs.com/package/@sideband/rpc)                   | Typed RPC layer                             | stable  |
| [`@sideband/secure-relay`](https://www.npmjs.com/package/@sideband/secure-relay) | E2EE relay protocol                         | stable  |
| [`@sideband/transport-ws`](https://www.npmjs.com/package/@sideband/transport-ws) | WebSocket transport (Browser/Node/Bun)      | stable  |
| [`@sideband/cli`](https://www.npmjs.com/package/@sideband/cli)                   | Developer CLI                               | planned |

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
