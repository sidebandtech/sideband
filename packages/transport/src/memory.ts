// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * In-memory transport for testing and local communication.
 *
 * Suitable for unit tests, local development, and cross-component communication
 * within the same process. Does not involve I/O or async operations.
 */

import { asConnectionId } from "@sideband/protocol";
import type { ConnectionId } from "@sideband/protocol";
import type {
  Transport,
  TransportConnection,
  TransportEndpoint,
  ConnectOptions,
  ListenOptions,
  ConnectionHandler,
  TransportListener,
} from "./types.js";

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
    _options?: ConnectOptions,
  ): Promise<TransportConnection> {
    const clientChannel = new MemoryChannel(
      asConnectionId(`client-${Math.random()}`),
    );

    const listener = this.endpoints.get(endpoint as string);
    if (!listener) {
      throw new Error(`No listener on ${endpoint}`);
    }

    const serverChannel = new MemoryChannel(
      asConnectionId(`server-${Math.random()}`),
    );

    // Cross-connect channels
    clientChannel.peer = serverChannel;
    serverChannel.peer = clientChannel;

    // Call listener handler with server-side connection
    listener.handler(serverChannel);

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
      endpoint,
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
  readonly endpoint: TransportEndpoint =
    "memory://" as unknown as TransportEndpoint;

  peer?: MemoryChannel;
  private closed = false;
  private buffer: Uint8Array[] = [];
  private resolvers: Array<() => void> = [];

  constructor(id: ConnectionId) {
    this.id = id;
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error("Channel is closed");
    }
    if (!this.peer) {
      throw new Error("Channel not paired");
    }
    this.peer.buffer.push(new Uint8Array(bytes));
    const resolver = this.peer.resolvers.shift();
    resolver?.();
  }

  async close(_reason?: string): Promise<void> {
    this.closed = true;
    this.resolvers.forEach((r) => r());
  }

  get inbound(): AsyncIterable<Uint8Array> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<Uint8Array, void>> => {
          while (this.buffer.length === 0 && !this.closed) {
            await new Promise<void>((resolve) => {
              this.resolvers.push(resolve);
            });
          }
          if (this.buffer.length > 0) {
            return { value: this.buffer.shift()!, done: false };
          }
          return { done: true, value: undefined };
        },
      }),
    };
  }
}
