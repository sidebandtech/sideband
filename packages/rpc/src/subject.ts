// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RPC subject types and utilities.
 *
 * All RPC and event messages must use a subject with a reserved prefix:
 * - "rpc/" for RPC requests/responses
 * - "event/" for pub/sub notifications
 * - "stream/" for streaming (reserved for v2)
 * - "app/" for vendor-specific use
 *
 * Subject validation is enforced at the protocol layer per ADR-006 and ADR-008.
 * This module re-exports the protocol Subject type and validator for RPC convenience.
 * See ADR-002 and ADR-006 for the specification.
 */

import type { Subject } from "@sideband/protocol";
import { asSubject, ProtocolError, ErrorCode } from "@sideband/protocol";

/**
 * Type alias for clarity in RPC contexts.
 * RpcSubject is simply a validated Subject (see @sideband/protocol).
 */
export type RpcSubject = Subject;

/**
 * Reserved subject prefixes and their purposes.
 * Re-exported for backwards compatibility.
 */
export const SUBJECT_PREFIXES = {
  /** RPC requests and responses */
  RPC: "rpc/",
  /** Pub/sub events and notifications */
  EVENT: "event/",
  /** Streaming (reserved for v2) */
  STREAM: "stream/",
  /** Vendor-specific / custom */
  APP: "app/",
} as const;

/**
 * Validate a subject string against the reserved namespace rules.
 *
 * @param subject The subject string to validate
 * @returns true if valid, false otherwise
 * @deprecated Use asRpcSubject() which throws on invalid input for better error handling
 */
export function isValidRpcSubject(subject: string): boolean {
  try {
    asSubject(subject);
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-export protocol Subject validator for RPC use.
 */
export { asSubject as asRpcSubject };

/**
 * Protocol violation error.
 * This is now handled via ProtocolError at the protocol layer.
 * Kept for backwards compatibility with existing RPC code patterns.
 * @deprecated Use ProtocolError from @sideband/protocol instead.
 */
export class ProtocolViolation extends ProtocolError {
  constructor(message: string) {
    super(message, ErrorCode.ProtocolViolation);
    this.name = "ProtocolViolation";
  }
}
