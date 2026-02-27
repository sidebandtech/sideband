// SPDX-License-Identifier: Apache-2.0

import type { PeerId } from "@sideband/protocol";
import type { CloseOptions } from "@sideband/transport";
import type { VerifiedIdentity } from "../types.js";

export type { CloseOptions };

/**
 * Transport connection interface (from @sideband/transport).
 *
 * TransportConnection is message-oriented: each send() call transmits one
 * complete message, and each inbound iteration yields one complete message.
 * Stream-based transports (TCP, QUIC streams) MUST adapt framing before
 * exposing this interface.
 */
export interface TransportConnection {
  readonly id: string;
  readonly endpoint: string;
  send(data: Uint8Array): Promise<void>;
  close(options?: CloseOptions): Promise<void>;
  readonly inbound: AsyncIterable<Uint8Array>;
}

/**
 * Session-layer channel that satisfies TransportConnection interface.
 *
 * Normative: A SessionChannel is a session-layer output, not a raw transport.
 * It MAY wrap an underlying transport with encryption, framing, or other
 * session-specific processing. The runtime treats it as opaque I/O and
 * MUST NOT assume transport-layer semantics (e.g., direct socket access).
 *
 * Closing a SessionChannel MUST release session-owned resources (e.g., key
 * material). It MAY or MAY NOT close the underlying transport — callers are
 * responsible for closing the transport separately when appropriate.
 */
export type SessionChannel = TransportConnection;

/**
 * Signal emitted by the session layer (e.g., SBRP pause/resume).
 *
 * Known SBRP control types: "session_paused", "session_resumed",
 * "session_ended", "session_pending". `type` is `string` to stay
 * extensible as the relay protocol evolves.
 */
export interface SessionSignal {
  type: string;
  message?: string;
}

/** Negotiation result returned after successful handshake */
export interface NegotiationResult {
  peerId: PeerId;
  identity?: VerifiedIdentity;
  capabilities: string[];
  metadata: Record<string, string>;
  /**
   * Optional session channel for ongoing frame I/O.
   * If provided, SessionManager uses this instead of the raw transport.
   * Session protocols (e.g., SBRP) return a channel that encrypts/decrypts frames.
   */
  channel?: SessionChannel;
  /** Subscribe to ongoing session signals (e.g., SBRP pause/resume). Returns an unsubscribe fn. */
  subscribeSignals?: (handler: (signal: SessionSignal) => void) => () => void;
}

/**
 * Connection parameters resolved before each connect attempt.
 *
 * Returned by `Negotiator.getConnectionParams()` to supply a fresh endpoint
 * URL and optional upgrade headers on every connection (including reconnects).
 * Use this to rotate time-limited tokens embedded in the URL or headers.
 */
export interface NegotiatorConnectionParams {
  /**
   * Endpoint URL for this attempt — overrides `PeerOptions.endpoint`.
   * Required when `PeerOptions.endpoint` is not set.
   */
  endpoint?: string;
  /**
   * Extra headers for the WebSocket upgrade request.
   * Supported on Node.js (ws library). Ignored by Bun and browsers — use
   * `?token=<jwt>` in the endpoint URL for universal compatibility.
   */
  headers?: Record<string, string>;
}

/**
 * Negotiator interface for pluggable session establishment.
 *
 * Invariants:
 * - The SessionChannel returned in NegotiationResult MUST be fully initialized
 *   and ready for frame I/O when negotiate() resolves.
 * - The runtime MUST NOT send or receive frames before negotiate() completes.
 * - terminate() is for protocol-level signaling only (e.g., sending Close frames);
 *   session-layer cleanup is handled by closing the SessionChannel.
 */
export interface Negotiator {
  /**
   * Called before each connect attempt (initial and every reconnect) to
   * resolve a fresh endpoint URL and optional upgrade headers.
   *
   * Use this to rotate time-limited tokens (e.g., embed a new JWT in the URL
   * on each attempt). If this throws, the attempt fails and the peer retries
   * per `retryPolicy`. Either this method or `PeerOptions.endpoint` must
   * provide a non-empty endpoint; runtime throws if neither does.
   */
  getConnectionParams?(): Promise<NegotiatorConnectionParams>;
  /** Establish session after transport opens */
  negotiate(conn: TransportConnection): Promise<NegotiationResult>;
  /** Protocol-specific close signaling; MUST be idempotent */
  terminate(conn: TransportConnection, options?: CloseOptions): Promise<void>;
  /** Classify an error as fatal or retryable */
  classifyError(error: Error): "fatal" | "retryable";
}

/** Retry policy per ADR-009 */
export interface RetryPolicy {
  mode: "never" | "on-error";
  initialDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
  jitter: number;
}

export const defaultRetryPolicy: RetryPolicy = {
  mode: "never",
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  maxAttempts: 5,
  jitter: 0.2,
};

/**
 * Session events emitted during lifecycle transitions.
 *
 * Extensibility: Future versions may add new events. Consumers SHOULD
 * ignore unknown events and MUST NOT assume this list is exhaustive.
 */
export interface SessionEvents {
  connecting: { endpoint: string };
  negotiating: { transport: TransportConnection };
  active: { peerId: PeerId; capabilities: string[] };
  retrying: { attempt: number; delayMs: number; lastError: Error };
  closed: { reason: string; graceful: boolean; fatal: boolean };
  identity_established: { identity: VerifiedIdentity; trusted: boolean };
  identity_mismatch: { expected: VerifiedIdentity; received: VerifiedIdentity };
}
