// SPDX-License-Identifier: Apache-2.0

/**
 * Loopback transport for testing and local communication.
 *
 * Suitable for unit tests, local development, and cross-component communication
 * within the same process. Does not involve I/O or async operations.
 */

import type { ConnectionId } from "@sideband/protocol";
import { asConnectionId } from "@sideband/protocol";
import { TransportError } from "./errors.js";
import type {
  CloseInfo,
  CloseOptions,
  ConnectionHandler,
  ConnectionState,
  ConnectOptions,
  ListenOptions,
  Transport,
  TransportConnection,
  TransportEndpoint,
  TransportListener,
} from "./types.js";

/** Default maximum message size: 1 MiB */
const DEFAULT_MAX_MESSAGE_SIZE = 1024 * 1024;

/**
 * Loopback transport implementation using channels.
 * Pairs of connections are created by endpoint string.
 */
class LoopbackTransport implements Transport {
  readonly kind = "loopback";

  private endpoints = new Map<
    string,
    {
      handler: ConnectionHandler;
      channels: Array<LoopbackChannel>;
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

    const clientChannel = new LoopbackChannel(
      asConnectionId(`client-${Math.random()}`),
      endpoint,
      maxMessageSize,
    );

    const serverChannel = new LoopbackChannel(
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

export { LoopbackTransport };

/**
 * Internal loopback channel implementation.
 */
class LoopbackChannel implements TransportConnection {
  readonly id: ConnectionId;
  readonly endpoint: TransportEndpoint;
  private readonly maxMessageSize: number;

  peer?: LoopbackChannel;
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
        graceful: !this.peer._closeError,
        closeCode: options?.closeCode ?? (this._closeError ? 1006 : 1000),
        reason: options?.reason,
        error: this.peer._closeError,
      };
      this.peer.closeResolvers.forEach((r) => r(peerCloseInfo));
    }

    const closeInfo: CloseInfo = {
      graceful: !this._closeError,
      closeCode: options?.closeCode ?? (this._closeError ? 1006 : 1000),
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
    // Arrow functions throughout so `this` refers to the LoopbackChannel instance;
    // method shorthand would bind `this` to the iterable/iterator objects instead.
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<Uint8Array> => {
        if (this._iteratorActive) {
          throw new TransportError(
            "transport_failure",
            "Iterator already active",
          );
        }
        this._iteratorActive = true;

        return {
          next: async (): Promise<IteratorResult<Uint8Array, void>> => {
            while (this.buffer.length === 0 && this._state === "open") {
              await new Promise<void>((resolve) => {
                this.resolvers.push(resolve);
              });
            }
            if (this.buffer.length > 0) {
              return { value: this.buffer.shift()!, done: false };
            }
            // Buffer drained; check for abnormal close
            this._iteratorActive = false;
            if (this._closeError) {
              throw this._closeError;
            }
            return { done: true, value: undefined };
          },
          return: async (): Promise<IteratorResult<Uint8Array, void>> => {
            this._iteratorActive = false;
            return { done: true, value: undefined };
          },
          throw: async (
            err?: unknown,
          ): Promise<IteratorResult<Uint8Array, void>> => {
            this._iteratorActive = false;
            throw err;
          },
        };
      },
    };
  }
}
