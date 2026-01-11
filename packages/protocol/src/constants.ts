// SPDX-License-Identifier: Apache-2.0

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
 * See error-codes.md for the canonical registry.
 */
export enum ErrorCode {
  // SBP errors (1000-1099)
  ProtocolViolation = 1000,
  UnsupportedVersion = 1001,
  InvalidFrame = 1002,
  UnsupportedFeature = 1003,

  // Application errors (2000+)
  ApplicationError = 2000,
}
