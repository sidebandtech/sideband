## Sideband

[![CI](https://github.com/sidebandtech/sideband/actions/workflows/ci.yml/badge.svg)](https://github.com/sidebandtech/sideband/actions)
[![npm](https://img.shields.io/npm/v/@sideband/protocol.svg)](https://www.npmjs.com/package/@sideband/protocol)
[![Downloads](https://img.shields.io/npm/dm/@sideband/protocol.svg)](https://www.npmjs.com/package/@sideband/protocol)

Sideband is a modern peer-to-peer communication stack for Bun and TypeScript: protocol + RPC + client helpers + CLI, with browser/node transports for real-time apps without the boilerplate.

> ⚠️ Early-stage and evolving — seeking partners and sponsors to shape the roadmap.

### What's here

- Core runtime, protocol, and RPC helpers ([`@sideband/runtime`](https://www.npmjs.com/package/@sideband/runtime), [`@sideband/protocol`](https://www.npmjs.com/package/@sideband/protocol), [`@sideband/rpc`](https://www.npmjs.com/package/@sideband/rpc))
- Peer SDK scaffolding ([`@sideband/peer`](https://www.npmjs.com/package/@sideband/peer))
- Browser and Node transports ([`@sideband/transport-browser`](https://www.npmjs.com/package/@sideband/transport-browser), [`@sideband/transport-node`](https://www.npmjs.com/package/@sideband/transport-node))
- Developer CLI ([`@sideband/cli`](https://www.npmjs.com/package/@sideband/cli))
- Test scaffolding ([`@sideband/testing`](https://www.npmjs.com/package/@sideband/testing))

### Develop

- Requirements: Bun ≥ 1.3, Node ≥ 22 (tooling)
- Install deps: `bun install`
- Explore code: [`packages/*`](./packages/)

### Learn the concepts

For protocol terminology, type names, frame kinds, and subject namespace rules, see the **[Naming Matrix](./docs/adr/002-naming-matrix.md)** (ADR-002), which is the canonical reference for all Sideband concepts.

### Get involved

- Open an issue or start a discussion to say hi
- Interested in sponsoring or collaborating? [Reach out](mailto:hello@sideband.tech) and let's plan it together

### License

- **Code**: AGPL-3.0 with commercial licensing [available](mailto:hello@sideband.tech)
- **Docs (including specs/ADRs)**: CC BY 4.0
