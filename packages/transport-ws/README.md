# @sideband/transport-ws

WebSocket transport for Sideband with browser and Node.js/Bun support.

## Status

**Work in progress.** Currently provides WebSocket error handling utilities. Transport implementations (BrowserWsTransport, NodeWsTransport) are planned.

## Install

```bash
bun add @sideband/transport-ws
```

## Current API

```ts
import {
  errorKindFromWsCloseCode,
  normalizeError,
} from "@sideband/transport-ws";

// Map WebSocket close code to TransportErrorKind
const kind = errorKindFromWsCloseCode(1006); // "abnormal_close"

// Normalize platform errors to TransportError
const error = normalizeError(new Error("connection failed"));
```

### Conditional imports

```ts
// Browser-specific
import { normalizeError } from "@sideband/transport-ws/browser";

// Node.js/Bun-specific
import { normalizeError } from "@sideband/transport-ws/node";
```

## Error mapping

Maps WebSocket close codes (RFC 6455) and Node.js system errors to `TransportErrorKind`:

| Close code | Kind                | Description          |
| ---------- | ------------------- | -------------------- |
| 1000       | (clean close)       | Normal closure       |
| 1006       | `abnormal_close`    | Connection dropped   |
| 1008       | `policy_violation`  | Policy violation     |
| 1009       | `message_too_large` | Message too large    |
| 1015       | `tls_failure`       | TLS handshake failed |

| Node.js code | Kind                 |
| ------------ | -------------------- |
| ECONNREFUSED | `connection_refused` |
| ENOTFOUND    | `dns_failure`        |
| ETIMEDOUT    | `timeout`            |
| ECONNRESET   | `abnormal_close`     |

## Dependencies

- [`@sideband/protocol`](https://www.npmjs.com/package/@sideband/protocol) - Protocol types
- [`@sideband/transport`](https://www.npmjs.com/package/@sideband/transport) - Transport ABI

## License

Apache-2.0
