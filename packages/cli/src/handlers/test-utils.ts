// SPDX-License-Identifier: Apache-2.0

/**
 * Shared stub factory for handler unit tests.
 * Returns a minimal ConnectedPeer that records RPC handler registrations,
 * emitted events, and the disconnect callback so tests can drive lifecycle.
 */

import type { ConnectedPeer } from "@sideband/cloud";

export interface StubPeer {
  peer: ConnectedPeer;
  /** Invoke a registered RPC handler by method name. */
  callHandler(method: string, params?: unknown): unknown;
  /** All events emitted via peer.events.emit(). */
  getEmitted(): Array<{ event: string; data: unknown }>;
  /** Fire the "disconnected" callback registered via peer.on(). */
  triggerDisconnect(): void;
  /** Register an external handler (simulates pre-existing method). */
  registerHandler(method: string): void;
}

export function makeStubPeer(): StubPeer {
  const handlers = new Map<string, (params: unknown) => unknown>();
  const emitted: Array<{ event: string; data: unknown }> = [];
  let disconnectCallback: (() => void) | undefined;

  const peer = {
    state: "active" as const,
    connected: true,
    ready: true,
    peerId: "test-peer",
    rpc: {
      handle(method: string, handler: (p: unknown) => unknown) {
        handlers.set(method, handler);
        return () => {
          handlers.delete(method);
        };
      },
      call: () => Promise.resolve(),
      tryCall: () =>
        Promise.resolve({ ok: true, value: undefined, reconnected: false }),
      client: () => ({}),
      listMethods() {
        return Array.from(handlers.keys()).sort();
      },
    },
    events: {
      emit(eventName: string, data?: unknown) {
        emitted.push({ event: eventName, data });
      },
      on: () => () => {},
      onPattern: () => () => {},
    },
    disconnect: () => Promise.resolve(),
    whenReady: () => Promise.resolve(),
    on(event: string, handler: () => void) {
      if (event === "disconnected") disconnectCallback = handler;
      return () => {};
    },
    [Symbol.dispose]: () => {},
    [Symbol.asyncDispose]: () => Promise.resolve(),
  } as unknown as ConnectedPeer;

  return {
    peer,
    callHandler(method, params?) {
      const h = handlers.get(method);
      if (!h) throw new Error(`No handler registered: ${method}`);
      return h(params);
    },
    getEmitted() {
      return emitted;
    },
    triggerDisconnect() {
      disconnectCallback?.();
    },
    registerHandler(method) {
      handlers.set(method, () => null);
    },
  };
}
