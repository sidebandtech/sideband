# Sideband

[![CI](https://github.com/sidebandtech/sideband/actions/workflows/ci.yml/badge.svg)](https://github.com/sidebandtech/sideband/actions)
[![npm](https://img.shields.io/npm/v/@sideband/protocol.svg)](https://www.npmjs.com/package/@sideband/protocol)

Browser ↔ local daemon communication — without WebSocket code.

Stop debugging reconnects, NAT issues, and flaky user networks.

Sideband is for apps that run a local process (daemon, agent, service) and need a browser UI to talk to it — reliably, securely, and beyond localhost.

> **Early-stage.** APIs may evolve. If you're building on this, [reach out](mailto:hello@sideband.tech) — feedback shapes the protocol.

## Packages

Most apps only need `@sideband/peer`. Lower-level packages are for custom transports and advanced use cases.

| Package                                                                          | Role                                   |
| -------------------------------------------------------------------------------- | -------------------------------------- |
| [`@sideband/peer`](https://www.npmjs.com/package/@sideband/peer)                 | High-level SDK                         |
| [`@sideband/protocol`](https://www.npmjs.com/package/@sideband/protocol)         | Wire format, frame types, codecs       |
| [`@sideband/transport`](https://www.npmjs.com/package/@sideband/transport)       | Transport ABI and shared utilities     |
| [`@sideband/runtime`](https://www.npmjs.com/package/@sideband/runtime)           | Peer lifecycle, routing, subscriptions |
| [`@sideband/rpc`](https://www.npmjs.com/package/@sideband/rpc)                   | Typed RPC layer                        |
| [`@sideband/secure-relay`](https://www.npmjs.com/package/@sideband/secure-relay) | E2EE relay protocol                    |
| [`@sideband/transport-ws`](https://www.npmjs.com/package/@sideband/transport-ws) | WebSocket transport (Browser/Node/Bun) |
| [`@sideband/cli`](https://www.npmjs.com/package/@sideband/cli)                   | Developer CLI                          |

## Develop

```bash
bun install          # Install dependencies
bun test             # Run tests
```

Requires Bun ≥ 1.3.

## Docs

- **[Getting Started](https://sideband.tech/guide/)** — build your first browser ↔ daemon connection
- **[Protocols](https://sideband.tech/protocols/)** — SBP wire format, SBRP E2EE, and RPC envelope specs

## License

- **Code**: Apache-2.0
- **Docs**: CC BY 4.0
