// SPDX-License-Identifier: Apache-2.0

/**
 * Transport error types for Sideband communication.
 *
 * These are local errors describing transport operation failures.
 * NOT transmitted on the wire. See docs/protocols/transport/errors.md.
 */

/**
 * Classification of transport errors.
 */
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

/**
 * Error thrown for transport-level failures.
 */
export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  override readonly cause?: unknown;

  constructor(kind: TransportErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "TransportError";
    this.kind = kind;
    this.cause = cause;
  }
}

/**
 * Returns true if the error kind is retryable (transient failure).
 */
export function isRetryable(kind: TransportErrorKind): boolean {
  switch (kind) {
    case "connection_refused":
    case "dns_failure":
    case "timeout":
    case "network_offline":
    case "abnormal_close":
    case "transport_failure":
      return true;
    case "tls_failure":
    case "message_too_large":
    case "policy_violation":
    case "authentication_failed":
    case "aborted":
    case "subprotocol_mismatch":
      return false;
  }
}
