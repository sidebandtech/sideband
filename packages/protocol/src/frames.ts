// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FrameId, Subject } from "./types.js";
import { FrameKind, ControlOp, ErrorCode } from "./constants.js";
import { generateFrameId, asSubject } from "./types.js";

/**
 * Base frame structure shared by all frame types.
 * These are the "Logical" types representing the application view,
 * not the wire format. Wire compression details (like `t` or `c`)
 * are handled strictly within the codec layer.
 * All properties are readonly to ensure decoded frames cannot be mutated.
 */
export interface BaseFrame {
  readonly kind: FrameKind;
  readonly frameId: FrameId; // identifies this frame instance; used for request/response correlation and ACK linkage
}

/**
 * Base control frame: shared structure across all control operations.
 * Discrimination is done via the `op` field to the specific variant.
 * Per ADR 002: each control op has specific data invariants:
 * - Handshake: data is required (JSON-encoded HandshakePayload)
 * - Ping/Pong: data must not be present
 * - Close: data is optional (UTF-8 reason string)
 */
export interface BaseControlFrame extends BaseFrame {
  readonly kind: FrameKind.Control;
  readonly op: ControlOp;
}

/**
 * Handshake control frame: initiates protocol handshake.
 * data is required and contains JSON-encoded HandshakePayload.
 */
export interface HandshakeControlFrame extends BaseControlFrame {
  readonly op: ControlOp.Handshake;
  readonly data: Readonly<Uint8Array>; // required: JSON handshake payload
}

/**
 * Ping control frame: keepalive probe.
 * Must not carry a payload; data is explicitly undefined.
 */
export interface PingControlFrame extends BaseControlFrame {
  readonly op: ControlOp.Ping;
  readonly data?: undefined;
}

/**
 * Pong control frame: response to ping.
 * Must not carry a payload; data is explicitly undefined.
 */
export interface PongControlFrame extends BaseControlFrame {
  readonly op: ControlOp.Pong;
  readonly data?: undefined;
}

/**
 * Close control frame: gracefully terminate connection.
 * May carry an optional UTF-8 reason string as data.
 */
export interface CloseControlFrame extends BaseControlFrame {
  readonly op: ControlOp.Close;
  readonly data?: Readonly<Uint8Array>; // optional: UTF-8 close reason
}

/**
 * Discriminated union of all control frame variants.
 * Use this type for control frames; never construct BaseControlFrame directly.
 */
export type ControlFrame =
  | HandshakeControlFrame
  | PingControlFrame
  | PongControlFrame
  | CloseControlFrame;

/**
 * Message frame for application payloads (RPC or Events).
 * Carries routable, identity-bearing messages with subject-based routing.
 * Supports both request/response (RPC) and pub/sub patterns via the subject routing.
 *
 * Per ADR-006 and ADR-008, subject is validated at the protocol layer.
 * All subjects must start with one of: "rpc/", "event/", "stream/", "app/".
 */
export interface MessageFrame extends BaseFrame {
  readonly kind: FrameKind.Message;
  readonly subject: Subject; // validated routing key per ADR-006, ADR-008
  readonly data: Readonly<Uint8Array>; // opaque message content (encoded application data)
}

/**
 * Acknowledgement frame for guaranteed delivery.
 */
export interface AckFrame extends BaseFrame {
  readonly kind: FrameKind.Ack;
  readonly ackFrameId: FrameId; // frameId of the frame being acknowledged
}

/**
 * Error frame for protocol and application errors.
 */
export interface ErrorFrame extends BaseFrame {
  readonly kind: FrameKind.Error;
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Readonly<Uint8Array>; // optional binary error details (e.g. JSON metadata)
}

/**
 * Discriminated union of all frame types.
 * Used for type-safe frame handling throughout the protocol.
 * All variants are deeply readonly to prevent accidental mutation of decoded frames.
 * See ADR 007 for rationale.
 */
export type Frame = Readonly<
  ControlFrame | MessageFrame | AckFrame | ErrorFrame
>;

/**
 * Options for creating control frames.
 * frameId is auto-generated if not provided.
 */
export interface ControlFrameOptions {
  frameId?: FrameId;
}

/**
 * Create a Handshake control frame.
 * Enforces that data (JSON-encoded HandshakePayload) is required.
 *
 * @param data - JSON-encoded HandshakePayload (required)
 * @param opts - Optional frame configuration (frameId auto-generated if omitted)
 */
export function createHandshakeFrame(
  data: Uint8Array,
  opts?: ControlFrameOptions,
): Readonly<HandshakeControlFrame> {
  return {
    kind: FrameKind.Control,
    op: ControlOp.Handshake,
    frameId: opts?.frameId ?? generateFrameId(),
    data,
  };
}

/**
 * Create a Ping control frame.
 * Enforces that no payload is carried.
 *
 * @param opts - Optional frame configuration (frameId auto-generated if omitted)
 */
export function createPingFrame(
  opts?: ControlFrameOptions,
): Readonly<PingControlFrame> {
  return {
    kind: FrameKind.Control,
    op: ControlOp.Ping,
    frameId: opts?.frameId ?? generateFrameId(),
    data: undefined,
  };
}

/**
 * Create a Pong control frame.
 * Enforces that no payload is carried.
 *
 * @param opts - Optional frame configuration (frameId auto-generated if omitted)
 */
export function createPongFrame(
  opts?: ControlFrameOptions,
): Readonly<PongControlFrame> {
  return {
    kind: FrameKind.Control,
    op: ControlOp.Pong,
    frameId: opts?.frameId ?? generateFrameId(),
    data: undefined,
  };
}

/**
 * Create a Close control frame.
 * Optionally carries a UTF-8 reason string.
 *
 * @param reason - Optional UTF-8 close reason bytes
 * @param opts - Optional frame configuration (frameId auto-generated if omitted)
 */
export function createCloseFrame(
  reason?: Uint8Array,
  opts?: ControlFrameOptions,
): Readonly<CloseControlFrame> {
  return {
    kind: FrameKind.Control,
    op: ControlOp.Close,
    frameId: opts?.frameId ?? generateFrameId(),
    data: reason,
  };
}

/**
 * Options for creating message frames.
 * frameId is auto-generated if not provided.
 */
export interface MessageFrameOptions {
  frameId?: FrameId;
}

/**
 * Create a Message frame for application payloads.
 * Validates the subject against reserved prefixes per ADR-006 and ADR-008.
 *
 * @param subject - Routing key: must start with "rpc/", "event/", "stream/", or "app/"
 * @param data - Opaque message payload
 * @param opts - Optional frame configuration (frameId auto-generated if omitted)
 * @returns A validated MessageFrame
 * @throws {ProtocolError} with code ProtocolViolation if subject is invalid
 */
export function createMessageFrame(
  subject: string | Subject,
  data: Uint8Array,
  opts?: MessageFrameOptions,
): Readonly<MessageFrame> {
  const validatedSubject =
    typeof subject === "string" ? asSubject(subject) : subject;
  return {
    kind: FrameKind.Message,
    frameId: opts?.frameId ?? generateFrameId(),
    subject: validatedSubject,
    data,
  };
}
