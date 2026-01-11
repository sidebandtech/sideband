// SPDX-License-Identifier: Apache-2.0

/**
 * @sideband/runtime
 *
 * Transport-agnostic peer management, message routing, and RPC correlation.
 *
 * Exports:
 * - Router: Message routing with subject validation and RPC dispatch
 * - SessionManager: Session lifecycle with pluggable negotiators
 * - RpcCorrelationManager: Pending request tracking and response matching
 * - SbpNegotiator: SBP protocol handshake negotiator
 */

// Core types
export { RuntimeError } from "./errors.js";
export type { SessionState, Unsubscribe, VerifiedIdentity } from "./types.js";

// Correlation
export { RpcCorrelationManager } from "./correlation.js";

// Router
export {
  createRouter,
  defaultSubjectPolicy,
  getDefaultMode,
  HandlerRegistry,
  Router,
  validateSubject,
  type HandlerEntry,
  type InboundMessage,
  type MessageHandler,
  type RouteOptions,
  type RouterConfig,
  type RpcContext,
  type RpcErrorPayload,
  type SessionLike,
  type SubjectKind,
  type SubjectPolicy,
  type SubjectValidationResult,
} from "./router/index.js";

// Session
export {
  createSessionManager,
  SessionManager,
  type DecodeErrorAction,
  type Session,
  type SessionConfig,
  type TransportEndpoint,
  type TransportFactory,
} from "./session/session.js";

export {
  calculateBackoff,
  defaultBackoffPolicy,
  type BackoffPolicy,
} from "./session/backoff.js";

export {
  defaultRetryPolicy,
  type NegotiationResult,
  type Negotiator,
  type RetryPolicy,
  type SessionChannel,
  type SessionEvents,
  type TransportConnection,
} from "./session/types.js";

// Negotiators
export { SbpNegotiator, type SbpNegotiatorOptions } from "./negotiators/sbp.js";
