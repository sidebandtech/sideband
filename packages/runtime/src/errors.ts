// SPDX-License-Identifier: Apache-2.0

/**
 * Base error class for runtime errors.
 */
export class RuntimeError extends Error {
  override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "RuntimeError";
    this.cause = cause;
  }
}
