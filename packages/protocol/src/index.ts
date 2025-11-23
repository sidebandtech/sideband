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
 * - Frame codec for serialization
 * - Type guards for discriminated unions
 * - Protocol error class
 *
 * For transport ABI (Transport, TransportConnection, etc.), see @sideband/transport.
 */

// Types
export type {
  ConnectionId,
  CorrelationId,
  FrameId,
  PeerId,
  StreamId,
  Subject,
} from "./types.js";

export {
  asConnectionId,
  asCorrelationId,
  asFrameId,
  asPeerId,
  asStreamId,
  asSubject,
  frameIdFromHex,
  frameIdToHex,
  generateFrameId,
  MAX_SUBJECT_BYTES,
} from "./types.js";

// Constants and enums
export {
  ControlOp,
  ErrorCode,
  FrameKind,
  PROTOCOL_ID,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
} from "./constants.js";

// Frames
export type {
  AckFrame,
  BaseControlFrame,
  BaseFrame,
  CloseControlFrame,
  ControlFrame,
  ControlFrameOptions,
  ErrorFrame,
  Frame,
  HandshakeControlFrame,
  MessageFrame,
  MessageFrameOptions,
  PingControlFrame,
  PongControlFrame,
} from "./frames.js";

export {
  createCloseFrame,
  createHandshakeFrame,
  createMessageFrame,
  createPingFrame,
  createPongFrame,
} from "./frames.js";

// Handshake
export { decodeHandshake, encodeHandshake } from "./handshake.js";
export type { HandshakePayload } from "./handshake.js";

// Codec
export { decodeFrame, encodeFrame } from "./codec.js";

// Type guards
export {
  isAckFrame,
  isCloseFrame,
  isControlFrame,
  isErrorFrame,
  isHandshakeFrame,
  isMessageFrame,
  isPingFrame,
  isPongFrame,
  isValidFrameId,
} from "./guards.js";

// Error
export { ProtocolError } from "./error.js";
