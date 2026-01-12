// SPDX-License-Identifier: Apache-2.0

/**
 * Transport ABI and shared types for Sideband communication.
 *
 * This package defines the interface that concrete transports (browser, node, etc.)
 * must implement. Transports depend only on @sideband/protocol, never on runtime/rpc/peer.
 */

import type { ConnectionId } from "@sideband/protocol";
import type { CloseInfo } from "./errors.js";

export type { ConnectionId };
export type { CloseInfo } from "./errors.js";
export { asConnectionId } from "@sideband/protocol";

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
 * Connection lifecycle state.
 * See docs/protocols/transport/abi.md for state transition rules.
 */
export type ConnectionState = "connecting" | "open" | "closing" | "closed";

/**
 * Options for closing a connection.
 */
export interface CloseOptions {
  /** WebSocket close code (1000-4999). Default: 1000. */
  code?: number;
  /** Human-readable reason. */
  reason?: string;
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
   * Signal to abort the connection attempt.
   */
  signal?: AbortSignal;

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
   * Current connection state.
   * See docs/protocols/transport/abi.md for state transition rules.
   */
  readonly state: ConnectionState;

  /**
   * Promise that resolves when the connection closes.
   * MUST resolve (not reject) regardless of close reason.
   */
  readonly closed: Promise<CloseInfo>;

  /**
   * Negotiated subprotocol, if applicable.
   */
  readonly protocol?: string;

  /**
   * Bytes queued for sending. Undefined if transport doesn't expose this.
   */
  readonly bufferedAmount?: number;

  /**
   * Send raw bytes over this connection.
   * Throws if connection is closed or send fails.
   */
  send(bytes: Uint8Array): Promise<void>;

  /**
   * Close this connection gracefully.
   * Multiple calls are safe; subsequent calls resolve when the first completes.
   */
  close(options?: CloseOptions): Promise<void>;

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
export type ConnectionHandler = (
  conn: TransportConnection,
) => void | Promise<void>;

/**
 * Represents a listening transport server.
 */
export interface TransportListener {
  /**
   * The actual address this listener is bound to.
   */
  readonly address: TransportEndpoint;

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
    options?: ConnectOptions,
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
    options?: ListenOptions,
  ): Promise<TransportListener>;
}
