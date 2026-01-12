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
  | "protocol_mismatch" // Subprotocol negotiation failed
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
 * Describes how a connection was closed.
 * Returned by the `closed` promise on `TransportConnection`.
 */
export interface CloseInfo {
  /** True if the connection closed cleanly via close handshake. */
  wasClean: boolean;

  /** WebSocket close code (1000-4999) if applicable. */
  code?: number;

  /** Human-readable close reason. */
  reason?: string;

  /** Optional; present when the close was abnormal or carries error context. */
  error?: TransportError;
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
    case "protocol_mismatch":
      return false;
  }
}

/**
 * Maps a WebSocket close code to a TransportErrorKind.
 * Returns null for clean closes (code 1000).
 *
 * Note: Code 1006 always returns "abnormal_close". The spec allows
 * "connection_refused" when no frames were exchanged, but that heuristic
 * requires connection context not available here. Use normalizeError()
 * for context-aware error classification.
 */
export function kindFromCloseCode(code: number): TransportErrorKind | null {
  switch (code) {
    case 1000:
      return null; // Clean close
    case 1001:
      return "abnormal_close"; // Going away
    case 1002:
      return "transport_failure"; // Protocol error
    case 1003:
      return "transport_failure"; // Unsupported data
    case 1006:
      return "abnormal_close"; // Abnormal closure (connection dropped)
    case 1007:
      return "transport_failure"; // Invalid payload
    case 1008:
      return "policy_violation";
    case 1009:
      return "message_too_large";
    case 1010:
      return "protocol_mismatch"; // Mandatory extension
    case 1011:
      return "transport_failure"; // Internal error
    case 1012:
      return "abnormal_close"; // Service restart
    case 1013:
      return "abnormal_close"; // Try again later
    case 1015:
      return "tls_failure"; // TLS handshake (never actually sent)
    default:
      // 4000-4999: private use codes
      if (code >= 4000 && code <= 4999) {
        return "transport_failure";
      }
      return "transport_failure";
  }
}
