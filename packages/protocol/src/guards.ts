// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Frame,
  ControlFrame,
  HandshakeControlFrame,
  PingControlFrame,
  PongControlFrame,
  CloseControlFrame,
  MessageFrame,
  AckFrame,
  ErrorFrame,
} from "./frames.js";
import type { FrameId } from "./types.js";
import { FrameKind, ControlOp } from "./constants.js";

/**
 * Type guard: check if frame is a ControlFrame.
 */
export function isControlFrame(frame: Frame): frame is ControlFrame {
  return frame.kind === FrameKind.Control;
}

/**
 * Type guard: check if frame is a MessageFrame (application data).
 */
export function isMessageFrame(frame: Frame): frame is MessageFrame {
  return frame.kind === FrameKind.Message;
}

/**
 * Type guard: check if frame is an AckFrame.
 */
export function isAckFrame(frame: Frame): frame is AckFrame {
  return frame.kind === FrameKind.Ack;
}

/**
 * Type guard: check if frame is an ErrorFrame.
 */
export function isErrorFrame(frame: Frame): frame is ErrorFrame {
  return frame.kind === FrameKind.Error;
}

/**
 * Type guard: check if frame is a Handshake control frame.
 */
export function isHandshakeFrame(frame: Frame): frame is HandshakeControlFrame {
  return frame.kind === FrameKind.Control && frame.op === ControlOp.Handshake;
}

/**
 * Type guard: check if frame is a Ping control frame.
 */
export function isPingFrame(frame: Frame): frame is PingControlFrame {
  return frame.kind === FrameKind.Control && frame.op === ControlOp.Ping;
}

/**
 * Type guard: check if frame is a Pong control frame.
 */
export function isPongFrame(frame: Frame): frame is PongControlFrame {
  return frame.kind === FrameKind.Control && frame.op === ControlOp.Pong;
}

/**
 * Type guard: check if frame is a Close control frame.
 */
export function isCloseFrame(frame: Frame): frame is CloseControlFrame {
  return frame.kind === FrameKind.Control && frame.op === ControlOp.Close;
}

/**
 * Validate that a FrameId is exactly 16 bytes.
 * Returns true if valid, false otherwise (does not throw).
 */
export function isValidFrameId(id: FrameId): id is FrameId {
  return id.length === 16;
}
