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
  PeerId,
  ConnectionId,
  FrameId,
  CorrelationId,
  StreamId,
  Subject,
} from "./types.js";

export {
  asPeerId,
  asConnectionId,
  asFrameId,
  asCorrelationId,
  asStreamId,
  asSubject,
  generateFrameId,
  frameIdToHex,
  frameIdFromHex,
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
  BaseControlFrame,
  HandshakeControlFrame,
  PingControlFrame,
  PongControlFrame,
  CloseControlFrame,
  MessageFrame,
  AckFrame,
  ErrorFrame,
  ControlFrameOptions,
  MessageFrameOptions,
} from "./frames.js";

export {
  createHandshakeFrame,
  createPingFrame,
  createPongFrame,
  createCloseFrame,
  createMessageFrame,
} from "./frames.js";

// Handshake
export type { HandshakePayload } from "./handshake.js";
export { encodeHandshake, decodeHandshake } from "./handshake.js";

// Codec
export { encodeFrame, decodeFrame } from "./codec.js";

// Type guards
export {
  isControlFrame,
  isHandshakeFrame,
  isPingFrame,
  isPongFrame,
  isCloseFrame,
  isMessageFrame,
  isAckFrame,
  isErrorFrame,
  isValidFrameId,
} from "./guards.js";

// Error
export { ProtocolError } from "./error.js";
