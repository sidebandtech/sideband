// SPDX-License-Identifier: Apache-2.0

/**
 * WebSocket transport for Sideband.
 *
 * Provides a unified `wsTransport()` factory with automatic platform detection.
 * Use `wsEndpoint()` to create validated WebSocket endpoints.
 *
 * @example
 * ```typescript
 * import { wsTransport, wsEndpoint } from "@sideband/transport-ws";
 *
 * const transport = wsTransport();
 * const conn = await transport.connect(wsEndpoint("wss://relay.example.com"), {
 *   auth: { token: "...", mode: "query" },
 * });
 * ```
 *
 * For environment-specific imports:
 * - `@sideband/transport-ws/browser` for browser-only code
 * - `@sideband/transport-ws/node` for Node.js/Bun-only code
 *
 * @module @sideband/transport-ws
 */

import type { Transport } from "@sideband/transport";
import type { WsTransportOptions } from "./types.js";

// Re-export types and utilities
export { wsEndpoint, wsEndpointFromHttp } from "./browser.js";
export { WsConnection, type WsConnectionInit } from "./connection.js";
export * from "./types.js";
export * from "./ws-errors.js";

/**
 * Detect current platform.
 * Check for Bun first, then browser, then Node.
 */
function detectPlatform(): "browser" | "node" | "bun" {
  // Bun check must come first (Bun has window-like globals in some contexts)
  if (typeof Bun !== "undefined") {
    return "bun";
  }
  // Browser check - use globalThis to avoid TypeScript DOM lib requirement
  const g = globalThis as Record<string, unknown>;
  if (
    typeof g["window"] !== "undefined" &&
    typeof g["document"] !== "undefined"
  ) {
    return "browser";
  }
  // Default to Node
  return "node";
}

/**
 * Create a WebSocket transport with automatic platform detection.
 *
 * Platform detection order:
 * 1. Check for `Bun` global → "bun"
 * 2. Check for `window` and `document` → "browser"
 * 3. Default → "node"
 *
 * Use `options.platform` to override detection (useful for testing).
 *
 * @example
 * ```typescript
 * // Auto-detect platform
 * const transport = wsTransport();
 *
 * // Override for testing browser code in Node
 * const transport = wsTransport({ platform: "browser" });
 * ```
 */
export function wsTransport(options?: WsTransportOptions): Transport {
  const platform = options?.platform ?? detectPlatform();

  if (platform === "browser") {
    return createBrowserTransport();
  } else {
    return createNodeTransport();
  }
}

// Lazy-loaded transport factories to support tree-shaking
// Browser transport
import { browserWsTransport } from "./browser.js";
function createBrowserTransport(): Transport {
  return browserWsTransport();
}

// Node/Bun transport
import { nodeWsTransport } from "./node.js";
function createNodeTransport(): Transport {
  return nodeWsTransport();
}

// Re-export platform-specific factory functions for explicit use
export { browserWsTransport, nodeWsTransport };
