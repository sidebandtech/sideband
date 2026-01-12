# Transport Errors

> **Authority**: Primary (Normative)
> **Purpose**: Error taxonomy and classification for transport operations
> **See also**: [error-codes.md](../error-codes.md) (wire protocol errors), [transport/abi.md](./abi.md)

## Scope

Transport errors are **local** errors that describe why a local transport operation failed. They are NOT transmitted on the wire. Protocol-level errors that travel over the wire are defined in [error-codes.md](../error-codes.md).

| Concern            | Defined where         | Carrier                        |
| ------------------ | --------------------- | ------------------------------ |
| Transport errors   | This document         | `TransportError` class (local) |
| SBP errors         | error-codes.md        | `ErrorFrame` (wire)            |
| RPC errors         | error-codes.md        | `RpcError` (wire)              |
| SBRP control codes | sbrp/control-codes.md | Control frame (wire)           |

## Error Types

### TransportErrorKind

Implementations MUST use this enumeration to classify transport errors.

```typescript
export type TransportErrorKind =
  | "connection_refused" // Server not accepting connections
  | "dns_failure" // DNS resolution failed
  | "tls_failure" // TLS/SSL handshake or certificate error
  | "timeout" // Connection or operation timed out
  | "network_offline" // Network unavailable
  | "abnormal_close" // Connection dropped unexpectedly
  | "message_too_large" // Message exceeds size limit
  | "policy_violation" // CSP, CORS, or browser security policy
  | "authentication_failed" // Relay-level auth (headers/tokens); NOT E2EE auth
  | "aborted" // Explicit AbortSignal cancellation
  | "subprotocol_mismatch" // Subprotocol negotiation failed
  | "transport_failure"; // Catch-all for unmapped errors
```

**Kind semantics**:

| Kind                    | Description                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection_refused`    | The server actively rejected the connection attempt. The target may not be listening or may have rejected the connection.                                 |
| `dns_failure`           | DNS resolution for the hostname failed. The domain may not exist or DNS may be temporarily unavailable.                                                   |
| `tls_failure`           | TLS/SSL handshake failed due to certificate validation error, protocol mismatch, or cryptographic failure.                                                |
| `timeout`               | The operation exceeded its time limit. May indicate network congestion, slow server, or unreachable host.                                                 |
| `network_offline`       | The local network interface is unavailable. Browser: `navigator.onLine === false`.                                                                        |
| `abnormal_close`        | The connection was established but closed unexpectedly without a proper close handshake.                                                                  |
| `message_too_large`     | The message exceeds the configured `maxMessageSize` limit.                                                                                                |
| `policy_violation`      | Browser security policy (CSP, CORS, mixed content) blocked the connection or operation.                                                                   |
| `authentication_failed` | Transport-level authentication failed (e.g., HTTP headers, tokens). This is NOT E2EE authentication; SBRP handshake failures use endpoint codes (0xE0xx). |
| `aborted`               | The operation was explicitly cancelled via `AbortSignal`.                                                                                                 |
| `subprotocol_mismatch`  | WebSocket subprotocol negotiation failed; server did not select a requested protocol.                                                                     |
| `transport_failure`     | Catch-all for errors that do not map to a specific kind.                                                                                                  |

### TransportError

Implementations MUST throw `TransportError` (or a subclass) for all transport-level failures.

```typescript
export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly cause?: unknown;

  constructor(kind: TransportErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "TransportError";
    this.kind = kind;
    this.cause = cause;
  }
}
```

**Normative rules**:

1. `kind` MUST be a valid `TransportErrorKind` value
2. `message` SHOULD be human-readable and suitable for logging
3. `message` MUST NOT contain secrets (tokens, keys, credentials)
4. `cause` SHOULD preserve the original platform error when available
5. Implementations MUST NOT throw plain `Error` for transport failures; use `TransportError`

### CloseInfo

Describes how a connection was closed. Returned by the `closed` promise on `TransportConnection`.

```typescript
export interface CloseInfo {
  /** True if the connection closed cleanly via close handshake. */
  graceful: boolean;

  /** Transport-specific close code (e.g., WebSocket 1000-4999) if applicable. */
  closeCode?: number;

  /** Human-readable close reason. */
  reason?: string;

  /** Optional; present when the close was abnormal or carries error context. */
  error?: TransportError;
}
```

**Normative rules**:

1. `graceful` MUST be `true` only if the close handshake completed successfully
2. `closeCode` SHOULD be present when the transport provides close code semantics (e.g., WebSocket)
3. `error` MUST be present when `graceful` is `false` and the close was triggered by an error
4. `reason` SHOULD be truncated to 123 bytes for WebSocket transports (RFC 6455 limit)

## Error Classification Matrix

Implementations and runtime layers SHOULD use this matrix to determine retry behavior.

| Kind                    | Retryable | Rationale                                                        |
| ----------------------- | --------- | ---------------------------------------------------------------- |
| `connection_refused`    | Yes       | Server may come online                                           |
| `dns_failure`           | Yes       | Cap at 2-3 attempts; DNS may recover                             |
| `tls_failure`           | **No**    | Certificate issues do not self-resolve                           |
| `timeout`               | Yes       | Transient network congestion                                     |
| `network_offline`       | Yes       | Wait for online event before retry                               |
| `abnormal_close`        | Yes       | Transient disconnection                                          |
| `message_too_large`     | **No**    | Configuration mismatch; message must be split or limit increased |
| `policy_violation`      | **No**    | CSP/CORS policies are permanent for the page                     |
| `authentication_failed` | **No**    | Credentials are invalid; requires user action                    |
| `aborted`               | **No**    | User-initiated cancellation                                      |
| `subprotocol_mismatch`  | **No**    | Server does not support required subprotocol                     |
| `transport_failure`     | Yes       | Unknown cause; conservative retry                                |

**Retryability rules**:

1. "Retryable" means the same operation MAY succeed on a subsequent attempt
2. Runtime layers SHOULD implement exponential backoff for retryable errors
3. `dns_failure` retries SHOULD be capped at 2-3 attempts to avoid DNS server load
4. `network_offline` retries SHOULD wait for an online event (browser) or network interface change (Node)
5. Non-retryable errors SHOULD surface immediately to the caller without retry

## Platform Error Mapping

### Helper Functions

WebSocket transports SHOULD provide these helper functions for error normalization. These are **not** part of `@sideband/transport` core; they belong in `@sideband/transport-ws`.

```typescript
// @sideband/transport-ws only (not exported from @sideband/transport)

/**
 * Normalize a platform error to TransportError.
 *
 * @param error - The platform-specific error (Error, Event, etc.)
 * @param closeInfo - Optional WebSocket close info for context
 * @returns A normalized TransportError
 */
export function normalizeError(
  error: unknown,
  closeInfo?: Partial<CloseInfo>,
): TransportError;

/**
 * Infer TransportErrorKind from a WebSocket close code.
 *
 * @param closeCode - WebSocket close code (1000-4999)
 * @returns The corresponding TransportErrorKind
 */
export function errorKindFromWsCloseCode(closeCode: number): TransportErrorKind;
```

### Browser Mapping (Heuristic)

Browser WebSocket errors are opaque by design (security). Implementations MUST use heuristics to classify errors.

| Condition                                  | Kind                   | Rationale                                |
| ------------------------------------------ | ---------------------- | ---------------------------------------- |
| `navigator.onLine === false`               | `network_offline`      | Browser reports no network               |
| Close code 1006 + no prior frames received | `connection_refused`   | Connection failed before data exchange   |
| Close code 1006 + had successful frames    | `abnormal_close`       | Connection dropped after establishment   |
| Close code 1008                            | `policy_violation`     | Policy violation (e.g., origin rejected) |
| Close code 1009                            | `message_too_large`    | Message too big                          |
| Close code 1002                            | `transport_failure`    | Protocol error                           |
| Close code 1003                            | `transport_failure`    | Unsupported data                         |
| `AbortError` or signal aborted             | `aborted`              | AbortSignal triggered                    |
| No subprotocol selected                    | `subprotocol_mismatch` | Subprotocol negotiation failed           |
| Other/unknown                              | `transport_failure`    | Catch-all                                |

**Browser heuristic rules**:

1. Check `navigator.onLine` first; if `false`, classify as `network_offline`
2. For close code 1006, track whether any frames were successfully exchanged
3. Close code 1006 with no prior frames typically indicates connection failure
4. Close code 1006 with prior frames indicates unexpected disconnect
5. When in doubt, use `transport_failure` as the catch-all

> **Implementation note**: Rules 2-4 and subprotocol detection require connection-level context (frame exchange history, handshake state) that may not be available to standalone error normalization functions. Implementations MAY classify all 1006 errors as `abnormal_close` and rely on `transport_failure` as the fallback when connection context is unavailable. The browser WebSocket API does not reliably expose subprotocol negotiation failures; only explicit close code 1010 is detectable.

### Node/Bun Mapping

Node.js and Bun provide detailed error codes. Implementations SHOULD map these codes.

| Error Code     | Kind                 | Description                  |
| -------------- | -------------------- | ---------------------------- |
| `ECONNREFUSED` | `connection_refused` | Connection refused by server |
| `ENOTFOUND`    | `dns_failure`        | DNS lookup failed            |
| `ETIMEDOUT`    | `timeout`            | Connection timed out         |
| `ECONNRESET`   | `abnormal_close`     | Connection reset by peer     |
| `EPIPE`        | `abnormal_close`     | Broken pipe                  |
| `EHOSTUNREACH` | `connection_refused` | Host unreachable             |
| `ENETUNREACH`  | `network_offline`    | Network unreachable          |
| `CERT_*`       | `tls_failure`        | Certificate validation error |
| `ERR_TLS_*`    | `tls_failure`        | TLS protocol error           |
| `ERR_SSL_*`    | `tls_failure`        | SSL/TLS error                |
| `ABORT_ERR`    | `aborted`            | AbortSignal triggered        |
| Other          | `transport_failure`  | Catch-all                    |

**Node mapping rules**:

1. Check `error.code` property for Node.js system error codes
2. Check `error.name` for `AbortError`
3. TLS errors may appear as `CERT_*`, `ERR_TLS_*`, or `ERR_SSL_*` prefixes
4. Preserve the original error in `cause` for debugging

### WebSocket Close Code Mapping

Standard WebSocket close codes and their classification.

| Code      | Name                | Kind                   | Notes                         |
| --------- | ------------------- | ---------------------- | ----------------------------- |
| 1000      | Normal Closure      | (clean close)          | `graceful: true`              |
| 1001      | Going Away          | `abnormal_close`       | Endpoint going away           |
| 1002      | Protocol Error      | `transport_failure`    | Protocol violation            |
| 1003      | Unsupported Data    | `transport_failure`    | Text frame received           |
| 1006      | Abnormal Closure    | (see heuristic)        | No close frame; use heuristic |
| 1007      | Invalid Payload     | `transport_failure`    | Encoding error                |
| 1008      | Policy Violation    | `policy_violation`     | Origin/policy rejected        |
| 1009      | Message Too Big     | `message_too_large`    | Frame exceeds limit           |
| 1010      | Mandatory Extension | `subprotocol_mismatch` | Required extension missing    |
| 1011      | Internal Error      | `transport_failure`    | Server internal error         |
| 1012      | Service Restart     | `abnormal_close`       | Server restarting             |
| 1013      | Try Again Later     | `abnormal_close`       | Temporary overload            |
| 1015      | TLS Handshake       | `tls_failure`          | TLS failure (never sent)      |
| 4000-4999 | Private Use         | `transport_failure`    | Application-defined           |

## Implementation Notes

### Error Construction Examples

```typescript
// Connection refused
throw new TransportError(
  "connection_refused",
  `Connection refused: ${endpoint}`,
  originalError,
);

// Timeout with context
throw new TransportError(
  "timeout",
  `Connect timeout after ${timeoutMs}ms: ${endpoint}`,
  originalError,
);

// Message too large
throw new TransportError(
  "message_too_large",
  `Message size ${size} exceeds limit ${maxMessageSize}`,
  undefined,
);

// Aborted by signal
throw new TransportError(
  "aborted",
  "Connection aborted by signal",
  signal.reason,
);
```

### Logging Guidelines

1. Log `kind` as a structured field for filtering and metrics
2. Log `message` as the human-readable description
3. Log `cause` at debug level for troubleshooting
4. Do NOT log `cause` if it may contain sensitive data (headers, tokens)

## Security Considerations

1. **Credential leakage**: Error messages MUST NOT include tokens, passwords, or API keys
2. **Timing attacks**: Be cautious of error messages that reveal timing information
3. **Stack traces**: Production deployments SHOULD redact stack traces from user-facing errors
4. **Rate limiting**: Applications SHOULD rate-limit logging of repeated transport errors to prevent log flooding
