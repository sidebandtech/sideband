// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Frame,
  ControlFrame,
  MessageFrame,
  AckFrame,
  ErrorFrame,
} from "./frames.js";
import { FrameKind } from "./constants.js";

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
