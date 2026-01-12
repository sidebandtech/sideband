// SPDX-License-Identifier: Apache-2.0

/**
 * WebSocket-specific error handling utilities.
 *
 * Maps WebSocket close codes to TransportErrorKind for consistent
 * error classification across browser and Node.js environments.
 */

import {
  type CloseInfo,
  TransportError,
  type TransportErrorKind,
} from "@sideband/transport";

/**
 * Maps WebSocket close codes to TransportErrorKind.
 *
 * Returns null for clean closes (code 1000).
 *
 * Note: Code 1006 always returns "abnormal_close". The spec allows
 * "connection_refused" when no frames were exchanged, but that heuristic
 * requires connection context not available here. Use normalizeError()
 * for context-aware error classification.
 */
export function errorKindFromWsCloseCode(
  code: number,
): TransportErrorKind | null {
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
      return "subprotocol_mismatch"; // Mandatory extension
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

/**
 * Normalize a platform error to TransportError.
 *
 * Handles browser WebSocket errors (opaque), Node.js system errors,
 * and AbortSignal cancellations.
 *
 * @param error - The platform-specific error (Error, Event, etc.)
 * @param closeInfo - Optional WebSocket close info for context
 * @returns A normalized TransportError
 */
export function normalizeError(
  error: unknown,
  closeInfo?: Partial<CloseInfo>,
): TransportError {
  // Already a TransportError
  if (error instanceof TransportError) {
    return error;
  }

  // Browser offline detection (check navigator.onLine when available)
  if (
    typeof navigator !== "undefined" &&
    "onLine" in navigator &&
    !navigator.onLine
  ) {
    return new TransportError(
      "network_offline",
      "Network is offline",
      error instanceof Error ? error : undefined,
    );
  }

  // AbortSignal cancellation
  if (error instanceof Error && error.name === "AbortError") {
    return new TransportError("aborted", "Connection aborted by signal", error);
  }

  // Node.js system errors (ECONNREFUSED, ENOTFOUND, etc.)
  // Use any cast to avoid @types/node dependency in cross-platform package
  if (error instanceof Error && "code" in error) {
    const code = (error as { code?: string }).code;
    const kind = errorKindFromNodeCode(code);
    return new TransportError(kind, error.message, error);
  }

  // WebSocket close code classification
  if (closeInfo?.closeCode !== undefined) {
    const kind = errorKindFromWsCloseCode(closeInfo.closeCode);
    if (kind) {
      const message =
        closeInfo.reason || `WebSocket closed with code ${closeInfo.closeCode}`;
      return new TransportError(kind, message, error);
    }
  }

  // Generic Error
  if (error instanceof Error) {
    return new TransportError("transport_failure", error.message, error);
  }

  // Unknown error type
  return new TransportError(
    "transport_failure",
    String(error) || "Unknown transport error",
    error,
  );
}

/**
 * Maps Node.js system error codes to TransportErrorKind.
 */
function errorKindFromNodeCode(code: string | undefined): TransportErrorKind {
  switch (code) {
    case "ECONNREFUSED":
    case "EHOSTUNREACH":
      return "connection_refused";
    case "ENOTFOUND":
      return "dns_failure";
    case "ETIMEDOUT":
      return "timeout";
    case "ECONNRESET":
    case "EPIPE":
      return "abnormal_close";
    case "ENETUNREACH":
      return "network_offline";
    case "ABORT_ERR":
      return "aborted";
    default:
      // TLS/SSL errors
      if (
        code?.startsWith("CERT_") ||
        code?.startsWith("ERR_TLS_") ||
        code?.startsWith("ERR_SSL_")
      ) {
        return "tls_failure";
      }
      return "transport_failure";
  }
}
