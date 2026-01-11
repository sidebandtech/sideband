# Protocols

Sideband is a layered communication stack for browser-to-daemon communication, designed to work reliably behind NAT with end-to-end encryption.

> These specifications are implementation-neutral. You may implement them in any language or runtime, including proprietary systems, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) terms.

## Architecture

**Start here**: [Protocol Architecture](./architecture.md) defines layering, frame wrapping rules, and dependency invariants. All specifications below must be consistent with the architecture document.

```text
┌───────────────────────────────────────────────────┐
│ Application / SDK                                 │
├───────────────────────────────────────────────────┤
│ RPC (semantic envelopes inside MessageFrame.data) │
├───────────────────────────────────────────────────┤
│ SBP (application framing, routing, correlation)   │
├───────────────────────────────────────────────────┤
│ Session: SBRP (relay E2EE) or SBDP (direct P2P)   │
├───────────────────────────────────────────────────┤
│ Transport (WebSocket, WebRTC, etc.)               │
└───────────────────────────────────────────────────┘
```

| Layer          | Protocol | Status | Purpose                                |
| -------------- | -------- | ------ | -------------------------------------- |
| App Framing    | SBP      | v1     | Framing, multiplexing, message routing |
| Relay Session  | SBRP     | Draft  | E2EE sessions via relay server         |
| Direct Session | SBDP     | Design | P2P encryption (future)                |
| Semantic       | RPC      | v1     | Typed request/response patterns        |

::: info
RPC envelopes live inside `MessageFrame.data`. Session layers (SBRP/SBDP) encrypt entire SBP frames; they never inspect RPC content. See [architecture](./architecture.md) for wrapping rules.
:::

## SBP (Sideband Protocol)

Topology-agnostic framing used by all session layers. Defines frame types, message routing, and wire format.

[Read the SBP specification →](./sbp/)

## SBRP (Sideband Relay Protocol)

Default transport: secure, relay-based sessions with E2EE. The relay never sees plaintext.

[Read the SBRP specification →](./sbrp/)

## SBDP (Sideband Direct Protocol)

Future: direct P2P when both peers can establish a connection without relay.

[Read the SBDP specification →](./sbdp/)

## RPC

Typed request/response/notification semantics inside SBP message frames.

[Read the RPC specification →](./rpc/)
