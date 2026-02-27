# @sideband/transport

Transport ABI + shared helpers for Sideband. Defines the contract concrete transports must implement (WebSocket, loopback, custom TCP, etc.). No runtime/RPC coupling.

## Install

```bash
bun add @sideband/transport
```

## Quick use

```ts
import {
  LoopbackTransport,
  unsafeAsTransportEndpoint,
} from "@sideband/transport";

// unsafeAsTransportEndpoint brands a raw string as TransportEndpoint with no
// URL validation — suitable for custom schemes and tests. For WebSocket URLs,
// use wsEndpoint() from @sideband/transport-ws instead.
const transport = new LoopbackTransport();
const endpoint = unsafeAsTransportEndpoint("loopback://test");

// Server side
await transport.listen(endpoint, async (conn) => {
  for await (const bytes of conn.inbound) {
    await conn.send(bytes); // echo back
  }
});

// Client side
const conn = await transport.connect(endpoint);
await conn.send(new TextEncoder().encode("hello"));
for await (const bytes of conn.inbound) {
  console.log(new TextDecoder().decode(bytes)); // "hello"
  break;
}
```

## What it provides

**Interfaces**

- `Transport` — connect (required) + listen (optional) contract all transports implement
- `TransportConnection` — single byte-level link: `inbound`, `send()`, `close()`, `closed`, `state`
- `TransportListener` — returned by `listen()`; holds `address` and `close()`
- `ConnectionHandler` — `(conn: TransportConnection) => void | Promise<void>`

**Types**

- `TransportEndpoint` — branded string; use `unsafeAsTransportEndpoint` or a transport-specific helper
- `ConnectionState` — `"connecting" | "open" | "closing" | "closed"`
- `ConnectOptions` — `timeoutMs`, `signal`, `headers` (Node.js only), extensible
- `CloseOptions` / `CloseInfo` — close codes, reason, graceful flag, optional error
- `ListenOptions` — extensible per-transport listen configuration
- `ConnectionId` — re-exported from `@sideband/protocol`

**Errors**

- `TransportError` — typed transport failure with `kind: TransportErrorKind`
- `TransportErrorKind` — `connection_refused | dns_failure | tls_failure | timeout | network_offline | abnormal_close | message_too_large | buffer_overflow | policy_violation | authentication_failed | aborted | subprotocol_mismatch | transport_failure`
- `isRetryable(kind)` — returns true for transient failures

**Helpers**

- `unsafeAsTransportEndpoint(value)` — brands a raw string as `TransportEndpoint` with no validation
- `asConnectionId(value)` — brands a value as `ConnectionId` (re-exported from `@sideband/protocol`)
- `LoopbackTransport` — in-process transport for tests and local loops

Depends only on [`@sideband/protocol`](https://www.npmjs.com/package/@sideband/protocol); safe in browser, Node, and Bun environments.

## License

Apache-2.0
