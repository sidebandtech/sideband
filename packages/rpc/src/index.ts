// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @sideband/rpc
 *
 * Canonical RPC and messaging envelope over MessageFrame.
 *
 * Exports:
 * - RPC envelope types (request, response, notification)
 * - Envelope creation helpers
 * - Type guards for discriminated unions
 * - Subject validation and branding
 * - Codec for encoding/decoding envelopes
 * - Protocol violation error class
 */

// Envelope types and helpers
export type {
  RpcEnvelopeType,
  RpcRequest,
  RpcSuccessResponse,
  RpcErrorResponse,
  RpcResponse,
  RpcNotification,
  RpcEnvelope,
} from "./envelope.js";

export {
  createRpcRequest,
  createRpcSuccessResponse,
  createRpcErrorResponse,
  createRpcNotification,
  isRpcRequest,
  isRpcResponse,
  isRpcSuccessResponse,
  isRpcErrorResponse,
  isRpcNotification,
} from "./envelope.js";

// Subject validation
export type { RpcSubject } from "./subject.js";
export {
  SUBJECT_PREFIXES,
  isValidRpcSubject,
  asRpcSubject,
  ProtocolViolation,
} from "./subject.js";

// Codec
export type { EncodingFormat } from "./codec.js";
export { encodeRpcEnvelope, decodeRpcEnvelope } from "./codec.js";
