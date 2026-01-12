// SPDX-License-Identifier: Apache-2.0

/**
 * In-memory transport for testing and local communication.
 *
 * Suitable for unit tests, local development, and cross-component communication
 * within the same process. Does not involve I/O or async operations.
 */

import { asConnectionId } from "@sideband/protocol";
import type { ConnectionId } from "@sideband/protocol";

/** Default maximum message size: 1 MiB */
const DEFAULT_MAX_MESSAGE_SIZE = 1024 * 1024;
import type {
  Transport,
  TransportConnection,
  TransportEndpoint,
  ConnectOptions,
  CloseOptions,
  ListenOptions,
  ConnectionHandler,
  TransportListener,
  ConnectionState,
  CloseInfo,
} from "./types.js";
import { TransportError } from "./errors.js";

/**
 * In-memory transport implementation using channels.
 * Pairs of connections are created by endpoint string.
 */
export class MemoryTransport implements Transport {
  readonly kind = "memory";

  private endpoints = new Map<
    string,
    {
      handler: ConnectionHandler;
      channels: Array<MemoryChannel>;
    }
  >();

  async connect(
    endpoint: TransportEndpoint,
    options?: ConnectOptions,
  ): Promise<TransportConnection> {
    // Check abort signal before attempting connection (ABI requirement)
    if (options?.signal?.aborted) {
      throw new TransportError(
        "aborted",
        "Connection aborted by signal",
        options.signal.reason,
      );
    }

    const listener = this.endpoints.get(endpoint as string);
    if (!listener) {
      throw new TransportError(
        "connection_refused",
        `No listener on ${endpoint}`,
      );
    }

    const maxMessageSize =
      (options?.maxMessageSize as number | undefined) ??
      DEFAULT_MAX_MESSAGE_SIZE;

    const clientChannel = new MemoryChannel(
      asConnectionId(`client-${Math.random()}`),
      endpoint,
      maxMessageSize,
    );

    const serverChannel = new MemoryChannel(
      asConnectionId(`server-${Math.random()}`),
      endpoint,
      maxMessageSize,
    );

    // Cross-connect channels
    clientChannel.peer = serverChannel;
    serverChannel.peer = clientChannel;

    // Call listener handler with server-side connection (don't await, isolate errors)
    Promise.resolve()
      .then(() => listener.handler(serverChannel))
      .catch((err) => {
        // Handler threw; log and close connection (spec: handler error isolation)
        console.error("Connection handler error:", err);
        serverChannel.close();
      });

    return clientChannel;
  }

  async listen(
    endpoint: TransportEndpoint,
    handler: ConnectionHandler,
    _options?: ListenOptions,
  ): Promise<TransportListener> {
    const key = endpoint as string;
    if (this.endpoints.has(key)) {
      throw new Error(`Already listening on ${endpoint}`);
    }

    this.endpoints.set(key, { handler, channels: [] });

    return {
      address: endpoint,
      close: async () => {
        this.endpoints.delete(key);
      },
    };
  }
}

/**
 * Internal in-memory channel implementation.
 */
class MemoryChannel implements TransportConnection {
  readonly id: ConnectionId;
  readonly endpoint: TransportEndpoint;
  private readonly maxMessageSize: number;

  peer?: MemoryChannel;
  private _state: ConnectionState = "open";
  private buffer: Uint8Array[] = [];
  private resolvers: Array<() => void> = [];
  private closeResolvers: Array<(info: CloseInfo) => void> = [];
  private _closePromise?: Promise<void>;
  private _iteratorActive = false;
  private _closeError?: TransportError;

  readonly closed: Promise<CloseInfo>;

  constructor(
    id: ConnectionId,
    endpoint: TransportEndpoint,
    maxMessageSize: number,
  ) {
    this.id = id;
    this.endpoint = endpoint;
    this.maxMessageSize = maxMessageSize;
    this.closed = new Promise((resolve) => {
      this.closeResolvers.push(resolve);
    });
  }

  get state(): ConnectionState {
    return this._state;
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (this._state !== "open") {
      throw new TransportError("transport_failure", "Channel is closed");
    }
    if (!this.peer) {
      throw new TransportError("transport_failure", "Channel not paired");
    }
    if (bytes.length > this.maxMessageSize) {
      throw new TransportError(
        "message_too_large",
        `Message size ${bytes.length} exceeds limit ${this.maxMessageSize}`,
      );
    }
    this.peer.buffer.push(new Uint8Array(bytes));
    const resolver = this.peer.resolvers.shift();
    resolver?.();
  }

  async close(options?: CloseOptions): Promise<void> {
    if (this._closePromise) {
      return this._closePromise;
    }
    this._closePromise = this._doClose(options);
    return this._closePromise;
  }

  private async _doClose(options?: CloseOptions): Promise<void> {
    this._state = "closing";
    this._state = "closed";
    // Wake up any waiting resolvers
    this.resolvers.forEach((r) => r());

    // Notify peer so their iterator can complete/throw
    if (this.peer && this.peer._state === "open") {
      this.peer._state = "closing";
      this.peer._state = "closed";
      // Propagate abnormal close to peer (their iterator should throw too)
      if (this._closeError) {
        this.peer._closeError = new TransportError(
          "abnormal_close",
          "Peer closed abnormally",
          this._closeError,
        );
      }
      this.peer.resolvers.forEach((r) => r());
      const peerCloseInfo: CloseInfo = {
        wasClean: !this.peer._closeError,
        code: options?.code ?? (this._closeError ? 1006 : 1000),
        reason: options?.reason,
        error: this.peer._closeError,
      };
      this.peer.closeResolvers.forEach((r) => r(peerCloseInfo));
    }

    const closeInfo: CloseInfo = {
      wasClean: !this._closeError,
      code: options?.code ?? (this._closeError ? 1006 : 1000),
      reason: options?.reason,
      error: this._closeError,
    };
    this.closeResolvers.forEach((r) => r(closeInfo));
  }

  /**
   * Close the channel with an error (simulates abnormal close).
   * Iterator will throw this error after draining buffered messages.
   */
  closeWithError(error: TransportError): Promise<void> {
    this._closeError = error;
    return this.close();
  }

  get inbound(): AsyncIterable<Uint8Array> {
    const channel = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        if (channel._iteratorActive) {
          throw new TransportError(
            "transport_failure",
            "Iterator already active",
          );
        }
        channel._iteratorActive = true;

        return {
          async next(): Promise<IteratorResult<Uint8Array, void>> {
            while (channel.buffer.length === 0 && channel._state === "open") {
              await new Promise<void>((resolve) => {
                channel.resolvers.push(resolve);
              });
            }
            if (channel.buffer.length > 0) {
              return { value: channel.buffer.shift()!, done: false };
            }
            // Buffer drained; check for abnormal close
            channel._iteratorActive = false;
            if (channel._closeError) {
              throw channel._closeError;
            }
            return { done: true, value: undefined };
          },
          async return(): Promise<IteratorResult<Uint8Array, void>> {
            channel._iteratorActive = false;
            return { done: true, value: undefined };
          },
          async throw(
            err?: unknown,
          ): Promise<IteratorResult<Uint8Array, void>> {
            channel._iteratorActive = false;
            throw err;
          },
        };
      },
    };
  }
}
