// SPDX-License-Identifier: Apache-2.0

/**
 * Shared WebSocket connection implementation.
 * Used by browser, Node, and Bun transport adapters.
 */

import { type ConnectionId, asConnectionId } from "@sideband/protocol";
import {
  type CloseInfo,
  type CloseOptions,
  type ConnectionState,
  type TransportConnection,
  type TransportEndpoint,
  TransportError,
} from "@sideband/transport";
import type { IoBytes, WsLimits } from "./types.js";
import { deriveCloseKind } from "./ws-errors.js";

/** Default limits */
const DEFAULT_MAX_MESSAGE_SIZE = 1048576; // 1 MiB
const DEFAULT_MAX_SEND_BUFFER = 16777216; // 16 MiB
const DEFAULT_MAX_INBOUND_BUFFER = 16777216; // 16 MiB

/**
 * Options for creating a WsConnection.
 */
export interface WsConnectionInit {
  /** The WebSocket instance */
  ws: WebSocket;
  /** Connection endpoint (for diagnostics) */
  endpoint: TransportEndpoint;
  /** Negotiated subprotocol */
  subprotocol?: string;
  /** Connection limits */
  limits?: WsLimits;
}

/**
 * Shared WebSocket connection implementation.
 * Implements TransportConnection interface with:
 * - State management with monotonic transitions
 * - Send ordering and backpressure (buffer_overflow on limit exceeded)
 * - Inbound iterator with single-consumer enforcement
 * - Traffic diagnostics (ioBytes) for error classification
 */
export class WsConnection implements TransportConnection {
  readonly id: ConnectionId;
  readonly endpoint: TransportEndpoint;
  readonly subprotocol?: string;

  private readonly _ws: WebSocket;
  private readonly _limits: Required<WsLimits>;
  private _state: ConnectionState = "connecting";
  private _ioBytes: IoBytes = { sent: 0, received: 0 };

  // Close handling
  private _closeInfo: CloseInfo | null = null;
  private readonly _closedPromise: Promise<CloseInfo>;
  private _resolveClose!: (info: CloseInfo) => void;

  // Inbound iterator state
  private _iteratorActive = false;
  private _inboundQueue: Uint8Array[] = [];
  private _inboundBufferBytes = 0;
  private _inboundResolve:
    | ((result: IteratorResult<Uint8Array>) => void)
    | null = null;
  private _inboundClosed = false;

  constructor(init: WsConnectionInit) {
    this.id = asConnectionId(crypto.randomUUID());
    this.endpoint = init.endpoint;
    this.subprotocol = init.subprotocol;
    this._ws = init.ws;
    this._limits = {
      maxMessageSize: init.limits?.maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE,
      maxSendBufferBytes:
        init.limits?.maxSendBufferBytes ?? DEFAULT_MAX_SEND_BUFFER,
      maxInboundBufferBytes:
        init.limits?.maxInboundBufferBytes ?? DEFAULT_MAX_INBOUND_BUFFER,
    };

    this._closedPromise = new Promise((resolve) => {
      this._resolveClose = resolve;
    });

    this._setupEventHandlers();
  }

  get state(): ConnectionState {
    return this._state;
  }

  get closed(): Promise<CloseInfo> {
    return this._closedPromise;
  }

  get pendingSendBytes(): number {
    return this._ws.bufferedAmount;
  }

  /** Traffic diagnostics for error classification */
  get ioBytes(): IoBytes {
    return { ...this._ioBytes };
  }

  get inbound(): AsyncIterable<Uint8Array> {
    return {
      [Symbol.asyncIterator]: () => this._createIterator(),
    };
  }

  async send(bytes: Uint8Array): Promise<void> {
    // Check state
    if (this._state === "closed" || this._state === "closing") {
      throw new TransportError(
        "transport_failure",
        "Cannot send on closed connection",
      );
    }

    // Check send buffer limit (backpressure)
    if (
      this._ws.bufferedAmount + bytes.byteLength >
      this._limits.maxSendBufferBytes
    ) {
      throw new TransportError(
        "buffer_overflow",
        `Send buffer overflow: ${this._ws.bufferedAmount + bytes.byteLength} exceeds limit ${this._limits.maxSendBufferBytes}`,
      );
    }

    // Check message size limit
    if (bytes.byteLength > this._limits.maxMessageSize) {
      throw new TransportError(
        "message_too_large",
        `Message size ${bytes.byteLength} exceeds limit ${this._limits.maxMessageSize}`,
      );
    }

    this._ws.send(bytes);
    this._ioBytes.sent += bytes.byteLength;
  }

  async close(options?: CloseOptions): Promise<void> {
    if (this._state === "closed") {
      return;
    }

    if (this._state !== "closing") {
      this._state = "closing";
      const code = options?.closeCode ?? 1000;
      const reason = options?.reason ?? "";
      this._ws.close(code, reason);
    }

    await this._closedPromise;
  }

  /** Mark connection as open (called by transport after handshake) */
  _markOpen(): void {
    if (this._state === "connecting") {
      this._state = "open";
    }
  }

  private _setupEventHandlers(): void {
    this._ws.binaryType = "arraybuffer";

    this._ws.onopen = () => {
      this._markOpen();
    };

    this._ws.onmessage = (event: MessageEvent) => {
      // Reject text frames
      if (typeof event.data === "string") {
        this._ws.close(1003, "Text frames not supported");
        return;
      }

      const data = new Uint8Array(event.data as ArrayBuffer);

      // Check message size
      if (data.byteLength > this._limits.maxMessageSize) {
        this._ws.close(1009, "Message too large");
        return;
      }

      this._ioBytes.received += data.byteLength;

      // Check inbound buffer limit
      if (
        this._inboundBufferBytes + data.byteLength >
        this._limits.maxInboundBufferBytes
      ) {
        this._ws.close(1011, "Inbound buffer overflow");
        return;
      }

      this._inboundBufferBytes += data.byteLength;

      // If iterator is waiting, deliver directly
      if (this._inboundResolve) {
        const resolve = this._inboundResolve;
        this._inboundResolve = null;
        this._inboundBufferBytes -= data.byteLength;
        resolve({ value: data, done: false });
      } else {
        this._inboundQueue.push(data);
      }
    };

    this._ws.onerror = () => {
      // Browser WebSocket error is opaque; actual error info comes in onclose
    };

    this._ws.onclose = (event: CloseEvent) => {
      this._handleClose(event.code, event.reason);
    };
  }

  private _handleClose(code: number, reason: string): void {
    if (this._state === "closed") return;

    this._state = "closed";
    this._inboundClosed = true;

    const graceful = code === 1000;
    const errorKind = graceful
      ? null
      : deriveCloseKind(code, { ioBytes: this._ioBytes });

    this._closeInfo = {
      graceful,
      closeCode: code,
      reason: reason || undefined,
      error: errorKind
        ? new TransportError(
            errorKind,
            reason || `WebSocket closed with code ${code}`,
          )
        : undefined,
    };

    // Complete pending iterator and release lock
    if (this._inboundResolve) {
      const resolve = this._inboundResolve;
      this._inboundResolve = null;
      this._iteratorActive = false;
      resolve({ value: undefined, done: true });
    }

    this._resolveClose(this._closeInfo);
  }

  private _createIterator(): AsyncIterator<Uint8Array> {
    // Single-consumer enforcement
    if (this._iteratorActive) {
      throw new TransportError(
        "transport_failure",
        "Inbound iterator already consumed (single-consumer only)",
      );
    }
    this._iteratorActive = true;

    return {
      next: async (): Promise<IteratorResult<Uint8Array>> => {
        // Return queued messages first
        if (this._inboundQueue.length > 0) {
          const data = this._inboundQueue.shift()!;
          this._inboundBufferBytes -= data.byteLength;
          return { value: data, done: false };
        }

        // If closed, release lock and return done
        if (this._inboundClosed) {
          this._iteratorActive = false;
          return { value: undefined, done: true };
        }

        // Wait for next message
        return new Promise((resolve) => {
          this._inboundResolve = resolve;
        });
      },
      // Required by the ES async iterator protocol. Without this, early exits
      // from `for await...of` (e.g. after reading one frame during negotiation)
      // leave _iteratorActive = true, causing "iterator already consumed" when
      // startFrameLoop() tries to create the second iterator.
      return: async (): Promise<IteratorResult<Uint8Array>> => {
        this._iteratorActive = false;
        if (this._inboundResolve) {
          const resolve = this._inboundResolve;
          this._inboundResolve = null;
          resolve({ value: undefined, done: true });
        }
        return { value: undefined, done: true };
      },
    };
  }
}
