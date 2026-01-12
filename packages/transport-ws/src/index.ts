// SPDX-License-Identifier: Apache-2.0

/**
 * WebSocket transport for Sideband.
 *
 * Default export re-exports from browser for bundler compatibility.
 * Use explicit imports for environment-specific code:
 * - `@sideband/transport-ws/browser` for browser environments
 * - `@sideband/transport-ws/node` for Node.js/Bun environments
 *
 * @module @sideband/transport-ws
 */

export * from "./browser.js";
export * from "./ws-errors.js";
