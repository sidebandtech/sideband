// SPDX-License-Identifier: Apache-2.0

import type { SbrpErrorCode as SbrpErrorCodeType } from "@sideband/secure-relay";
import { SbrpError, SbrpErrorCode } from "@sideband/secure-relay";

/** SBRP error codes that indicate a fatal, non-retryable failure. */
const FATAL_CODES: ReadonlySet<SbrpErrorCodeType> = new Set([
  // Crypto/identity failures
  SbrpErrorCode.IdentityKeyChanged,
  SbrpErrorCode.HandshakeFailed,
  SbrpErrorCode.DecryptFailed,
  SbrpErrorCode.SequenceError,
  // Relay terminal: auth/routing/format errors (retrying won't help)
  SbrpErrorCode.Unauthorized,
  SbrpErrorCode.Forbidden,
  SbrpErrorCode.DaemonNotFound,
  SbrpErrorCode.SessionNotFound,
  SbrpErrorCode.SessionExpired,
  SbrpErrorCode.MalformedFrame,
  SbrpErrorCode.PayloadTooLarge,
  SbrpErrorCode.InvalidFrameType,
  SbrpErrorCode.InvalidSessionId,
  SbrpErrorCode.DisallowedSender,
]);

/**
 * Classify an error from SBRP negotiation as fatal or retryable.
 *
 * Fatal: crypto failures, auth errors, routing errors, wire format errors.
 * Retryable: timeouts, transient relay errors, network errors.
 */
export function classifySbrpError(error: Error): "fatal" | "retryable" {
  return error instanceof SbrpError && FATAL_CODES.has(error.code)
    ? "fatal"
    : "retryable";
}
