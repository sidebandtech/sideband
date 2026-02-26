// SPDX-License-Identifier: Apache-2.0

import { SbrpError, SbrpErrorCode } from "@sideband/secure-relay";

/**
 * Classify an error from SBRP negotiation as fatal or retryable.
 *
 * Fatal: crypto/identity failures, auth errors, routing errors, wire format errors.
 * Retryable: transient conditions where reconnecting to a healthy relay may succeed —
 *   includes backpressure (relay terminated slow consumer), internal_error (relay-side
 *   failure, not a client fault), timeouts, and session state transitions.
 *
 * The exhaustive switch ensures every SbrpErrorCode is explicitly classified —
 * adding a new code without a case here is a compile-time error.
 */
export function classifySbrpError(error: Error): "fatal" | "retryable" {
  if (!(error instanceof SbrpError)) return "retryable";
  switch (error.code) {
    // Fatal: crypto/identity — client-side invariant violated, retrying won't help
    case SbrpErrorCode.IdentityKeyChanged:
    case SbrpErrorCode.HandshakeFailed:
    case SbrpErrorCode.DecryptFailed:
    case SbrpErrorCode.SequenceError:
    // Fatal: relay rejected this client — auth, routing, or wire format error
    case SbrpErrorCode.Unauthorized:
    case SbrpErrorCode.Forbidden:
    case SbrpErrorCode.DaemonNotFound:
    case SbrpErrorCode.SessionNotFound:
    case SbrpErrorCode.SessionExpired:
    case SbrpErrorCode.MalformedFrame:
    case SbrpErrorCode.PayloadTooLarge:
    case SbrpErrorCode.InvalidFrameType:
    case SbrpErrorCode.InvalidSessionId:
    case SbrpErrorCode.DisallowedSender:
      return "fatal";

    // Retryable: transient — reconnect to a healthy relay instance may succeed
    case SbrpErrorCode.DaemonOffline:
    case SbrpErrorCode.RateLimited:
    case SbrpErrorCode.Backpressure: // Relay closed slow consumer; transient congestion
    case SbrpErrorCode.InternalError: // Relay-side failure; not a client error
    case SbrpErrorCode.HandshakeTimeout:
    // Session state transitions — non-terminal relay notifications
    case SbrpErrorCode.SessionPaused:
    case SbrpErrorCode.SessionResumed:
    case SbrpErrorCode.SessionEnded:
    case SbrpErrorCode.SessionPending:
      return "retryable";

    default: {
      // Adding a new SbrpErrorCode without a case above is a compile-time error.
      const _: never = error.code;
      return "retryable";
    }
  }
}
