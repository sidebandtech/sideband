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

## API

### `wsTransport(options?)`

Create a WebSocket transport. Auto-detects the platform.

### `wsEndpoint(url)`

Brand and validate a WebSocket URL (`ws://` or `wss://`). Throws on invalid scheme.

### `wsEndpointFromHttp(url)`

Convert an HTTP(S) URL to a `ws://`/`wss://` endpoint.

## Connect options

Key options for `transport.connect(endpoint, options)`:

- **`auth`** — `{ token, mode?: "header" | "query" }`. Browsers must use `"query"` (WebSocket API doesn't allow custom headers).
- **`subprotocols`** — `{ offer?, requireSelection? }`. Set `requireSelection: true` for protocol enforcement.
- **`limits`** — `{ maxMessageSize?, maxSendBufferBytes?, maxInboundBufferBytes? }`. Defaults: 1 MiB / 16 MiB / 16 MiB.
- **`timeoutMs`** / **`signal`** — connect deadline and abort signal.
- **`advanced`** — Node/Bun only: `{ headers?, query?, tls? }`.

## Listen options (server)

Key options for `transport.listen(endpoint, handler, options)`:

- **`originPolicy`** — `"any" | "localhost" | { allow: string[] } | function`. Protects against DNS rebinding; not an auth mechanism.
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
await wsTransport().listen(
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
