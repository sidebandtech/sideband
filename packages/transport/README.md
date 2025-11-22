# @sideband/transport

Transport ABI and shared utilities for Sideband communication.

## Overview

This package defines the interface that concrete transport implementations (browser WebSocket, Node.js/Bun WebSocket, memory transport, etc.) must implement.

The `Transport` interface provides two modes:
- **Client mode**: `connect()` to establish outbound connections
- **Server mode**: `listen()` to accept inbound connections (optional)

## Key Types

### `Transport`

The main interface for transport implementations:

```typescript
export interface Transport {
  readonly kind: string;

  connect(
    endpoint: TransportEndpoint,
    options?: ConnectOptions
  ): Promise<TransportConnection>;

  listen?(
    endpoint: TransportEndpoint,
    handler: ConnectionHandler,
    options?: ListenOptions
  ): Promise<TransportListener>;
}
```

### `TransportConnection`

Represents a single link (TCP/WebSocket/etc.) between two peers:

```typescript
export interface TransportConnection {
  readonly id: ConnectionId;
  readonly endpoint: TransportEndpoint;

  send(bytes: Uint8Array): Promise<void>;
  close(reason?: string): Promise<void>;

  readonly inbound: AsyncIterable<Uint8Array>;
}
```

### `TransportEndpoint`

An abstract endpoint representation (format depends on concrete transport):
- Browser: `"ws://hostname:port"` or `"wss://hostname:port"`
- Node/Bun: `"ws://hostname:port"` or `"tcp://hostname:port"`
- Custom: Any string format appropriate for the transport

## Dependencies

- `@sideband/protocol`: For `ConnectionId` and protocol types

## Architecture

Transport implementations **must not** depend on:
- `@sideband/runtime`
- `@sideband/rpc`
- `@sideband/peer`
- `@sideband/cli`
- `@sideband/testing` (for production code)

Transport implementations **may** depend on:
- `@sideband/protocol`
- `@sideband/transport` (this package)

## Design Notes

- **No I/O logic in the ABI**: Transport is purely a definition of how to send/receive bytes.
- **Frame encoding/decoding is separate**: The runtime and higher-level packages handle frame encoding/decoding using `@sideband/protocol` codecs.
- **Byte-level abstraction**: TransportConnection works with raw `Uint8Array`, not decoded frames.
- **Async iterable inbound stream**: Allows efficient buffering and backpressure handling.
- **Connection identity**: Each connection gets a unique `ConnectionId`; reconnects create new connections with new IDs.
