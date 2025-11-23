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
import { asSubject } from "@sideband/protocol";

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
 * Re-export protocol Subject validator for RPC use.
 */
export { asSubject as asRpcSubject };
