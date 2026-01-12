// SPDX-License-Identifier: Apache-2.0

/**
 * Node.js/Bun WebSocket transport for Sideband.
 *
 * Uses Bun's native WebSocket or ws library for Node.js.
 * Suitable for server-side apps, daemons, and CLI tools.
 *
 * @module @sideband/transport-ws/node
 */

export * from "./ws-errors.js";

// Transport implementation planned:
// - NodeWsTransport using Bun.serve WebSocket or ws library
// - Support both client and server modes
// - Reconnection with exponential backoff
// - Map WebSocket events to Transport interface
