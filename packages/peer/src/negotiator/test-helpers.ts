// SPDX-License-Identifier: Apache-2.0

import type { TransportConnection } from "@sideband/runtime";

/** Create a bidirectional in-memory transport pair for testing. */
export function createTransportPair(): {
  clientConn: TransportConnection;
  daemonConn: TransportConnection;
} {
  const c2dQueue: Uint8Array[] = [];
  const d2cQueue: Uint8Array[] = [];
  let c2dResolve: (() => void) | undefined;
  let d2cResolve: (() => void) | undefined;
  let clientClosed = false;
  let daemonClosed = false;

  const clientConn: TransportConnection = {
    id: "client-conn",
    endpoint: "ws://localhost:8080",
    async send(data: Uint8Array) {
      c2dQueue.push(data);
      c2dResolve?.();
    },
    async close() {
      clientClosed = true;
      c2dResolve?.();
      d2cResolve?.();
    },
    inbound: {
      async *[Symbol.asyncIterator]() {
        while (!clientClosed) {
          if (d2cQueue.length > 0) {
            yield d2cQueue.shift()!;
          } else {
            await new Promise<void>((r) => {
              d2cResolve = r;
            });
            d2cResolve = undefined;
          }
        }
        while (d2cQueue.length > 0) {
          yield d2cQueue.shift()!;
        }
      },
    },
  };

  const daemonConn: TransportConnection = {
    id: "daemon-conn",
    endpoint: "ws://localhost:8080",
    async send(data: Uint8Array) {
      d2cQueue.push(data);
      d2cResolve?.();
    },
    async close() {
      daemonClosed = true;
      c2dResolve?.();
      d2cResolve?.();
    },
    inbound: {
      async *[Symbol.asyncIterator]() {
        while (!daemonClosed) {
          if (c2dQueue.length > 0) {
            yield c2dQueue.shift()!;
          } else {
            await new Promise<void>((r) => {
              c2dResolve = r;
            });
            c2dResolve = undefined;
          }
        }
        while (c2dQueue.length > 0) {
          yield c2dQueue.shift()!;
        }
      },
    },
  };

  return { clientConn, daemonConn };
}
