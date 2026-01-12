// SPDX-License-Identifier: Apache-2.0

/**
 * Browser WebSocket transport for Sideband.
 *
 * Uses the native browser WebSocket API. Suitable for web apps and
 * browser-based clients connecting to relay servers.
 *
 * @module @sideband/transport-ws/browser
 */

export * from "./ws-errors.js";

// Transport implementation planned:
// - BrowserWsTransport using native WebSocket API
// - Reconnection with exponential backoff
// - Map WebSocket events to Transport interface
