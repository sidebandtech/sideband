# @sideband/transport-ws

WebSocket transport for Sideband with browser and Node.js/Bun support.

## Installation

```bash
bun add @sideband/transport-ws
```

## Quick Start

```typescript
import { wsTransport, wsEndpoint } from "@sideband/transport-ws";

const transport = wsTransport();
const conn = await transport.connect(wsEndpoint("wss://relay.example.com"), {
  auth: { token: "...", mode: "query" },
});

for await (const msg of conn.inbound) {
  // Handle messages
}
```

## Platform Support

| Platform | Client | Server |
| -------- | ------ | ------ |
| Browser  | Yes    | No     |
| Node.js  | Yes    | Yes    |
| Bun      | Yes    | Yes    |

Auto-detection: `wsTransport()` automatically detects the platform. Override with `{ platform: "browser" | "node" | "bun" }`.

## API Reference

### `wsTransport(options?)`

Create a WebSocket transport with automatic platform detection.

```typescript
const transport = wsTransport();
// Or override platform detection
const transport = wsTransport({ platform: "browser" });
```

### `wsEndpoint(url)`

Create a validated WebSocket endpoint.

```typescript
const endpoint = wsEndpoint("wss://example.com");
// Validates ws:/wss: scheme, strips hash fragment
```

### `wsEndpointFromHttp(url)`

Convert HTTP(S) URL to WebSocket URL.

```typescript
const endpoint = wsEndpointFromHttp("https://example.com");
// Returns wss://example.com
```

## Connect Options

```typescript
interface WsConnectOptions {
  // Subprotocol negotiation
  subprotocols?: {
    offer?: string[]; // Protocols to offer
    requireSelection?: boolean; // Fail if server doesn't select (default: false)
    select?: (clientOffers: string[]) => string | undefined; // Server-side custom selection
  };

  // Connection limits
  limits?: {
    maxMessageSize?: number; // Default: 1 MiB
    maxSendBufferBytes?: number; // Default: 16 MiB
    maxInboundBufferBytes?: number; // Default: 16 MiB
  };

  // Authentication
  auth?: {
    token: string;
    mode?: "header" | "query"; // header (Node/Bun), query (browser)
    headerName?: string; // Default: "Authorization"
    queryParam?: string; // Default: "token"
  };

  // Advanced options
  advanced?: {
    headers?: Record<string, string>; // Node/Bun only
    query?: Record<string, string>;
    tls?: WsTlsOptions; // Node only
  };

  // Base options
  timeoutMs?: number;
  signal?: AbortSignal;
}
```

## Listen Options (Server)

```typescript
interface WsListenOptions {
  subprotocols?: SubprotocolOptions;
  limits?: WsLimits;

  // Origin validation for DNS rebinding protection
  originPolicy?:
    | "any" // Allow any origin
    | "localhost" // Allow localhost origins (default for localhost)
    | { allow: string[] } // Allow specific origins
    | ((origin, request) => boolean); // Custom validation
}
```

## Use Cases

### Browser to Cloud Relay

```typescript
const transport = wsTransport();
const conn = await transport.connect(wsEndpoint("wss://relay.example.com"), {
  auth: { token: sessionToken, mode: "query" },
});
```

### CLI to Local Daemon

```typescript
const transport = wsTransport();
const conn = await transport.connect(wsEndpoint("ws://localhost:9000"));
await conn.send(command);
```

### Daemon Server

```typescript
const transport = wsTransport();
const listener = await transport.listen(
  wsEndpoint("ws://localhost:9000"),
  (conn) => {
    console.log("New connection:", conn.id);
    // Handle connection
  },
  { originPolicy: "localhost" },
);
```

### Service to Service (Node/Bun)

```typescript
const transport = wsTransport();
const conn = await transport.connect(wsEndpoint("wss://internal.service"), {
  auth: { token: serviceToken }, // Defaults to header mode
});
```

## Error Handling

Errors are thrown as `TransportError` with a `kind` property:

```typescript
import { TransportError } from "@sideband/transport";

try {
  const conn = await transport.connect(endpoint);
} catch (err) {
  if (err instanceof TransportError) {
    switch (err.kind) {
      case "connection_refused": // Server not listening
      case "timeout": // Connect timeout
      case "subprotocol_mismatch": // Subprotocol negotiation failed
      case "buffer_overflow": // Send/receive buffer exceeded
      case "message_too_large": // Message exceeds size limit
      case "tls_failure": // TLS handshake failed
      case "dns_failure": // DNS lookup failed
      case "abnormal_close": // Connection dropped unexpectedly
      // ...
    }
  }
}
```

## Common Pitfalls

- **Browser + header auth**: Browsers cannot set WebSocket headers. Use `auth: { mode: "query" }` explicitly. The transport will throw if you try to use header auth in a browser without specifying the mode.

- **Subprotocol enforcement**: Transport defaults to `requireSelection: false`. For Sideband protocol connections, explicitly set `{ offer: ["sideband.v1"], requireSelection: true }`.

- **Origin validation**: Origin validation protects against DNS rebinding, not authentication. Non-browser clients (CLI, servers) do not send Origin headers and are allowed by default. Use proper auth mechanisms for security.

- **Send buffer overflow**: If you send faster than the network can handle, `send()` will throw with `buffer_overflow`. Check `conn.pendingSendBytes` for proactive backpressure.

- **Bun server backpressure**: Bun's ServerWebSocket doesn't expose `bufferedAmount`. On Bun servers, only message size is validated, not accumulated buffer. For high-throughput scenarios, implement application-level flow control.

## Dependencies

- [`@sideband/protocol`](https://www.npmjs.com/package/@sideband/protocol) - Protocol types
- [`@sideband/transport`](https://www.npmjs.com/package/@sideband/transport) - Transport ABI

## License

Apache-2.0
