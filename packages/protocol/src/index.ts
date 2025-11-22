// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @sideband/protocol
 *
 * Wire contract for the Sideband P2P communication stack.
 *
 * Exports:
 * - Branded types for type-safe IDs
 * - Protocol constants, enums, and frame model
 * - Handshake payload and encoding
 * - Transport interface for implementations
 * - Frame codec for serialization
 * - Type guards for discriminated unions
 * - Protocol error class
 */

// Types
export type { PeerId, ConnectionId, FrameId, CorrelationId, StreamId } from "./types.js";

export {
  asPeerId,
  asConnectionId,
  asFrameId,
  asCorrelationId,
  asStreamId,
} from "./types.js";

// Constants and enums
export {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  PROTOCOL_ID,
  FrameKind,
  ControlOp,
  ErrorCode,
} from "./constants.js";

// Frames
export type {
  Frame,
  BaseFrame,
  ControlFrame,
  MessageFrame,
  AckFrame,
  ErrorFrame,
} from "./frames.js";

// Transport (low-level, protocol-bound)
export type { RawTransport, RawTransportInfo } from "./transport.js";

// Handshake
export type { HandshakePayload } from "./handshake.js";
export { encodeHandshake, decodeHandshake } from "./handshake.js";

// Codec
export { encodeFrame, decodeFrame } from "./codec.js";

// Type guards
export {
  isControlFrame,
  isMessageFrame,
  isAckFrame,
  isErrorFrame,
} from "./guards.js";

// Error
export { ProtocolError } from "./error.js";
