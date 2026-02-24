// SPDX-License-Identifier: Apache-2.0

/**
 * Protocol-specific error with error code tracking.
 *
 * Used across protocol layers (SBP, RPC, etc.). Each layer owns a
 * non-overlapping code range; see docs/protocols/stack.md#error-code-ownership.
 */
export class ProtocolError extends Error {
  public readonly code: number;
  public readonly details?: unknown;

  constructor(message: string, code: number, details?: unknown) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ProtocolError.prototype);
  }
}
