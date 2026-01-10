// SPDX-License-Identifier: Apache-2.0

/**
 * @sideband/transport
 *
 * Transport ABI and shared utilities for Sideband communication.
 *
 * Defines the Transport interface that concrete implementations (browser, node, etc.)
 * must implement. Transports depend only on @sideband/protocol, never on runtime/rpc/peer.
 *
 * Exports:
 * - Transport, TransportConnection, TransportListener interfaces
 * - ConnectOptions, ListenOptions configuration
 * - ConnectionHandler type
 * - TransportEndpoint type and helper
 */

export type {
  Transport,
  TransportConnection,
  TransportListener,
  TransportEndpoint,
  ConnectOptions,
  ListenOptions,
  ConnectionHandler,
} from "./types.js";

export { asTransportEndpoint } from "./types.js";

// Example / reference implementation
export { MemoryTransport } from "./memory.js";
