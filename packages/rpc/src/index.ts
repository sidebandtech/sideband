// SPDX-License-Identifier: Apache-2.0

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
  RpcEnvelope,
  RpcEnvelopeType,
  RpcErrorResponse,
  RpcNotification,
  RpcRequest,
  RpcResponse,
  RpcSuccessResponse,
} from "./envelope.js";

export {
  createRpcErrorResponse,
  createRpcNotification,
  createRpcRequest,
  createRpcSuccessResponse,
  isRpcErrorResponse,
  isRpcNotification,
  isRpcRequest,
  isRpcResponse,
  isRpcSuccessResponse,
} from "./envelope.js";

// Subject validation
export { asRpcSubject, SUBJECT_PREFIXES } from "./subject.js";
export type { RpcSubject } from "./subject.js";

// Codec
export { decodeRpcEnvelope, encodeRpcEnvelope } from "./codec.js";
export type { EncodingFormat } from "./codec.js";

// Error codes (RPC-owned range: 1100–1199)
export { RpcErrorCode } from "./errors.js";
