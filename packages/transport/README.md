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

- `Transport`/`TransportConnection`/`TransportListener` interfaces for byte-level links
- Endpoint branding helper (`unsafeAsTransportEndpoint`) and shared option/handler types
- Reference `LoopbackTransport` for tests and local loops
- Safe to use in browser or Node transports; depends only on [`@sideband/protocol`](https://www.npmjs.com/package/@sideband/protocol)

## License

Apache-2.0
