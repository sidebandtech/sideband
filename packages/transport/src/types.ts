// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Transport ABI and shared types for Sideband communication.
 *
 * This package defines the interface that concrete transports (browser, node, etc.)
 * must implement. Transports depend only on @sideband/protocol, never on runtime/rpc/peer.
 */

import type { ConnectionId } from "@sideband/protocol";

/**
 * Abstract endpoint representation for transport connections.
 * Format depends on concrete transport (e.g., "ws://host:port", "tcp://host:port").
 */
export type TransportEndpoint = string & { readonly __transportEndpoint: true };

/**
 * Helper to create a TransportEndpoint.
 */
export function asTransportEndpoint(value: string): TransportEndpoint {
  return value as TransportEndpoint;
}

/**
 * Options for establishing a connection.
 */
export interface ConnectOptions {
  /**
   * Connection timeout in milliseconds. Default: no timeout.
   */
  timeoutMs?: number;

  /**
   * Additional transport-specific options.
   */
  [key: string]: unknown;
}

/**
 * Options for listening (server-side).
 */
export interface ListenOptions {
  /**
   * Additional transport-specific options.
   */
  [key: string]: unknown;
}

/**
 * Represents a single transport link (connection) between two peers.
 * Corresponds to a single TCP connection, WebSocket, or equivalent.
 */
export interface TransportConnection {
  /**
   * Unique identifier for this connection.
   * Assigned by the transport; different each time the same peers reconnect.
   */
  readonly id: ConnectionId;

  /**
   * The endpoint this connection is connected to.
   */
  readonly endpoint: TransportEndpoint;

  /**
   * Send raw bytes over this connection.
   * Throws if connection is closed or send fails.
   */
  send(bytes: Uint8Array): Promise<void>;

  /**
   * Close this connection gracefully.
   * @param reason Optional reason for closure
   */
  close(reason?: string): Promise<void>;

  /**
   * Stream of inbound data.
   * Yields raw bytes received from the peer.
   * Completes when connection closes.
   */
  readonly inbound: AsyncIterable<Uint8Array>;
}

/**
 * A ConnectionHandler is called when an inbound connection is accepted.
 */
export type ConnectionHandler = (conn: TransportConnection) => void | Promise<void>;

/**
 * Represents a listening transport server.
 */
export interface TransportListener {
  /**
   * The endpoint this listener is listening on.
   */
  readonly endpoint: TransportEndpoint;

  /**
   * Close the listener and stop accepting connections.
   */
  close(): Promise<void>;
}

/**
 * Transport implementation must be able to:
 * 1. Connect to remote endpoints (client mode)
 * 2. Listen for inbound connections (server mode, optional)
 * 3. Identify itself by kind and capabilities
 */
export interface Transport {
  /**
   * Transport kind (e.g., "browser:ws", "node:ws", "memory").
   * Used for logging, debugging, and transport selection.
   */
  readonly kind: string;

  /**
   * Establish a connection to a remote endpoint (client mode).
   * @param endpoint The remote endpoint to connect to
   * @param options Optional connection options
   * @returns A connected TransportConnection
   */
  connect(
    endpoint: TransportEndpoint,
    options?: ConnectOptions
  ): Promise<TransportConnection>;

  /**
   * Listen for inbound connections (server mode).
   * Optional; not all transports support listening (e.g., browser WebSocket clients).
   *
   * @param endpoint The endpoint to listen on
   * @param handler Called for each accepted connection
   * @param options Optional listen options
   * @returns A TransportListener that can be closed
   */
  listen?(
    endpoint: TransportEndpoint,
    handler: ConnectionHandler,
    options?: ListenOptions
  ): Promise<TransportListener>;
}
