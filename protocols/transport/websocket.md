---
url: /protocols/transport/websocket.md
---
# WebSocket Transport

> **Authority**: Primary (Normative)
> **Purpose**: WebSocket-specific transport rules and constraints.
> **See also**: [transport/abi.md](./abi.md), [transport/errors.md](./errors.md), [RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455)

WebSocket-specific behaviors for `@sideband/transport-ws`. Complements the transport ABI with WebSocket protocol constraints.

## Binary-Only Frame Rule

WebSocket frames carry binary data exclusively:

* Transports MUST send binary frames only (opcode `0x02`)
* Transports MUST reject inbound text frames (opcode `0x01`)
* On text frame receipt: close with WebSocket code `1003` (Unsupported Data)

**Rationale**: SBP frames are binary; text frames indicate misconfigured proxies or incompatible peers.

## Message Framing

Transport MUST be message-oriented (v1 decision):

* Each `send(Uint8Array)` transmits exactly one WebSocket message
* Each `inbound` iteration yields exactly one complete message
* No length-prefixing required (WebSocket provides message framing)

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

* **Node/Bun**: Configure underlying `maxPayload` option
* **Browser**: Check `MessageEvent.data.byteLength` after receive

**On oversized message**:

1. Close with WebSocket code `1009` (Message Too Big)
2. Surface `TransportError(kind: "message_too_large")`

## Connection Options

WebSocket transports extend the base `ConnectOptions` (defined in `transport/abi.md`) with WebSocket-specific options:

```typescript
import type { ConnectOptions as BaseConnectOptions } from "@sideband/transport";

interface SubprotocolOptions {
  /**
   * Subprotocols to offer during handshake.
   * Default: undefined (no subprotocol requested)
   *
   * For Sideband connections, set explicitly:
   * @example { offer: ["sideband.v1"], requireSelection: true }
   */
  offer?: string[];

  /**
   * Whether to fail if server doesn't select a requested subprotocol.
   * Default: false (transport is generic; Sideband policy is opt-in)
   *
   * Note: This is a CLIENT-SIDE option. Server uses `select` callback.
   */
  requireSelection?: boolean;

  /**
   * Server-side: custom subprotocol selection logic.
   * Called with the client's offered subprotocols.
   * Return the selected subprotocol, or undefined to accept without subprotocol.
   *
   * Default: select first client offer that appears in server's `offer` list.
   *
   * @example
   * // Accept any version, prefer latest
   * select: (offered) => offered.includes("sideband.v2") ? "sideband.v2" : "sideband.v1"
   */
  select?: (clientOffers: string[]) => string | undefined;
}

export interface ConnectOptions extends BaseConnectOptions {
  // Inherited from base: timeoutMs?, signal?

  /**
   * Subprotocol negotiation options.
   */
  subprotocols?: SubprotocolOptions;

  /**
   * Connection limits.
   */
  limits?: {
    /** Max single message size. Default: 1 MiB */
    maxMessageSize?: number;
    /** Max bytes queued for sending. Default: 16 MiB */
    maxSendBufferBytes?: number;
    /** Max bytes buffered for inbound. Default: 16 MiB */
    maxInboundBufferBytes?: number;
  };

  /**
   * Authentication token. Mutually exclusive with advanced.headers.Authorization.
   *
   * - Node/Bun: sent via Authorization header (default)
   * - Browser: sent via query param (browsers cannot set WS headers)
   */
  auth?: {
    token: string;
    /**
     * How to send the token.
     * - "header": Authorization header (Node/Bun only, throws in browser)
     * - "query": URL query parameter
     * Default: "header" in Node/Bun, throws in browser (forces explicit choice)
     */
    mode?: "header" | "query";
    /** Header name when mode="header". Default: "Authorization" */
    headerName?: string;
    /** Query param name when mode="query". Default: "token" */
    queryParam?: string;
  };

  /**
   * Advanced/escape-hatch options. Use intent-based options above when possible.
   * Conflicts with higher-level options cause validation errors.
   */
  advanced?: {
    /** Custom headers (Node/Bun only, ignored in browser) */
    headers?: Record<string, string>;
    /** Query params to append to URL */
    query?: Record<string, string>;
    /** TLS options passthrough (Node only) */
    tls?: TlsOptions;
  };
}

// Passthrough to Node's tls.connect options
// Requires tsconfig moduleResolution: "node16" | "nodenext" | "bundler"
type TlsOptions = Partial<import("tls").ConnectionOptions>;
```

**Browser header limitation**: Browser WebSocket API does not support custom headers. Use `auth: { mode: "query" }` to pass authentication tokens via URL query parameters. In browser, specifying `auth` without `mode: "query"` throws a configuration error.

**Validation rules**:

* If `auth` is set and `advanced.headers.Authorization` is set: throw configuration error
* If `auth.mode === "header"` in browser: throw with message "Browsers cannot set WebSocket headers. Use `auth: { mode: 'query' }` explicitly."

## Subprotocol Negotiation

WebSocket subprotocol negotiation rules:

**Client-side**:

* Default `subprotocols.offer`: `undefined` (no subprotocol requested)
* Default `subprotocols.requireSelection`: `false` (transport is generic)
* If `requireSelection: true` and server doesn't select a requested subprotocol: fail with `TransportError(kind: "subprotocol_mismatch")`

**Server-side**:

* If `subprotocols.select` callback provided: use it for custom selection logic
* Otherwise, if `subprotocols.offer` provided: select first client offer that appears in server's offer list
* If no match and no custom logic: accept without subprotocol (RFC 6455 allows this)

**Sideband-recommended configuration** (explicit opt-in to protocol enforcement):

```typescript
const conn = await transport.connect(endpoint, {
  subprotocols: {
    offer: ["sideband.v1"],
    requireSelection: true, // Fail if server doesn't support Sideband
  },
});
```

Implementations MUST expose `readonly subprotocol?: string` on `TransportConnection` to indicate the negotiated subprotocol (undefined if none selected).

```typescript
export interface TransportConnection {
  // ... existing members
  readonly subprotocol?: string; // Negotiated WebSocket subprotocol
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

* **WebSocket ping**: Transparent to higher layers; TCP-level keepalive. Browser WebSocket API does not expose ping/pong; Node/Bun implementations MAY configure automatic pings.
* **SBRP ping**: Relay-terminated; handles browser clients (no native ping access). Required for relay mode.
* **SBP ping**: End-to-end encrypted; for application-level liveness detection.

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

| Close Code | `TransportErrorKind`                     | Notes                                 |
| ---------- | ---------------------------------------- | ------------------------------------- |
| 1000       | (clean close)                            | `CloseInfo.graceful = true`           |
| 1001       | `abnormal_close`                         | Peer going away                       |
| 1002       | `transport_failure`                      | Protocol error                        |
| 1003       | `transport_failure`                      | Text frame (we sent binary)           |
| 1006       | `abnormal_close` or `connection_refused` | Abnormal closure (see note)           |
| 1009       | `message_too_large`                      | Single message exceeds size limit     |
| 1011       | `buffer_overflow`                        | Resource exhaustion (buffer overflow) |
| 1012       | `abnormal_close`                         | Service restart                       |
| 1013       | `abnormal_close`                         | Try again later                       |

**Note on code 1006**: This code indicates abnormal closure (no close frame received). Heuristic:

* If no frames were successfully exchanged: `connection_refused`
* If connection had successful frames: `abnormal_close`

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

  /**
   * Origin validation policy for DNS rebinding protection.
   *
   * Default behavior:
   * - Localhost listeners: "localhost" (allow localhost origins only)
   * - Non-localhost listeners: "any" (allow any origin)
   *
   * IMPORTANT: Connections without Origin header (non-browser clients) are
   * always allowed. Origin is a browser-only header and is not suitable
   * for authentication. Use proper authentication mechanisms.
   */
  originPolicy?:
    | "any" // Allow any origin (including absent)
    | "localhost" // Allow localhost origins (absent OK)
    | { allow: string[] } // Allow specific origins (absent OK)
    | ((origin: string | undefined, request: unknown) => boolean); // Custom

  subprotocols?: SubprotocolOptions;

  limits?: {
    maxMessageSize?: number;
    maxSendBufferBytes?: number;
    maxInboundBufferBytes?: number;
  };
}
```

**Normative rules**:

* Connections without `Origin` header (non-browser clients like CLI tools, other servers) MUST be allowed. Origin is a browser-only header and is not suitable for authentication.
* If `originPolicy` is specified, MUST validate `Origin` header according to policy
* If `originPolicy` callback throws, MUST reject connection with `TransportError(kind: "transport_failure")`
* SHOULD log rejected connections for debugging

**Default behavior**:

| Endpoint Type                               | Default `originPolicy` |
| ------------------------------------------- | ---------------------- |
| Localhost (`127.0.0.1`, `::1`, `localhost`) | `"localhost"`          |
| Non-localhost                               | `"any"`                |

**Policy semantics**:

| Policy value               | Behavior                                             |
| -------------------------- | ---------------------------------------------------- |
| `"any"`                    | Accept any origin, including absent                  |
| `"localhost"`              | Accept localhost origins (see list below), absent OK |
| `{ allow: [...] }`         | Accept listed origins, absent OK                     |
| `(origin, req) => boolean` | Custom validation; return `true` to accept           |

**Localhost origins** (when `originPolicy: "localhost"`):

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

**Security rationale**: DNS rebinding attacks allow malicious websites to connect to localhost services by manipulating DNS responses. The `"localhost"` default for localhost listeners protects daemon use-cases where a local WebSocket server accepts connections from browser clients.

**Important**: Origin validation protects against DNS rebinding, not against malicious clients. Use proper authentication for security.

## Implementation Notes

### Browser Environment

* Uses native `WebSocket` API
* Cannot set custom headers; use `query` option for auth tokens
* Cannot access WebSocket ping/pong; rely on SBRP ping for keepalive
* Check `navigator.onLine` for `network_offline` error classification
* Message size check must occur after receive (`MessageEvent.data.byteLength`)

### Node/Bun Environment

* Use `ws` package or Bun native WebSocket
* Configure `maxPayload` for message size limits
* Support `advanced.headers` and `advanced.tls` options
* MAY configure automatic WebSocket ping interval
* Implement `originPolicy` validation on server accept
* Allow connections without `Origin` header (non-browser clients)

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
