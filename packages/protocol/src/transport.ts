// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Transport interface for encoding/decoding over the wire.
 *
 * Transports should implement this interface to work with @sideband/runtime.
 * Transports depend only on @sideband/protocol, never on runtime/rpc/peer.
 */

/**
 * Metadata identifying a transport instance.
 */
export interface RawTransportInfo {
  id: string; // unique identifier for this transport instance
  kind: string; // e.g. "browser:ws", "node:ws", "stdio"
}

/**
 * Low-level transport interface that handles sending/receiving raw bytes.
 *
 * Implementations should handle:
 * - Encoding frames to bytes and sending them
 * - Receiving bytes and decoding them into frames
 * - Connection lifecycle (setup, errors, closure)
 *
 * The runtime will call `send()` and `onData()` handlers; transports call
 * `onData()`, `onClose()`, and optionally `onError()` handlers.
 */
export interface RawTransport extends RawTransportInfo {
  /**
   * Send raw bytes over the transport.
   * Should not throw; errors should be reported via onError() handler.
   */
  send(data: Uint8Array): void | Promise<void>;

  /**
   * Close the transport gracefully.
   * @param code Optional error code or close reason
   * @param reason Optional textual reason for closure
   */
  close(code?: number, reason?: string): void | Promise<void>;

  /**
   * Register a handler for incoming data.
   * @param handler Called when raw bytes are received
   * @returns Unsubscribe function
   */
  onData(handler: (data: Uint8Array) => void): () => void;

  /**
   * Register a handler for transport closure.
   * @param handler Called when transport closes
   * @returns Unsubscribe function
   */
  onClose(handler: (reason?: unknown) => void): () => void;

  /**
   * Register a handler for transport errors.
   * Called for errors during send/receive, but not closure.
   * @param handler Called when an error occurs
   * @returns Unsubscribe function
   */
  onError?(handler: (err: unknown) => void): () => void;
}
