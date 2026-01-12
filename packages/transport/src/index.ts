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
  CloseInfo,
  CloseOptions,
  ConnectionHandler,
  ConnectionId,
  ConnectionState,
  ConnectOptions,
  ListenOptions,
  Transport,
  TransportConnection,
  TransportEndpoint,
  TransportListener,
} from "./types.js";

export { asConnectionId, unsafeAsTransportEndpoint } from "./types.js";

export { isRetryable, TransportError } from "./errors.js";
export type { TransportErrorKind } from "./errors.js";

// Loopback transport for testing and local communication
export { LoopbackTransport } from "./loopback.js";
