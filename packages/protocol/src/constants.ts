// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Protocol version and naming constants.
 */

export const PROTOCOL_NAME = "sideband" as const;
export const PROTOCOL_VERSION = "1" as const;
export const PROTOCOL_ID = `${PROTOCOL_NAME}/${PROTOCOL_VERSION}` as const;

/**
 * Frame kind enumeration.
 * Identifies the high-level category of a frame.
 */
export enum FrameKind {
  Control = 0,
  Message = 1,
  Ack = 2,
  Error = 3,
}

/**
 * Control operation enumeration.
 * Specifies the control operation within a Control frame.
 */
export enum ControlOp {
  Handshake = 0,
  Ping = 1,
  Pong = 2,
  Close = 3,
}

/**
 * Error code enumeration.
 * Standardized error codes for protocol violations and application errors.
 */
export enum ErrorCode {
  // Protocol errors (1000-1999)
  ProtocolViolation = 1000,
  UnsupportedVersion = 1001,
  InvalidFrame = 1002,

  // Application errors (2000+)
  ApplicationError = 2000,
}
