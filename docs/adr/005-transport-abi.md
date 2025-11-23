# ADR 005: Transport ABI Package

- **Date**: 2025-11-23
- **Status**: Accepted
- **Tags**: architecture, transport

## Context

The project architecture requires a `@sideband/transport` package as the ABI layer between protocol and concrete implementations. The initial architecture inadvertently mixed transport concerns into `@sideband/protocol` via a low-level callback-based `RawTransport` interface.

## Decision

Created `@sideband/transport` as a dedicated, transport-agnostic ABI layer:

**Core interfaces:**

- `Transport`: Entry point for `connect()` (client) and optional `listen()` (server)
- `TransportConnection`: Bidirectional channel with `send()`, `close()`, and `inbound: AsyncIterable<Uint8Array>`
- `TransportEndpoint`: Branded string for connection targets (format is transport-specific)

**Dependency rule:**

- `@sideband/transport` depends only on `@sideband/protocol` (imports `ConnectionId`)
- All concrete transports (`transport-browser`, `transport-node`) depend on `@sideband/transport`
- `@sideband/runtime` depends on `@sideband/transport`, not on concrete implementations

**Key constraint:** No I/O, codec, or environment-specific logic. Transport is purely an interface contract.

## Rationale

- **Layered isolation**: Concrete transports depend on the ABI, not vice versa; enables swappable implementations
- **Testability**: MemoryTransport reference implementation serves as both documentation and test harness
- **Async iterables**: Inbound stream via `AsyncIterable<Uint8Array>` enables backpressure, composition, and natural error handling
- **Stateless types**: `TransportEndpoint` and `ConnectionId` are transport-agnostic, avoiding implicit coupling
