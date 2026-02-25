---
url: /adr/005-transport-abi.md
---
# ADR-005: Transport ABI Package

* **Date**: 2025-11-23
* **Status**: Accepted
* **Applies to**: Architecture
* **Tags**: architecture, transport

## Context

The project architecture requires a `@sideband/transport` package as the ABI layer between protocol and concrete implementations. The initial architecture inadvertently mixed transport concerns into `@sideband/protocol` via a low-level callback-based `RawTransport` interface.

## Decision

Created `@sideband/transport` as a dedicated, transport-agnostic ABI layer:

**Core interfaces:**

* `Transport`: Entry point for `connect()` (client) and optional `listen()` (server)
* `TransportConnection`: Bidirectional channel with `send()`, `close()`, and `inbound: AsyncIterable<Uint8Array>`
* `TransportEndpoint`: Branded string for connection targets (format is transport-specific)

**Dependency rule:**

* `@sideband/transport` depends only on `@sideband/protocol` (imports `ConnectionId`)
* All concrete transports (`transport-ws`) depend on `@sideband/transport`
* `@sideband/runtime` depends on `@sideband/transport`, not on concrete implementations

**Key constraint:** No I/O, codec, or environment-specific logic. Transport is purely an interface contract.

## Rationale

* **Layered isolation**: Concrete transports depend on the ABI, not vice versa; enables swappable implementations
* **Testability**: LoopbackTransport reference implementation serves as both documentation and test harness
* **Async iterables**: Inbound stream via `AsyncIterable<Uint8Array>` enables backpressure, composition, and natural error handling
* **Stateless types**: `TransportEndpoint` and `ConnectionId` are transport-agnostic, avoiding implicit coupling

## Specification Documents

Normative behavioral semantics are defined in the transport specification:

* `docs/protocols/transport/abi.md` — Extended connection lifecycle and semantics
* `docs/protocols/transport/errors.md` — Error taxonomy and classification
* `docs/protocols/transport/websocket.md` — WebSocket-specific rules
* `docs/protocols/transport/conformance.md` — Conformance test matrix

## Key Types

The specification documents extend the core interfaces with additional types:

* **ConnectionState** — Finite state machine: `connecting`, `open`, `closing`, `closed`
* **TransportError** — Structured error with `kind: TransportErrorKind` for classification
* **TransportErrorKind** — Error classification (see `transport/errors.md` for full taxonomy)
* **CloseInfo** — Details about connection closure: `graceful`, `closeCode`, `reason`, `error`
* **CloseOptions** — Options for graceful shutdown: `closeCode`, `reason`
* **ConnectOptions** — Connection options: `timeoutMs`, `signal` (transport-specific specs may extend)

## Consequences

* This ADR establishes the interface contract and architectural boundaries
* The specification documents provide normative behavioral semantics that implementations must follow
* Conformance tests validate that concrete transports adhere to both the ABI and behavioral specs
* Updates to connection lifecycle or error handling require spec changes, not ADR amendments
