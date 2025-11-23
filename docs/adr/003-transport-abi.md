# ADR 003: Transport ABI Package

- **Date**: 2025-11-23
- **Status**: Accepted
- **Tags**: architecture, transport, packages

## Context

The project architecture defines a `@sideband/transport` package that serves as the abstract layer between concrete transports (WebSocket, TCP, memory, etc.) and the core runtime. However, this package was missing from the initial implementation.

The `@sideband/protocol` package contained a low-level `RawTransport` interface focused on callback-based byte handling, which mixes concerns and creates coupling between protocol and transport implementation details.

## Decision

Created `@sideband/transport` as a dedicated package that:

1. **Defines the Transport ABI** — the interface that all transport implementations must follow
2. **Remains transport-agnostic** — no I/O or environment-specific code
3. **Depends only on `@sideband/protocol`** — imports `ConnectionId` branded type
4. **Supports both client and server modes** — `connect()` for outbound, `listen()` (optional) for inbound
5. **Uses async iterables for inbound data** — `TransportConnection.inbound: AsyncIterable<Uint8Array>`
6. **Keeps `RawTransport` in protocol** — for backward compatibility; represents low-level callback-based transport

### Key Types

```typescript
export interface Transport {
  readonly kind: string;
  connect(
    endpoint: TransportEndpoint,
    options?: ConnectOptions,
  ): Promise<TransportConnection>;
  listen?(
    endpoint: TransportEndpoint,
    handler: ConnectionHandler,
    options?: ListenOptions,
  ): Promise<TransportListener>;
}

export interface TransportConnection {
  readonly id: ConnectionId;
  readonly endpoint: TransportEndpoint;
  send(bytes: Uint8Array): Promise<void>;
  close(reason?: string): Promise<void>;
  readonly inbound: AsyncIterable<Uint8Array>;
}
```

### Dependency Flow

```
@sideband/protocol (no deps)
         ↓
@sideband/transport (depends on protocol only)
         ↓
@sideband/runtime (depends on protocol + transport)
         ↓
@sideband/transport-{browser,node} (depend on protocol + transport)
         ↓
@sideband/peer (depends on runtime + concrete transports)
```

## Rationale

- **Separation of concerns**: Transport ABI is purely interface, not implementation or protocol details
- **Testability**: Memory transport implementation demonstrates the interface; enables easy mocking
- **No circular dependencies**: Protocol is independent; transport depends on protocol; higher layers depend on both
- **Backward compatibility**: `RawTransport` remains in protocol for any existing code; can coexist with new ABI during migration
- **Async-first design**: Uses async iterables for inbound stream, enabling efficient backpressure and composition

## Implementation Details

- **TransportEndpoint** — branded string type; format is transport-specific (e.g., "ws://...", "tcp://...", "memory://...")
- **ConnectionId** — reused from protocol; unique per connection instance
- **MemoryTransport** — in-memory reference implementation for testing and local communication
- **No encode/decode in transport**: Frame codec remains in protocol; transport handles raw bytes only

## Files Created/Modified

- ✅ `packages/transport/` — new package with ABI and memory implementation
  - `src/types.ts` — Transport interface definitions
  - `src/index.ts` — public API exports
  - `src/memory.ts` — MemoryTransport reference implementation
  - `test/memory.test.ts` — tests for memory transport
  - `README.md` — documentation and usage guide
- ✅ `packages/protocol/package.json` — added `exports` field
- ✅ `packages/transport/package.json` — added `exports` field

## Testing

All tests pass (3 test cases for MemoryTransport):

- ✅ Connect and exchange data
- ✅ Reject connection to non-existent endpoint
- ✅ Reject duplicate listen on same endpoint

TypeScript type checking passes with no errors.

## Next Steps

1. Update `@sideband/runtime` to depend on `@sideband/transport` and use the Transport interface
2. Implement `@sideband/transport-browser` using browser WebSocket + Transport ABI
3. Implement `@sideband/transport-node` using Node.js/Bun WebSocket + Transport ABI
4. Update examples and CLI to use new concrete transport implementations
5. Consider deprecation path for `RawTransport` in a future release
