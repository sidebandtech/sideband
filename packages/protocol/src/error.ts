// SPDX-License-Identifier: Apache-2.0

import { ErrorCode } from "./constants.js";

/**
 * Protocol-specific error with error code tracking.
 * Used for protocol violations and application-level errors.
 */
export class ProtocolError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(message: string, code: ErrorCode, details?: unknown) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ProtocolError.prototype);
  }
}
