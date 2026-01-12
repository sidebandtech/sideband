# WebSocket Transport

> **Authority**: Primary (Normative)
> **Purpose**: WebSocket-specific transport rules and constraints.
> **See also**: [transport/abi.md](./abi.md), [transport/errors.md](./errors.md), [RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455)

WebSocket-specific behaviors for `@sideband/transport-browser` and `@sideband/transport-node`. Complements the transport ABI with WebSocket protocol constraints.

## Binary-Only Frame Rule

WebSocket frames carry binary data exclusively:

- Transports MUST send binary frames only (opcode `0x02`)
- Transports MUST reject inbound text frames (opcode `0x01`)
- On text frame receipt: close with WebSocket code `1003` (Unsupported Data)

**Rationale**: SBP frames are binary; text frames indicate misconfigured proxies or incompatible peers.

## Message Framing

Transport MUST be message-oriented (v1 decision):

- Each `send(Uint8Array)` transmits exactly one WebSocket message
- Each `inbound` iteration yields exactly one complete message
- No length-prefixing required (WebSocket provides message framing)

**Note**: Stream-oriented transports (QUIC, TCP) can be supported via a `FramedTransportAdapter` that adds length-prefix framing without changing the core ABI.

## Message Size Limits

| Transport | Default Max |
| --------- | ----------- |
| Node/Bun  | 1 MiB       |
| Browser   | 1 MiB       |

Configuration via `ConnectOptions.maxMessageSize`:

```typescript
maxMessageSize?: number; // Default: 1048576 (1 MiB)
```

**Enforcement**:

- **Node/Bun**: Configure underlying `maxPayload` option
- **Browser**: Check `MessageEvent.data.byteLength` after receive

**On oversized message**:

1. Close with WebSocket code `1009` (Message Too Big)
2. Surface `TransportError(kind: "message_too_large")`

## Connection Options

WebSocket transports extend the base `ConnectOptions` (defined in `transport/abi.md`) with WebSocket-specific options:

```typescript
import type { ConnectOptions as BaseConnectOptions } from "@sideband/transport";

export interface ConnectOptions extends BaseConnectOptions {
  // Inherited from base: timeoutMs?, signal?

  // WebSocket-specific
  protocols?: string | string[]; // WebSocket subprotocols, default: ["sideband.v1"]
  maxMessageSize?: number; // Default: 1048576 (1 MiB)

  // Node/Bun only (ignored in browser)
  headers?: Record<string, string>;
  tls?: TlsOptions; // Passthrough to Node tls.connect

  // Browser workaround (auth via URL when headers unavailable)
  query?: Record<string, string>;

  // Escape hatch for transport-specific options
  [key: string]: unknown;
}

// Passthrough to Node's tls.connect options
// Requires tsconfig moduleResolution: "node16" | "nodenext" | "bundler"
type TlsOptions = Partial<import("tls").ConnectionOptions>;
```

**Browser header limitation**: Browser WebSocket API does not support custom headers. Use `query` to pass authentication tokens via URL query parameters as a workaround.

## Subprotocol Negotiation

WebSocket subprotocol negotiation rules:

- Default `protocols`: `["sideband.v1"]`
- If server responds without selecting any requested subprotocol: fail with `TransportError(kind: "protocol_mismatch")`
- Implementations MAY expose `readonly protocol?: string` on `TransportConnection` to indicate the negotiated subprotocol

```typescript
export interface TransportConnection {
  // ... existing members
  readonly protocol?: string; // Negotiated WebSocket subprotocol
}
```

## Keepalive Responsibility

Three keepalive mechanisms exist at different layers:

| Layer     | Mechanism          | Scope            | Required? | Access    |
| --------- | ------------------ | ---------------- | --------- | --------- |
| Transport | WebSocket ping     | Connection       | Optional  | Node only |
| SBRP      | SBRP Ping (`0x10`) | Relay connection | Required  | Both      |
| SBP       | `ControlOp.Ping`   | E2EE session     | Optional  | Both      |

**Orthogonality**:

- **WebSocket ping**: Transparent to higher layers; TCP-level keepalive. Browser WebSocket API does not expose ping/pong; Node/Bun implementations MAY configure automatic pings.
- **SBRP ping**: Relay-terminated; handles browser clients (no native ping access). Required for relay mode.
- **SBP ping**: End-to-end encrypted; for application-level liveness detection.

These mechanisms do not conflict; each serves a distinct purpose.

## Close Code Mapping

Standard WebSocket close codes and their semantics:

| Code | RFC 6455 Name        | Scenario                     | Reason (example)              |
| ---- | -------------------- | ---------------------------- | ----------------------------- |
| 1000 | Normal Closure       | Normal shutdown              | `"Session ended"`             |
| 1001 | Going Away           | Page unload, server shutdown | `"Going away"`                |
| 1002 | Protocol Error       | Protocol violation           | `"Invalid frame"`             |
| 1003 | Unsupported Data     | Text frame received          | `"Text frames not supported"` |
| 1009 | Message Too Big      | Message exceeds max size     | `"Frame exceeds max"`         |
| 1011 | Unexpected Condition | Unexpected server condition  | `"Internal error"`            |
| 1012 | Service Restart      | Service restarting           | `"Service restarting"`        |
| 1013 | Try Again Later      | Temporary overload           | `"Try again later"`           |

**Mapping to `TransportError.kind`**:

| Close Code | `TransportErrorKind`                     | Notes                       |
| ---------- | ---------------------------------------- | --------------------------- |
| 1000       | (clean close)                            | `CloseInfo.wasClean = true` |
| 1001       | `abnormal_close`                         | Peer going away             |
| 1002       | `transport_failure`                      | Protocol error              |
| 1003       | `transport_failure`                      | Text frame (we sent binary) |
| 1006       | `abnormal_close` or `connection_refused` | Abnormal closure (see note) |
| 1009       | `message_too_large`                      | Size limit exceeded         |
| 1011       | `transport_failure`                      | Server error                |
| 1012       | `abnormal_close`                         | Service restart             |
| 1013       | `abnormal_close`                         | Try again later             |

**Note on code 1006**: This code indicates abnormal closure (no close frame received). Heuristic:

- If no frames were successfully exchanged: `connection_refused`
- If connection had successful frames: `abnormal_close`

## Abort/Cancellation

`AbortSignal` support via `ConnectOptions.signal`:

```typescript
const controller = new AbortController();
const conn = await transport.connect(url, { signal: controller.signal });
```

**Behavior by phase**:

| Phase           | Abort Effect                                                   |
| --------------- | -------------------------------------------------------------- |
| Before connect  | Reject immediately with `TransportError(kind: "aborted")`      |
| During connect  | Close WebSocket, reject with `TransportError(kind: "aborted")` |
| After connected | No effect; use `close()` instead                               |

**Rationale**: Post-connection abort has no effect to prevent accidental disconnection. Explicit `close()` is required for intentional shutdown.

## Origin Validation (Node/Bun Servers)

Server-side origin validation for DNS rebinding protection:

```typescript
export interface ListenOptions {
  // ... existing members
  allowedOrigins?: string[] | null; // Validate Origin header; null = allow any
}
```

**Normative rules**:

- If `allowedOrigins` is specified (non-null), MUST reject connections with non-matching `Origin` header
- SHOULD log rejected connections for debugging

**Default behavior**:

| Endpoint Type                               | Default `allowedOrigins`    |
| ------------------------------------------- | --------------------------- |
| Localhost (`127.0.0.1`, `::1`, `localhost`) | Restricted list (see below) |
| Non-localhost                               | `null` (no restriction)     |

**Default localhost origins**:

```typescript
[
  "http://localhost",
  "https://localhost",
  "http://127.0.0.1",
  "https://127.0.0.1",
  "http://[::1]",
  "https://[::1]",
];
```

**Disabling origin validation**: Explicitly set `allowedOrigins: null`.

**Security rationale**: DNS rebinding attacks allow malicious websites to connect to localhost services by manipulating DNS responses. Secure-by-default protects daemon use-cases where a local WebSocket server accepts connections from browser clients.

## Implementation Notes

### Browser Transport (`@sideband/transport-browser`)

- Uses native `WebSocket` API
- Cannot set custom headers; use `query` option for auth tokens
- Cannot access WebSocket ping/pong; rely on SBRP ping for keepalive
- Check `navigator.onLine` for `network_offline` error classification
- Message size check must occur after receive (`MessageEvent.data.byteLength`)

### Node/Bun Transport (`@sideband/transport-node`)

- Use `ws` package or Bun native WebSocket
- Configure `maxPayload` for message size limits
- Support `headers` and `tls` options
- MAY configure automatic WebSocket ping interval
- Implement `allowedOrigins` validation on server accept

### Error Normalization

Implementations MUST normalize platform-specific errors to `TransportError`:

**Browser heuristics**:

| Condition                               | `TransportErrorKind` |
| --------------------------------------- | -------------------- |
| `navigator.onLine === false`            | `network_offline`    |
| Close code 1006 + no prior frames       | `connection_refused` |
| Close code 1006 + had successful frames | `abnormal_close`     |
| Close code 1008                         | `policy_violation`   |
| Close code 1009                         | `message_too_large`  |

**Node/Bun error codes**:

| Error Code            | `TransportErrorKind` |
| --------------------- | -------------------- |
| `ECONNREFUSED`        | `connection_refused` |
| `ENOTFOUND`           | `dns_failure`        |
| `ETIMEDOUT`           | `timeout`            |
| `CERT_*`, `ERR_TLS_*` | `tls_failure`        |
