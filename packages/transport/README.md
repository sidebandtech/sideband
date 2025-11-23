# @sideband/transport

Transport ABI + shared helpers for Sideband. Defines the contract concrete transports must implement (browser/node WebSocket, custom TCP, in-memory, etc.). No runtime/RPC coupling.

## Install

```bash
bun add @sideband/transport
```

## Quick use

```ts
import { MemoryTransport, asTransportEndpoint } from "@sideband/transport";

const transport = new MemoryTransport();
const endpoint = asTransportEndpoint("memory://loop");

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
- Endpoint branding helper (`asTransportEndpoint`) and shared option/handler types
- Reference `MemoryTransport` for tests and local loops
- Safe to use in browser or Node transports; depends only on [`@sideband/protocol`](https://www.npmjs.com/package/@sideband/protocol)

## License

Code: AGPL-3.0-or-later. Commercial licensing available via hello@sideband.tech.
