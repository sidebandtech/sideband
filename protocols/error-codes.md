---
url: /protocols/error-codes.md
---
# Error Code Registry

> **Authority**: Primary (Normative)
> **Purpose**: Canonical registry for all error codes across protocol layers.

This document is the single source of truth for error codes. Specifications MUST reference this registry; they MUST NOT define codes inline.

## Code Ranges

| Range     | Owner    | Carrier    | Purpose                          |
| --------- | -------- | ---------- | -------------------------------- |
| 1000–1099 | SBP      | ErrorFrame | Frame/handshake/namespace faults |
| 1100–1199 | RPC      | RpcError   | Envelope/method/routing faults   |
| 1200–1999 | Reserved | —          | Future protocol extensions       |
| 2000+     | App      | RpcError   | User-defined application errors  |

Implementations MUST NOT define codes outside their owned range.

## Transport Errors (Local)

Transport errors are **local-only** and are **NOT** wire protocol errors. They describe why a local transport operation failed (connection refused, DNS failure, TLS error, timeout, etc.) and are never sent on the wire or carried in `ErrorFrame` or `RpcError`.

For the full transport error taxonomy, see [transport/errors.md](./transport/errors.md).

**TransportErrorKind values** (reference):

| Kind                    | Retryable | Description                            |
| ----------------------- | --------- | -------------------------------------- |
| `connection_refused`    | Yes       | Server not accepting connections       |
| `dns_failure`           | Yes       | DNS resolution failed                  |
| `tls_failure`           | No        | TLS/SSL handshake or certificate error |
| `timeout`               | Yes       | Connection or operation timed out      |
| `network_offline`       | Yes       | Network unavailable                    |
| `abnormal_close`        | Yes       | Connection dropped unexpectedly        |
| `message_too_large`     | No        | Message exceeds size limit             |
| `policy_violation`      | No        | CSP, CORS, or browser security policy  |
| `authentication_failed` | No        | Relay-level auth (NOT E2EE auth)       |
| `aborted`               | No        | Explicit AbortSignal cancellation      |
| `subprotocol_mismatch`  | No        | Subprotocol negotiation failed         |
| `transport_failure`     | Yes       | Catch-all for unmapped errors          |

> **Scope distinction**:
>
> * **Wire protocol errors** (this document): Sent between peers, carried in `ErrorFrame` or `RpcError`
> * **Transport errors** ([transport/errors.md](./transport/errors.md)): Local-only, describe transport layer failures, surfaced via `TransportError` class

## SBP Codes (1000–1099)

Carried in `ErrorFrame.code`. These are protocol-level errors.

| Code | Name               | Fatality   | Semantics                                        |
| ---- | ------------------ | ---------- | ------------------------------------------------ |
| 1000 | ProtocolViolation  | Fatal      | Generic protocol contract violation              |
| 1001 | UnsupportedVersion | Fatal      | Peer advertised incompatible version             |
| 1002 | InvalidFrame       | Contextual | Frame structure or encoding error                |
| 1003 | UnsupportedFeature | Non-fatal  | Feature reserved or requires capability exchange |

**Fatality rules**:

* **Fatal**: Receiver MUST close transport after emitting diagnostics
* **Non-fatal**: Continue processing subsequent frames
* **Contextual**: MAY be fatal if recovery is unsafe; otherwise continue

See [SBP Error Model](./sbp/errors.md) for sender/receiver contracts.

## RPC Codes (1100–1199)

Carried in `RpcError.code` (envelope `t: "E"`). These are request-scoped errors that MUST NOT trigger transport close.

| Code | Name                | Semantics                                       |
| ---- | ------------------- | ----------------------------------------------- |
| 1100 | InvalidEnvelope     | Envelope structure or encoding error            |
| 1101 | UnsupportedMethod   | Method not recognized by handler                |
| 1102 | CorrelationMismatch | Response cid does not match any pending request |
| 1103 | Timeout             | Request timed out waiting for response          |
| 1104 | EnvelopeMismatch    | Envelope type incompatible with subject prefix  |

**Key invariant**: Routers MUST NOT use SBP `ErrorFrame` to represent handler timeouts. Timeouts MUST be delivered as `RpcError` responses.

## Application Codes (2000+)

User-defined codes for application-specific errors. Carried in `RpcError.code`.

| Code | Name             | Semantics                            |
| ---- | ---------------- | ------------------------------------ |
| 2000 | ApplicationError | Catch-all for unspecified app errors |

Applications MAY define stable subcodes above 2000 for domain-specific errors.

## SBRP Control Codes

SBRP uses a separate namespace (0x01xx–0x10xx) for relay control signaling. These are NOT error codes and are never carried in `ErrorFrame` or `RpcError`. See [SBRP Control Codes](./sbrp/control-codes.md).

## Adding New Codes

New codes require:

1. ADR documenting the need and semantics
2. Update to this registry
3. Update to `@sideband/protocol` or `@sideband/rpc` constants

Reserved ranges (1200–1999) are allocated only by ADR.
