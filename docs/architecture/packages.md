# Package Architecture

Package boundaries and dependency direction for the current Sideband workspace.

## Design Principles

1. Core remains topology- and transport-agnostic.
2. Session cryptography is isolated from runtime/transport.
3. Public package APIs prioritize correctness and typing over feature breadth.
4. Higher-level packages compose lower-level ones; lower layers never depend upward.

## Terminology

| Term                  | Context                  | Meaning                                                            |
| --------------------- | ------------------------ | ------------------------------------------------------------------ |
| Cryptographic session | `@sideband/secure-relay` | Handshake state, traffic keys, sequence/replay state               |
| Runtime connection    | `@sideband/runtime`      | Logical link over an attached transport                            |
| Peer session          | `@sideband/peer`         | SDK-level lifecycle abstraction over runtime + optional negotiator |

## Layered View

| Layer                      | Package(s)                                      | Responsibility                                             |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| Layer 0: Wire Contract     | `@sideband/protocol`                            | Canonical frame/types/constants + codecs                   |
| Layer 1: I/O               | `@sideband/transport`, `@sideband/transport-ws` | Transport ABI + WebSocket transport                        |
| Layer 2: Message Semantics | `@sideband/rpc`                                 | Typed RPC envelope/codec model                             |
| Layer 3: Coordination      | `@sideband/runtime`                             | Peer lifecycle, routing, transport attachment              |
| Layer 4: Session Crypto    | `@sideband/secure-relay`                        | SBRP handshake/encryption/replay protection                |
| Layer 5: SDK               | `@sideband/peer`                                | User-facing composition of runtime, transport, negotiators |
| Tooling                    | `sideband`, `@sideband/testing`                 | Developer CLI and test helpers                             |

`@sideband/runtime` and `@sideband/secure-relay` are sibling layers: neither depends on the other.

## Package Reference

### `@sideband/protocol`

- Provides: canonical protocol types/constants, frame codecs, type guards.
- Does not provide: I/O, transport implementations, cryptography, runtime/session logic.
- Runtime dependencies: none.

### `@sideband/transport`

- Provides: transport interfaces and shared transport utilities.
- Does not provide: concrete network transport stacks, runtime/session logic.
- Runtime dependencies: `@sideband/protocol`.

### `@sideband/transport-ws`

- Provides: browser + Node/Bun WebSocket transport implementation.
- Does not provide: runtime orchestration or cryptographic session behavior.
- Runtime dependencies: `@sideband/protocol`, `@sideband/transport`, `ws`.

### `@sideband/rpc`

- Provides: typed RPC envelope model and JSON codec helpers.
- Does not provide: transport delivery or encryption.
- Runtime dependencies: `@sideband/protocol`.

### `@sideband/runtime`

- Provides: transport attachment, peer lifecycle, message routing, middleware hooks.
- Does not provide: concrete transport implementations or cryptographic session primitives.
- Runtime dependencies: `@sideband/protocol`, `@sideband/transport`, `@sideband/rpc`.

### `@sideband/secure-relay`

- Provides: SBRP handshake, key derivation, frame codecs, encryption/decryption, replay protection.
- Does not provide: WebSocket/network I/O, token issuance/validation, relay server behavior.
- Runtime dependencies: `@noble/ciphers`, `@noble/curves`, `@noble/hashes`.

### `@sideband/peer`

- Provides: high-level SDK that composes runtime + transport + optional relay negotiators.
- Does not provide: base wire contract definitions or low-level crypto primitives.
- Runtime dependencies: `@sideband/protocol`, `@sideband/rpc`, `@sideband/runtime`, `@sideband/transport`, `@sideband/transport-ws`.
- Optional peer dependency: `@sideband/secure-relay` (for SBRP negotiators).

### `@sideband/cloud`

- Provides: relay.sideband.cloud integration — `connect()` (client) and `listen()` (daemon). `listen()` returns `CloudServer` (extends `PeerServer`) with `daemonId`, `relayUrl`, and `createQuickConnect()`. Also exports `renewPresenceToken` and `extractDaemonIdFromToken`.
- Does not provide: protocol definitions or cryptographic primitives.
- Runtime dependencies: `@sideband/peer`, `@sideband/secure-relay`, `@sideband/transport-ws`.

### `sideband`

- Provides: daemon CLI (`npx sideband`) — connects to relay.sideband.cloud and prints a Quick Connect URL for zero-infrastructure remote access. Wraps `@sideband/cloud`'s `listen()`.
- Runtime dependencies: `@sideband/cloud`, `@sideband/secure-relay`.

### `@sideband/testing`

- Provides: shared test fixtures/fakes/helpers for workspace packages.
- Runtime dependencies: package-local only; intended for test-only usage.

## Current Workspace Packages

| Package                  | Role                             |
| ------------------------ | -------------------------------- |
| `@sideband/protocol`     | Wire contract                    |
| `@sideband/transport`    | Transport ABI                    |
| `@sideband/transport-ws` | WebSocket transport              |
| `@sideband/rpc`          | RPC envelope layer               |
| `@sideband/runtime`      | Runtime coordination engine      |
| `@sideband/secure-relay` | SBRP cryptographic session layer |
| `@sideband/peer`         | User-facing SDK                  |
| `@sideband/cloud`        | relay.sideband.cloud integration |
| `sideband`               | Daemon CLI (Quick Connect)       |
| `@sideband/testing`      | Test helpers                     |

## Dependency Direction

```text
@sideband/protocol
├─> @sideband/transport ──> @sideband/transport-ws
├─> @sideband/rpc
├─> @sideband/runtime
└─> @sideband/peer

@sideband/transport ──> @sideband/runtime
@sideband/transport ──> @sideband/peer
@sideband/rpc ──> @sideband/runtime
@sideband/rpc ──> @sideband/peer
@sideband/runtime ──> @sideband/peer

@sideband/secure-relay (optional peer dependency of @sideband/peer)

@sideband/peer ──> @sideband/cloud
@sideband/secure-relay ──> @sideband/cloud
@sideband/transport-ws ──> @sideband/cloud

@sideband/cloud ──> sideband (cli)
@sideband/secure-relay ──> sideband (cli)
```

## Relay Composition (SBRP + SBP)

In relay mode, SBRP transports encrypted SBP payloads. Integration ownership is split:

1. `@sideband/transport-ws`: WebSocket transport.
2. `@sideband/secure-relay`: handshake + payload crypto.
3. `@sideband/protocol`: inner application frames.
4. `@sideband/rpc`: request/response envelopes inside protocol messages.
5. `@sideband/peer`: user-facing orchestration.

## Summary

- `@sideband/protocol` is the canonical wire contract.
- `@sideband/runtime` coordinates transport and message flow.
- `@sideband/secure-relay` is cryptographic/session logic only.
- `@sideband/peer` composes runtime with optional relay negotiators.
