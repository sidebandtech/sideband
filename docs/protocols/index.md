# Protocols

Sideband is a layered communication stack for browser-to-daemon communication, designed to work reliably behind NAT with end-to-end encryption.

> These specifications are implementation-neutral. You may implement them in any language or runtime, including proprietary systems, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) terms.

## Architecture

| Layer          | Component | Purpose                                |
| -------------- | --------- | -------------------------------------- |
| App Framing    | SBP       | Framing, multiplexing, message routing |
| Relay Session  | SBRP      | Encrypted sessions over relay          |
| Direct Session | SBDP      | P2P session (future)                   |
| Semantic       | RPC       | Typed request/response patterns        |

::: info
RPC is a semantic layer built on top of SBP message frames, not a transport or session protocol.
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
