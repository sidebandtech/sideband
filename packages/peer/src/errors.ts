// SPDX-License-Identifier: Apache-2.0

/**
 * Peer SDK error hierarchy.
 *
 * PeerErrorCode strings are the ONLY public SDK-level error identity. Numeric
 * wire codes (from the SBP/RPC layers) are exposed only in `details.wireCode`.
 * See ADR-013.
 */

// String error codes — canonical SDK identity, not numeric.
export const PeerErrorCode = {
  /** Terminal condition: explicit disconnect, fatal error, or connection failure */
  PeerClosed: "peer_closed",
  /** RPC method already has an active handler (programming error) */
  RpcMethodAlreadyRegistered: "rpc_method_already_registered",
  /** RPC call cancelled by AbortSignal */
  RpcCancelled: "rpc_cancelled",
  /** RPC call timed out */
  RpcTimeout: "rpc_timeout",
  /** Remote RPC handler returned an error */
  RpcError: "rpc_error",
  /** Invalid NATS event name or pattern at call site (programming error) */
  InvalidPattern: "invalid_pattern",
  /** Outbound RPC buffer full (onDisconnect: "pause" only) */
  BufferOverflow: "buffer_overflow",
  /** Peer exists but is not yet connected or is reconnecting */
  NotConnected: "not_connected",
  /** Send blocked because the session is temporarily paused by the relay */
  SessionPaused: "session_paused",
  /** Operation rejected because peer is in the wrong lifecycle state */
  InvalidState: "invalid_state",
  /** Operation cancelled by AbortSignal (non-RPC contexts, e.g. whenReady) */
  Cancelled: "cancelled",
} as const;

export type PeerErrorCode = (typeof PeerErrorCode)[keyof typeof PeerErrorCode];

/** Base error for all peer SDK errors. */
export class PeerError extends Error {
  readonly code: PeerErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: PeerErrorCode,
    message: string,
    options?: ErrorOptions & { details?: Record<string, unknown> },
  ) {
    super(message, options);
    this.name = "PeerError";
    this.code = code;
    this.details = options?.details;
  }
}

/** RPC-layer peer error (timeout, cancellation, handler error). */
export class RpcPeerError extends PeerError {
  constructor(
    code: PeerErrorCode,
    message: string,
    options?: ErrorOptions & { details?: Record<string, unknown> },
  ) {
    super(code, message, options);
    this.name = "RpcPeerError";
  }
}
