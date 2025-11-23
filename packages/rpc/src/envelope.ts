// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RPC envelope types and helpers.
 *
 * All RPC messages are carried as `RpcEnvelope` inside `MessageFrame.data`.
 * The envelope discriminates between requests, responses, notifications, and errors.
 * Encoding can be CBOR (default, compact) or JSON (fallback).
 *
 * See ADR-006 for the full specification.
 */

/**
 * Discriminant for the RPC envelope type.
 * - "r" = request (expects response)
 * - "R" = response (success)
 * - "E" = error response (failure)
 * - "N" = notification (no response expected)
 */
export type RpcEnvelopeType = "r" | "R" | "E" | "N";

/**
 * Base fields shared across all RPC envelope variants.
 */
interface RpcEnvelopeBase {
  /** Envelope type discriminant */
  t: RpcEnvelopeType;
}

/**
 * RPC request envelope.
 * Sent by initiator; receiver must send a response (either success or error).
 */
export interface RpcRequest extends RpcEnvelopeBase {
  t: "r";
  /** Method name */
  m: string;
  /** Optional parameters (JSON-compatible or custom serializable type) */
  p?: unknown;
}

/**
 * RPC success response envelope.
 * Correlates to request via the request's `FrameId` (in `MessageFrame`).
 */
export interface RpcSuccessResponse extends RpcEnvelopeBase {
  t: "R";
  /** Result payload */
  result?: unknown;
}

/**
 * RPC error response envelope.
 * Correlates to request via the request's `FrameId` (in `MessageFrame`).
 */
export interface RpcErrorResponse extends RpcEnvelopeBase {
  t: "E";
  /** Error code (application-defined) */
  code: number;
  /** Human-readable error message */
  message: string;
  /** Optional structured error details */
  data?: unknown;
}

/** RPC response: either success or error */
export type RpcResponse = RpcSuccessResponse | RpcErrorResponse;

/**
 * RPC notification envelope.
 * Fire-and-forget event; no response is expected.
 */
export interface RpcNotification extends RpcEnvelopeBase {
  t: "N";
  /** Event name */
  e: string;
  /** Optional event data */
  d?: unknown;
}

/** Union of all RPC envelope variants */
export type RpcEnvelope = RpcRequest | RpcResponse | RpcNotification;

/**
 * Check if envelope is a response (success or error).
 */
export function isRpcResponse(envelope: RpcEnvelope): envelope is RpcResponse {
  return envelope.t === "R" || envelope.t === "E";
}

/**
 * Check if envelope is a success response.
 */
export function isRpcSuccessResponse(
  envelope: RpcEnvelope,
): envelope is RpcSuccessResponse {
  return envelope.t === "R";
}

/**
 * Check if envelope is an error response.
 */
export function isRpcErrorResponse(
  envelope: RpcEnvelope,
): envelope is RpcErrorResponse {
  return envelope.t === "E";
}

/**
 * Check if envelope is a notification (no response expected).
 */
export function isRpcNotification(
  envelope: RpcEnvelope,
): envelope is RpcNotification {
  return envelope.t === "N";
}

/**
 * Check if envelope is a request.
 */
export function isRpcRequest(envelope: RpcEnvelope): envelope is RpcRequest {
  return envelope.t === "r";
}

/**
 * Create an RPC request envelope.
 */
export function createRpcRequest(method: string, params?: unknown): RpcRequest {
  return {
    t: "r",
    m: method,
    ...(params !== undefined && { p: params }),
  };
}

/**
 * Create an RPC success response envelope.
 */
export function createRpcSuccessResponse(result?: unknown): RpcSuccessResponse {
  return {
    t: "R",
    ...(result !== undefined && { result }),
  };
}

/**
 * Create an RPC error response envelope.
 */
export function createRpcErrorResponse(
  code: number,
  message: string,
  data?: unknown,
): RpcErrorResponse {
  return {
    t: "E",
    code,
    message,
    ...(data !== undefined && { data }),
  };
}

/**
 * Create an RPC notification envelope.
 */
export function createRpcNotification(
  event: string,
  data?: unknown,
): RpcNotification {
  return {
    t: "N",
    e: event,
    ...(data !== undefined && { d: data }),
  };
}
