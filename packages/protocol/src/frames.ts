// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FrameId } from "./types.js";
import { FrameKind, ControlOp, ErrorCode } from "./constants.js";

/**
 * Base frame structure shared by all frame types.
 * These are the "Logical" types representing the application view,
 * not the wire format. Wire compression details (like `t` or `c`)
 * are handled strictly within the codec layer.
 */
export interface BaseFrame {
  kind: FrameKind;
  frameId: FrameId; // identifies this frame instance; used for request/response correlation and ACK linkage
}

/**
 * Control frame for handshake, ping/pong, and connection management.
 */
export interface ControlFrame extends BaseFrame {
  kind: FrameKind.Control;
  op: ControlOp;
  data?: Uint8Array; // opaque binary data for extensions or metadata
}

/**
 * Message frame for application payloads (RPC or Events).
 * Carries routable, identity-bearing messages with subject-based routing.
 * Supports both request/response (RPC) and pub/sub patterns via the subject routing.
 */
export interface MessageFrame extends BaseFrame {
  kind: FrameKind.Message;
  subject: string; // routing key: "service.method" or "topic.stream"
  data: Uint8Array; // opaque message content (encoded application data)
}

/**
 * Acknowledgement frame for guaranteed delivery.
 */
export interface AckFrame extends BaseFrame {
  kind: FrameKind.Ack;
  ackFrameId: FrameId; // frameId of the frame being acknowledged
}

/**
 * Error frame for protocol and application errors.
 */
export interface ErrorFrame extends BaseFrame {
  kind: FrameKind.Error;
  code: ErrorCode;
  message: string;
  details?: Uint8Array; // optional binary error details (e.g. JSON metadata)
}

/**
 * Discriminated union of all frame types.
 * Used for type-safe frame handling throughout the protocol.
 */
export type Frame = ControlFrame | MessageFrame | AckFrame | ErrorFrame;
