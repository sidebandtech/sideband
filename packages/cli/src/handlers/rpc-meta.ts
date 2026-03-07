// SPDX-License-Identifier: Apache-2.0

import type { ConnectedPeer } from "@sideband/cloud";

/**
 * Human-readable metadata for a single RPC method. All fields are optional —
 * absence means "no description available". Clients merge sparse rpc.describe
 * output with the full rpc.list method set for display.
 */
export interface MethodMeta {
  /** Short human-readable description shown in the RPC explorer. */
  description?: string;
  /** Human-readable input hint. Not validated or parsed — display only. */
  input?: string;
  /** Pre-fill value for the explorer input field. */
  inputExample?: unknown;
}

/**
 * Registers $sideband/rpc.list and $sideband/rpc.describe handlers.
 *
 * - rpc.list: returns all registered method names, sorted lexicographically.
 * - rpc.describe: returns sparse metadata for methods that have descriptions.
 *
 * These are infrastructure handlers — always available, not listed in capabilities.
 */
export function registerRpcMeta(
  peer: ConnectedPeer,
  descriptions: Record<string, MethodMeta>,
): void {
  peer.rpc.handle("$sideband/rpc.list", () => ({
    methods: peer.rpc.listMethods(),
  }));

  peer.rpc.handle("$sideband/rpc.describe", () => descriptions);
}
