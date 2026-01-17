// SPDX-License-Identifier: Apache-2.0

/**
 * RPC subject types and utilities.
 *
 * Subjects are transport-level mux keys per ADR-006:
 * - `rpc` — exact-match channel for RPC requests/responses
 * - `event` — exact-match channel for fire-and-forget events
 * - `stream` — exact-match channel for streaming (reserved for v2)
 * - `app/` — prefix for vendor-specific sub-paths
 *
 * Method/event dispatch happens via envelope fields (`m` for methods, `e` for events).
 * Subject validation is enforced at the protocol layer per ADR-006 and ADR-008.
 * See ADR-002 for the naming matrix.
 */

import type { Subject } from "@sideband/protocol";
import { asSubject } from "@sideband/protocol";

/**
 * Type alias for clarity in RPC contexts.
 * RpcSubject is simply a validated Subject (see @sideband/protocol).
 */
export type RpcSubject = Subject;

/**
 * Channel subjects (exact-match) per ADR-006.
 */
export const SUBJECT_CHANNELS = {
  /** RPC requests and responses */
  RPC: "rpc",
  /** Fire-and-forget events */
  EVENT: "event",
  /** Streaming (reserved for v2) */
  STREAM: "stream",
} as const;

/**
 * Subject prefixes for custom sub-paths per ADR-006.
 */
export const SUBJECT_PREFIXES = {
  /** Vendor-specific / custom */
  APP: "app/",
} as const;

/**
 * Re-export protocol Subject validator for RPC use.
 */
export { asSubject as asRpcSubject };
