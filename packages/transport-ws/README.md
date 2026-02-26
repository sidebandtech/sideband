# @sideband/transport-ws

WebSocket transport for Sideband with browser and Node.js/Bun support.

## Install

```bash
bun add @sideband/transport-ws
```

## Quick start

```ts
import { wsTransport, wsEndpoint } from "@sideband/transport-ws";

const transport = wsTransport();
const conn = await transport.connect(wsEndpoint("wss://relay.example.com"), {
  auth: { token: "...", mode: "query" },
});

for await (const msg of conn.inbound) {
  // handle messages
}
```

## Platform support

| Platform | Client | Server |
| -------- | ------ | ------ |
| Browser  | Yes    | No     |
| Node.js  | Yes    | Yes    |
| Bun      | Yes    | Yes    |

`wsTransport()` auto-detects the platform. Override with `{ platform: "browser" | "node" | "bun" }`.

For explicit, tree-shakeable imports:

- `@sideband/transport-ws/node` — Node.js/Bun (client + server `listen`)
- `@sideband/transport-ws/browser` — browser only (client)

## API

### `wsTransport(options?)`

Create a WebSocket transport. Auto-detects the platform.

### `nodeWsTransport()` (from `@sideband/transport-ws/node`)

Node.js/Bun transport with server-side `listen()` support. Use this for explicit server-side code.

### `browserWsTransport()` (from `@sideband/transport-ws/browser`)

Browser-only transport. No `listen()`.

### `wsEndpoint(url)`

Brand and validate a WebSocket URL (`ws://` or `wss://`). Throws on invalid scheme.

### `wsEndpointFromHttp(url)`

Convert an HTTP(S) URL to a `ws://`/`wss://` endpoint.

## Connect options

Key options for `transport.connect(endpoint, options)`:

- **`auth`** — `{ token, mode?: "header" | "query" }`. Node/Bun default to `"header"`; browsers require `mode: "query"` (cannot set WebSocket headers).
- **`subprotocols`** — `{ offer?, requireSelection? }`. Set `requireSelection: true` for protocol enforcement.
- **`limits`** — `{ maxMessageSize?, maxSendBufferBytes?, maxInboundBufferBytes? }`. Defaults: 1 MiB / 16 MiB / 16 MiB.
- **`timeoutMs`** / **`signal`** — connect deadline and abort signal.
- **`advanced`** — Node/Bun only: `{ headers?, query?, tls? }`.

## Listen options (server)

Key options for `transport.listen(endpoint, handler, options)`:

- **`originPolicy`** — `"any" | "localhost" | { allow: string[] } | function`. Default: `"localhost"` for localhost endpoints, `"any"` otherwise. Absent `Origin` (non-browser clients) is always allowed. Protects against DNS rebinding; not an auth mechanism.
- **`subprotocols`** / **`limits`** — same shape as connect options.

## Use cases

### Browser to relay

```ts
const conn = await wsTransport().connect(
  wsEndpoint("wss://relay.example.com"),
  {
    auth: { token: sessionToken, mode: "query" },
  },
);
```

### CLI to local daemon

```ts
const conn = await wsTransport().connect(wsEndpoint("ws://localhost:9000"));
```

### Daemon server

```ts
import { nodeWsTransport, wsEndpoint } from "@sideband/transport-ws";

await nodeWsTransport().listen(
  wsEndpoint("ws://localhost:9000"),
  (conn) => {
    /* handle connection */
  },
  { originPolicy: "localhost" },
);
```

## Error handling

All errors throw `TransportError` (from `@sideband/transport`) with a `kind` property:

```ts
import { TransportError } from "@sideband/transport";

try {
  const conn = await transport.connect(endpoint);
} catch (err) {
  if (err instanceof TransportError) {
    // err.kind: "connection_refused" | "timeout" | "subprotocol_mismatch" |
    //           "buffer_overflow" | "message_too_large" | "tls_failure" |
    //           "dns_failure" | "abnormal_close" | …
  }
}
```

## Common pitfalls

- **Browser + header auth** — browsers cannot set WebSocket headers; always use `auth: { mode: "query" }` explicitly.
- **Subprotocol enforcement** — default is `requireSelection: false`; set `{ offer: ["sideband.v1"], requireSelection: true }` for Sideband connections.
- **Origin validation** — protects against DNS rebinding, not authentication. Non-browser clients don't send `Origin` headers and are allowed by default.
- **Send buffer overflow** — `send()` throws with `buffer_overflow` if the network can't keep up; check `conn.pendingSendBytes` for proactive backpressure.
- **Bun server backpressure** — Bun's `ServerWebSocket` doesn't expose `bufferedAmount`; only message size is checked. Use application-level flow control for high throughput.

## Dependencies

- [`@sideband/protocol`](https://www.npmjs.com/package/@sideband/protocol)
- [`@sideband/transport`](https://www.npmjs.com/package/@sideband/transport)

## License

Apache-2.0
