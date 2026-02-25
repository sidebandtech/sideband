// SPDX-License-Identifier: Apache-2.0

import type { Negotiator } from "@sideband/runtime";
import { LoopbackTransport } from "@sideband/transport";
import { describe, expect, it } from "bun:test";
import { PeerError, PeerErrorCode } from "./errors.js";
import { listen } from "./listen.js";
import { createPeer } from "./peer.js";
import { waitFor } from "./peer.test-helpers.js";
import type { AcceptedPeer, Peer, PeerServer, PeerState } from "./types.js";

// ─── Test harness ─────────────────────────────────────────────────────────────

let testCounter = 0;

interface TestPair {
  client: Peer;
  server: PeerServer;
}

interface PairHooks {
  onServerUnhandledError?: (error: Error) => void;
  onClientUnhandledError?: (error: Error) => void;
}

/** Stand up a loopback listen + createPeer pair. Both start disconnected. */
async function createPair(
  serverSetup?: (peer: AcceptedPeer) => void,
  hooks: PairHooks = {},
): Promise<TestPair> {
  const transport = new LoopbackTransport();
  const endpoint = `loopback://peer-test-${++testCounter}`;

  const server = await listen({
    endpoint,
    transport,
    onConnection(peer) {
      serverSetup?.(peer);
    },
    onUnhandledError(err) {
      hooks.onServerUnhandledError?.(err);
    },
  });

  const client = createPeer({
    endpoint,
    transport,
    // Never retry — tests drive lifecycle explicitly.
    retryPolicy: { mode: "never" },
    onUnhandledError(err) {
      hooks.onClientUnhandledError?.(err);
    },
  });

  return { client, server };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("createPeer lifecycle", () => {
  it("starts idle and transitions through states to active on connect()", async () => {
    const { client, server } = await createPair();
    const states: string[] = [client.state];
    client.on("stateChange", ({ state }) => states.push(state));

    try {
      await client.connect();
      expect(client.state).toBe("active");
      expect(client.connected).toBe(true);
      expect(client.ready).toBe(true);
      // connecting → negotiating → active
      expect(states).toEqual(["idle", "connecting", "negotiating", "active"]);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("connect() is idempotent while connecting — returns same Promise", async () => {
    const { client, server } = await createPair();
    try {
      const p1 = client.connect();
      const p2 = client.connect();
      expect(p1).toBe(p2);
      await p1;
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("connect() throws synchronously from active state", async () => {
    const { client, server } = await createPair();
    try {
      await client.connect();
      expect(() => client.connect()).toThrow(PeerError);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("connect() throws synchronously from closed state", async () => {
    const { client, server } = await createPair();
    try {
      await client.connect();
      await client.disconnect();
      expect(() => client.connect()).toThrow(PeerError);
    } finally {
      await server.close();
    }
  });

  it("disconnect() transitions to closed and emits disconnected", async () => {
    const { client, server } = await createPair();
    await client.connect();

    let disconnectedFired = false;
    client.on("disconnected", () => {
      disconnectedFired = true;
    });

    await client.disconnect();
    expect(client.state).toBe("closed");
    expect(client.connected).toBe(false);
    expect(client.ready).toBe(false);
    expect(disconnectedFired).toBe(true);

    await server.close();
  });

  it("disconnect() is idempotent — no-op from closed", async () => {
    const { client, server } = await createPair();
    await client.connect();
    await client.disconnect();
    await client.disconnect(); // should not throw
    await server.close();
  });

  it("closed state is terminal — async mgr events cannot override it", async () => {
    const states: string[] = [];
    const { client, server } = await createPair();
    client.on("stateChange", ({ state }) => states.push(state));

    // Disconnect before awaiting connect so mgr events may still be in-flight
    const connectP = client.connect();
    await client.disconnect();

    await expect(connectP).rejects.toMatchObject({
      code: PeerErrorCode.PeerClosed,
    });

    // Allow async events from the session manager to settle
    await new Promise<void>((r) => setTimeout(r, 50));

    // "closed" must be the last state — in-flight mgr events must not override it
    expect(states[states.length - 1]).toBe("closed");
    expect(client.state).toBe("closed");

    await server.close();
  });

  it("emits connected on first active", async () => {
    const { client, server } = await createPair();
    let connectedFired = false;
    client.on("connected", () => {
      connectedFired = true;
    });
    try {
      await client.connect();
      expect(connectedFired).toBe(true);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("async lifecycle handler rejections are forwarded to onUnhandledError", async () => {
    const unhandled: Error[] = [];
    const { client, server } = await createPair(undefined, {
      onClientUnhandledError: (err) => unhandled.push(err),
    });
    // Async "connected" handler that rejects — the synchronous try/catch in
    // emit() would miss this; thenable detection must route it to unhandledError.
    client.on("connected", async () => {
      throw new Error("async connected handler boom");
    });
    try {
      await client.connect();
      await waitFor(() => unhandled.length > 0);
      expect(unhandled[0]?.message).toContain("async connected handler boom");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("AcceptedPeer starts active after onConnection", async () => {
    let acceptedState: string | undefined;
    let acceptedPeer: AcceptedPeer | undefined;

    const { client, server } = await createPair((peer) => {
      acceptedState = peer.state;
      acceptedPeer = peer;
    });

    try {
      await client.connect();
      await waitFor(() => acceptedPeer !== undefined);
      expect(acceptedState).toBe("active");
      expect(acceptedPeer!.state).toBe("active");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("server.connections tracks accepted peers by peerId", async () => {
    const { client, server } = await createPair();
    try {
      await client.connect();
      await waitFor(() => server.connections.size === 1);
      expect(server.connections.size).toBe(1);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("server.close() disconnects accepted peers", async () => {
    const { client, server } = await createPair();
    await client.connect();
    await waitFor(() => server.connections.size === 1);
    await server.close();
    // Client detects the transport drop and closes.
    await waitFor(() => client.state === "closed");
    expect(client.state).toBe("closed");
  });

  it("connect() rejects and emits error when initial connect fails with no retries", async () => {
    const client = createPeer({
      endpoint: `loopback://missing-server-${++testCounter}`,
      transport: new LoopbackTransport(),
      retryPolicy: { mode: "never" },
    });

    const errors: Error[] = [];
    client.on("error", (error) => errors.push(error));

    await expect(client.connect()).rejects.toBeInstanceOf(Error);
    await waitFor(() => errors.length > 0);

    expect(client.state).toBe("closed");
    expect(errors).toHaveLength(1);
  });

  it("connect() throws synchronously from reconnecting state", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://reconnecting-connect-${++testCounter}`;

    const server = await listen({
      endpoint,
      transport,
      onConnection() {},
    });

    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: {
        mode: "on-error",
        initialDelayMs: 10,
        maxDelayMs: 20,
        maxAttempts: 2,
        jitter: 0,
      },
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      await server.close();
      await waitFor(() => client.state === "reconnecting");
      expect(() => client.connect()).toThrow(PeerError);
    } finally {
      await client.disconnect();
    }
  });

  it("listen() cleans up accepted peer when onConnection throws", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://on-connection-throw-${++testCounter}`;
    const serverErrors: Error[] = [];

    const server = await listen({
      endpoint,
      transport,
      async onConnection() {
        throw new Error("connection setup failed");
      },
      onUnhandledError(err) {
        serverErrors.push(err);
      },
    });

    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
    });

    try {
      await client.connect();
      await waitFor(() => client.state === "closed");
      await waitFor(() => serverErrors.length > 0);
      expect(server.connections.size).toBe(0);
      expect(serverErrors[0]?.message).toContain("connection setup failed");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });
});

// ─── whenReady() ──────────────────────────────────────────────────────────────

describe("whenReady()", () => {
  it("resolves immediately when already active", async () => {
    const { client, server } = await createPair();
    try {
      await client.connect();
      await expect(client.whenReady()).resolves.toBeUndefined();
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("resolves once connected from idle/connecting", async () => {
    const { client, server } = await createPair();
    try {
      const readyP = client.whenReady();
      client.connect().catch(() => {});
      await expect(readyP).resolves.toBeUndefined();
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("rejects immediately when peer is already closed", async () => {
    const { client, server } = await createPair();
    try {
      await client.connect();
      await client.disconnect();
      await expect(client.whenReady()).rejects.toMatchObject({
        code: PeerErrorCode.PeerClosed,
      });
    } finally {
      await server.close();
    }
  });

  it("rejects via AbortSignal", async () => {
    const { client, server } = await createPair();
    try {
      client.connect().catch(() => {});
      const ctrl = new AbortController();
      const readyP = client.whenReady({ signal: ctrl.signal });
      ctrl.abort();
      await expect(readyP).rejects.toMatchObject({
        code: PeerErrorCode.Cancelled,
      });
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("rejects immediately when signal is already aborted", async () => {
    const { client, server } = await createPair();
    try {
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(
        client.whenReady({ signal: ctrl.signal }),
      ).rejects.toMatchObject({
        code: PeerErrorCode.Cancelled,
      });
    } finally {
      await client.disconnect();
      await server.close();
    }
  });
});

// ─── RPC ──────────────────────────────────────────────────────────────────────

describe("RPC round-trip", () => {
  it("call() sends request and receives response", async () => {
    const { client, server } = await createPair((peer) => {
      peer.rpc.handle<{ msg: string }, string>("echo", (p) => p.msg);
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const result = await client.rpc.call<string>("echo", { msg: "hello" });
      expect(result).toBe("hello");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("call() with no params (void RPC)", async () => {
    const { client, server } = await createPair((peer) => {
      peer.rpc.handle("ping", () => "pong");
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const result = await client.rpc.call<string>("ping");
      expect(result).toBe("pong");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("typed client proxy — call with params", async () => {
    interface Api {
      "math.add": (params: { a: number; b: number }) => number;
    }
    const { client, server } = await createPair((peer) => {
      peer.rpc.handle<{ a: number; b: number }, number>(
        "math.add",
        ({ a, b }) => a + b,
      );
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const api = client.rpc.client<Api>();
      const result = await api["math.add"]({ a: 3, b: 4 });
      expect(result).toBe(7);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("typed client proxy — void-params call omits params arg", async () => {
    interface Api {
      ping: (params: void) => string;
    }
    const received: unknown[] = [];
    const { client, server } = await createPair((peer) => {
      peer.rpc.handle("ping", (p) => {
        received.push(p);
        return "pong";
      });
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const api = client.rpc.client<Api>();
      // Call without params — must compile and send undefined (not options object)
      const result = await api["ping"]();
      expect(result).toBe("pong");
      expect(received[0]).toBeUndefined();
      // Call with options via second arg — params must still be undefined
      const result2 = await api["ping"](undefined, { timeoutMs: 5000 });
      expect(result2).toBe("pong");
      expect(received[1]).toBeUndefined();
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("typed client proxy — returns same reference on every call", async () => {
    const { client, server } = await createPair();
    try {
      expect(client.rpc.client()).toBe(client.rpc.client());
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("handle() throws synchronously when method is already registered", async () => {
    const { client, server } = await createPair((peer) => {
      peer.rpc.handle("dup", () => {});
      expect(() => peer.rpc.handle("dup", () => {})).toThrow(PeerError);
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("handle() unsubscribe removes handler and allows re-registration", async () => {
    const { client, server } = await createPair((peer) => {
      const unsub = peer.rpc.handle("greet", () => "v1");
      unsub();
      peer.rpc.handle("greet", () => "v2");
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const result = await client.rpc.call<string>("greet");
      expect(result).toBe("v2");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("call() rejects when method not registered on server", async () => {
    const { client, server } = await createPair();

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      await expect(
        client.rpc.call("nonexistent", {}, { timeoutMs: 500 }),
      ).rejects.toMatchObject({ code: PeerErrorCode.RpcError });
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("call() rejects with rpc_error when handler throws", async () => {
    const { client, server } = await createPair((peer) => {
      peer.rpc.handle("fail", () => {
        throw new Error("handler blew up");
      });
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const err = await client.rpc
        .call("fail", {}, { timeoutMs: 500 })
        .catch((e) => e);
      expect(err).toBeInstanceOf(PeerError);
      expect((err as PeerError).code).toBe(PeerErrorCode.RpcError);
      expect((err as PeerError).message).toContain("handler blew up");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("call() rejects with rpc_timeout on slow handler", async () => {
    const { client, server } = await createPair((peer) => {
      peer.rpc.handle("slow", () => new Promise(() => {})); // never resolves
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const err = await client.rpc
        .call("slow", {}, { timeoutMs: 50 })
        .catch((e) => e);
      expect(err).toBeInstanceOf(PeerError);
      expect((err as PeerError).code).toBe(PeerErrorCode.RpcTimeout);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("call() rejects with rpc_cancelled when AbortSignal is aborted before send", async () => {
    const { client, server } = await createPair();

    try {
      await client.connect();
      const ctrl = new AbortController();
      ctrl.abort();
      const err = await client.rpc
        .call("anything", {}, { signal: ctrl.signal })
        .catch((e) => e);
      expect(err).toBeInstanceOf(PeerError);
      expect((err as PeerError).code).toBe(PeerErrorCode.RpcCancelled);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("call() rejects with rpc_cancelled when AbortSignal fires mid-flight", async () => {
    const { client, server } = await createPair((peer) => {
      peer.rpc.handle("slow", () => new Promise(() => {})); // never resolves
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const ctrl = new AbortController();
      const callP = client.rpc.call("slow", {}, { signal: ctrl.signal });
      // Abort after a short delay (request is in flight)
      setTimeout(() => ctrl.abort(), 20);
      const err = await callP.catch((e) => e);
      expect(err).toBeInstanceOf(PeerError);
      expect((err as PeerError).code).toBe(PeerErrorCode.RpcCancelled);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("tryCall() returns { ok: false } instead of throwing on error", async () => {
    const { client, server } = await createPair((peer) => {
      peer.rpc.handle("fail", () => {
        throw new Error("oops");
      });
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const result = await client.rpc.tryCall("fail", {}, { timeoutMs: 500 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(PeerError);
        expect(result.reconnected).toBe(false);
      }
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("tryCall() returns { ok: true } on success with reconnected: false", async () => {
    const { client, server } = await createPair((peer) => {
      peer.rpc.handle("greet", () => "hi");
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const result = await client.rpc.tryCall<string>("greet");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("hi");
        expect(result.reconnected).toBe(false);
      }
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("tryCall() reports reconnected: true when call was buffered before connect", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://try-reconnected-${++testCounter}`;

    const server = await listen({
      endpoint,
      transport,
      onConnection(peer) {
        peer.rpc.handle("ping", () => "pong");
      },
    });

    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
      connectionPolicy: { onDisconnect: "pause" },
    });

    // Call before connecting — buffered while not ready
    const resultP = client.rpc.tryCall<string>("ping");
    await client.connect();
    const result = await resultP;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("pong");
      expect(result.reconnected).toBe(true);
    }

    await client.disconnect();
    await server.close();
  });

  it("bidirectional RPC — server calls client", async () => {
    const { client, server } = await createPair((peer) => {
      peer.rpc.handle("server.hello", () => "from server");
    });

    client.rpc.handle("client.hello", () => "from client");

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);

      // Client → server
      expect(await client.rpc.call<string>("server.hello")).toBe("from server");

      // Server → client via accepted peer
      const accepted = server.connections.values().next().value!;
      expect(await accepted.rpc.call<string>("client.hello")).toBe(
        "from client",
      );
    } finally {
      await client.disconnect();
      await server.close();
    }
  });
});

// ─── Events ───────────────────────────────────────────────────────────────────

describe("Events", () => {
  it("emit() sends to remote on() subscription", async () => {
    const received: unknown[] = [];

    const { client, server } = await createPair((peer) => {
      peer.events.on("user.created", (data) => received.push(data));
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      client.events.emit("user.created", { id: "42" });
      await waitFor(() => received.length > 0);
      expect(received).toEqual([{ id: "42" }]);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("onPattern() receives matching events with NATS wildcards", async () => {
    const received: Array<{ name: string; data: unknown }> = [];

    const { client, server } = await createPair((peer) => {
      peer.events.onPattern("user.*", (name, data) =>
        received.push({ name, data }),
      );
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      client.events.emit("user.created", { id: "1" });
      client.events.emit("user.deleted", { id: "2" });
      client.events.emit("order.created", { id: "3" }); // should NOT match
      await waitFor(() => received.length >= 2);
      expect(received.map((r) => r.name)).toEqual([
        "user.created",
        "user.deleted",
      ]);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("onPattern() with > matches one or more trailing segments", async () => {
    const received: string[] = [];

    const { client, server } = await createPair((peer) => {
      peer.events.onPattern("order.>", (name) => received.push(name));
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      client.events.emit("order.placed");
      client.events.emit("order.item.added");
      client.events.emit("user.created"); // no match
      await waitFor(() => received.length >= 2);
      expect(received).toEqual(["order.placed", "order.item.added"]);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("onPattern() throws synchronously for invalid pattern", async () => {
    const { client, server } = await createPair((peer) => {
      expect(() => peer.events.onPattern("user.**", () => {})).toThrow(
        PeerError,
      );
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("Unsubscribe() removes exact subscription", async () => {
    const received: unknown[] = [];

    const { client, server } = await createPair((peer) => {
      const unsub = peer.events.on("tick", (data) => received.push(data));
      unsub(); // unsubscribe immediately
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      client.events.emit("tick", 1);
      // Give the event a moment to potentially arrive (it shouldn't)
      await new Promise<void>((r) => setTimeout(r, 20));
      expect(received).toHaveLength(0);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("onPattern() unsubscribe removes pattern subscription", async () => {
    const received: string[] = [];

    const { client, server } = await createPair((peer) => {
      const unsub = peer.events.onPattern("user.*", (name) =>
        received.push(name),
      );
      unsub();
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      client.events.emit("user.created", {});
      await new Promise<void>((r) => setTimeout(r, 20));
      expect(received).toHaveLength(0);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("unsubscribing during dispatch does not skip subsequent handlers", async () => {
    const received: string[] = [];

    const { client, server } = await createPair((peer) => {
      // handler A unsubscribes itself during dispatch
      const unsubA = peer.events.on("tick", () => {
        received.push("A");
        unsubA();
      });
      // handler B must still fire even though A spliced the array
      peer.events.on("tick", () => received.push("B"));
    });

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      client.events.emit("tick");
      await waitFor(() => received.length >= 2);
      expect(received).toEqual(["A", "B"]);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("emit() throws synchronously for invalid event name", () => {
    const transport = new LoopbackTransport();
    const client = createPeer({
      endpoint: "loopback://unused",
      transport,
      retryPolicy: { mode: "never" },
    });
    expect(() => client.events.emit("user.*")).toThrow(PeerError);
    expect(() => client.events.emit("user..x")).toThrow(PeerError);
    expect(() => client.events.emit("user.created")).not.toThrow(); // valid (buffered)
    client.disconnect().catch(() => {});
  });

  it("on() throws synchronously for invalid event name (use onPattern() instead)", () => {
    const transport = new LoopbackTransport();
    const client = createPeer({
      endpoint: "loopback://unused",
      transport,
      retryPolicy: { mode: "never" },
    });
    expect(() => client.events.on("user.*", () => {})).toThrow(PeerError);
    expect(() => client.events.on("user.created", () => {})).not.toThrow();
    client.disconnect().catch(() => {});
  });

  it("maxBufferedEvents: 0 disables offline buffering", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://evbuf-${++testCounter}`;
    const received: unknown[] = [];

    const server = await listen({
      endpoint,
      transport,
      onConnection(peer) {
        peer.events.on("tick", (d) => received.push(d));
      },
    });

    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
      eventPolicy: { maxBufferedEvents: 0 },
    });

    // Emit before connecting — should be dropped (buffer disabled)
    client.events.emit("tick", "before-connect");

    await client.connect();
    await waitFor(() => server.connections.size > 0);

    // Emit after connecting — should be delivered
    client.events.emit("tick", "after-connect");
    await waitFor(() => received.length > 0);

    expect(received).toEqual(["after-connect"]);

    await client.disconnect();
    await server.close();
  });

  it("offline event buffer evicts oldest and flushes in order", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://evbuf-order-${++testCounter}`;
    const received: string[] = [];

    const server = await listen({
      endpoint,
      transport,
      onConnection(peer) {
        peer.events.on("tick", (d) => received.push(String(d)));
      },
    });

    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
      eventPolicy: { maxBufferedEvents: 2 },
    });

    client.events.emit("tick", "a");
    client.events.emit("tick", "b");
    client.events.emit("tick", "c");

    await client.connect();
    await waitFor(() => received.length === 2);

    expect(received).toEqual(["b", "c"]);

    await client.disconnect();
    await server.close();
  });

  it("handler errors do not abort dispatch to other subscribers", async () => {
    const received: number[] = [];
    const unhandled: Error[] = [];

    // First handler throws; second handler should still receive the event.
    const { client, server } = await createPair(
      (peer) => {
        peer.events.on("tick", () => {
          throw new Error("bad handler");
        });
        peer.events.on("tick", (data) => received.push(data as number));
      },
      {
        onServerUnhandledError(err) {
          unhandled.push(err);
        },
      },
    );

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      client.events.emit("tick", 99);
      await waitFor(() => received.length > 0 && unhandled.length > 0);
      expect(received).toEqual([99]);
      expect(unhandled).toHaveLength(1);
      expect(unhandled[0]?.message).toContain("bad handler");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("async event handler rejections are forwarded to onUnhandledError", async () => {
    const unhandled: Error[] = [];

    const { client, server } = await createPair(
      (peer) => {
        peer.events.on("tick", async () => {
          throw new Error("async handler boom");
        });
      },
      {
        onServerUnhandledError(err) {
          unhandled.push(err);
        },
      },
    );

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      client.events.emit("tick", null);
      await waitFor(() => unhandled.length > 0);
      expect(unhandled[0]?.message).toContain("async handler boom");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("server can emit to client", async () => {
    const received: unknown[] = [];

    const { client, server } = await createPair();
    client.events.on("notification", (data) => received.push(data));

    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);

      const accepted = server.connections.values().next().value!;
      accepted.events.emit("notification", { msg: "hello from server" });
      await waitFor(() => received.length > 0);
      expect(received).toEqual([{ msg: "hello from server" }]);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });
});

// ─── Reconnect cycle ──────────────────────────────────────────────────────────

describe("reconnect cycle", () => {
  it("reconnects after server drop, flushes buffer, resolves reconnecting promise", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://reconnect-${++testCounter}`;

    // First server — will be closed to simulate a drop
    const server1 = await listen({
      endpoint,
      transport,
      onConnection(peer) {
        peer.rpc.handle("ping", () => "pong");
      },
    });

    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: {
        mode: "on-error",
        initialDelayMs: 10,
        maxDelayMs: 50,
        maxAttempts: 5,
        jitter: 0,
      },
      connectionPolicy: { onDisconnect: "pause" },
    });

    await client.connect();
    await waitFor(() => server1.connections.size > 0);
    expect(await client.rpc.call<string>("ping")).toBe("pong");

    // Drop the first server — client detects disconnect and starts reconnecting
    await server1.close();
    await waitFor(() => client.state === "reconnecting");

    const reconnectPromise = client.reconnecting!;
    expect(reconnectPromise).toBeDefined();

    // Queue a call while disconnected (onDisconnect: "pause"). In-flight calls
    // are already rejected on disconnect; only calls queued in "reconnecting"
    // state survive to flush when the peer becomes active again.
    const bufferedCall = client.rpc.call<string>("ping");

    // Bring up a second server on the same endpoint
    const server2 = await listen({
      endpoint,
      transport,
      onConnection(peer) {
        peer.rpc.handle("ping", () => "pong");
      },
    });

    await waitFor(() => client.state === "active", { timeoutMs: 2000 });

    // reconnecting promise resolves with { status: "connected" }
    await expect(reconnectPromise).resolves.toMatchObject({
      status: "connected",
    });

    // Buffered call flushed and completed after reconnect
    await expect(bufferedCall).resolves.toBe("pong");

    expect(await client.rpc.call<string>("ping")).toBe("pong");

    await client.disconnect();
    await server2.close();
  });

  it("reconnecting promise resolves { status: 'failed' } when retries exhausted", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://reconnect-fail-${++testCounter}`;

    const server = await listen({ endpoint, transport, onConnection() {} });

    const client = createPeer({
      endpoint,
      transport,
      // Allow exactly 1 retry (retryAttempt starts at 0; maxAttempts: 1 → fails after 1 retry)
      retryPolicy: {
        mode: "on-error",
        initialDelayMs: 10,
        maxDelayMs: 50,
        maxAttempts: 1,
        jitter: 0,
      },
    });

    await client.connect();
    await waitFor(() => server.connections.size > 0);

    // Close the server permanently — client retries once then gives up
    await server.close();

    await waitFor(() => client.state === "reconnecting");
    const reconnectPromise = client.reconnecting!;

    // Wait for client to exhaust retries and close
    await waitFor(() => client.state === "closed", { timeoutMs: 2000 });

    await expect(reconnectPromise).resolves.toMatchObject({ status: "failed" });
    expect(client.state).toBe("closed");
  });

  it("reconnecting promise resolves { status: 'aborted' } on disconnect()", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://reconnect-abort-${++testCounter}`;

    const server = await listen({ endpoint, transport, onConnection() {} });

    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: {
        mode: "on-error",
        initialDelayMs: 500,
        maxDelayMs: 1000,
        maxAttempts: 5,
        jitter: 0,
      },
    });

    await client.connect();
    await waitFor(() => server.connections.size > 0);

    await server.close();
    await waitFor(() => client.state === "reconnecting");

    const reconnectPromise = client.reconnecting!;
    expect(reconnectPromise).toBeDefined();

    await client.disconnect();

    await expect(reconnectPromise).resolves.toMatchObject({
      status: "aborted",
    });
    expect(client.state).toBe("closed");
  });

  it("event subscriptions persist across reconnect", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://event-survive-${++testCounter}`;
    const received: unknown[] = [];

    const server1 = await listen({
      endpoint,
      transport,
      onConnection() {},
    });

    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: {
        mode: "on-error",
        initialDelayMs: 10,
        maxDelayMs: 50,
        maxAttempts: 5,
        jitter: 0,
      },
    });

    client.events.on("notify", (data) => received.push(data));

    await client.connect();
    await waitFor(() => server1.connections.size > 0);

    const accepted1 = server1.connections.values().next().value!;
    accepted1.events.emit("notify", "before-reconnect");
    await waitFor(() => received.length > 0);
    expect(received).toEqual(["before-reconnect"]);

    // Drop server — client enters reconnecting
    await server1.close();
    await waitFor(() => client.state === "reconnecting");

    // Bring up replacement server on same endpoint
    const server2 = await listen({
      endpoint,
      transport,
      onConnection() {},
    });

    await waitFor(() => client.state === "active", { timeoutMs: 2000 });
    await waitFor(() => server2.connections.size > 0);

    // Same subscription should still receive events after reconnect
    const accepted2 = server2.connections.values().next().value!;
    accepted2.events.emit("notify", "after-reconnect");
    await waitFor(() => received.length >= 2);

    expect(received).toEqual(["before-reconnect", "after-reconnect"]);

    await client.disconnect();
    await server2.close();
  });
});

// ─── Buffer on disconnect (onDisconnect: "pause") ────────────────────────────

describe("onDisconnect: 'pause' buffer", () => {
  it("default onDisconnect='fail' rejects call() while not connected", async () => {
    const { client, server } = await createPair((peer) => {
      peer.rpc.handle("ping", () => "pong");
    });

    await expect(
      client.rpc.call("ping", {}, { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: PeerErrorCode.NotConnected });

    await server.close();
  });

  it("buffers call() while disconnected and flushes on first connect", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://pause-idle-${++testCounter}`;

    const server = await listen({
      endpoint,
      transport,
      onConnection(peer) {
        peer.rpc.handle("ping", () => "pong");
      },
    });

    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
      connectionPolicy: { onDisconnect: "pause" },
    });

    const callP = client.rpc.call<string>("ping");
    await client.connect();
    await expect(callP).resolves.toBe("pong");

    await client.disconnect();
    await server.close();
  });

  it("buffer overflow rejects with buffer_overflow (pause policy)", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://buf-${++testCounter}`;

    const server = await listen({
      endpoint,
      transport,
      onConnection() {},
    });

    // Create peer with pause policy and tiny buffer
    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
      connectionPolicy: { onDisconnect: "pause" },
      rpcPolicy: { disconnectBufferLimitBytes: 1 }, // too small to fit anything
    });

    // Don't connect — peer stays idle; buffer limit should reject
    await expect(
      client.rpc.call("anything", { big: "payload" }, { timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: PeerErrorCode.BufferOverflow });

    await client.disconnect();
    await server.close();
  });

  it("queued call aborts immediately when AbortSignal fires while buffered", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://abort-queue-${++testCounter}`;

    const server = await listen({
      endpoint,
      transport,
      onConnection() {},
    });

    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
      connectionPolicy: { onDisconnect: "pause" },
    });

    const ctrl = new AbortController();
    const callP = client.rpc.call("anything", {}, { signal: ctrl.signal });

    // Abort while still queued (peer hasn't connected)
    ctrl.abort();

    await expect(callP).rejects.toMatchObject({
      code: PeerErrorCode.RpcCancelled,
    });

    await client.disconnect();
    await server.close();
  });

  it("queued call rejects with peer_closed when peer disconnects before connect", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://close-queue-${++testCounter}`;

    const server = await listen({
      endpoint,
      transport,
      onConnection() {},
    });

    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
      connectionPolicy: { onDisconnect: "pause" },
    });

    const callP = client.rpc.call("anything", {});
    await client.disconnect();
    await expect(callP).rejects.toMatchObject({
      code: PeerErrorCode.PeerClosed,
    });

    await server.close();
  });
});

// ─── AcceptedPeer ─────────────────────────────────────────────────────────────

describe("AcceptedPeer", () => {
  it("disconnect() closes accepted peer", async () => {
    const { client, server } = await createPair();
    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const accepted = server.connections.values().next().value!;
      await accepted.disconnect();
      expect(accepted.state).toBe("closed");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("whenReady() resolves immediately when accepted peer is active", async () => {
    const { client, server } = await createPair();
    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const accepted = server.connections.values().next().value!;
      await expect(accepted.whenReady()).resolves.toBeUndefined();
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("whenReady() rejects when accepted peer is closed", async () => {
    const { client, server } = await createPair();
    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const accepted = server.connections.values().next().value!;
      await accepted.disconnect();
      await expect(accepted.whenReady()).rejects.toMatchObject({
        code: PeerErrorCode.PeerClosed,
      });
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("whenReady() rejects immediately when signal is already aborted", async () => {
    const { client, server } = await createPair();
    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const accepted = server.connections.values().next().value!;
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(
        accepted.whenReady({ signal: ctrl.signal }),
      ).rejects.toMatchObject({
        code: PeerErrorCode.Cancelled,
      });
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("peerId is accessible and matches server.connections key", async () => {
    let acceptedPeer: AcceptedPeer | undefined;
    const { client, server } = await createPair((peer) => {
      acceptedPeer = peer;
    });
    try {
      await client.connect();
      await waitFor(() => acceptedPeer !== undefined);
      expect(typeof acceptedPeer!.peerId).toBe("string");
      expect(acceptedPeer!.peerId.length).toBeGreaterThan(0);
      expect(server.connections.has(acceptedPeer!.peerId)).toBe(true);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("Symbol.dispose() calls disconnect()", async () => {
    const { client, server } = await createPair();
    try {
      await client.connect();
      await waitFor(() => server.connections.size > 0);
      const accepted = server.connections.values().next().value!;
      accepted[Symbol.dispose]();
      await waitFor(() => accepted.state === "closed");
      expect(accepted.state).toBe("closed");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("duplicate peerId is rejected — second connection is closed, map stays consistent", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://dup-peer-${++testCounter}`;
    const unhandled: Error[] = [];

    const server = await listen({
      endpoint,
      transport,
      onConnection() {},
      onUnhandledError(err) {
        unhandled.push(err);
      },
    });

    const sharedPeerId = "fixed-peer-id-dup-test";
    const makeClient = () =>
      createPeer({
        endpoint,
        transport,
        peerId: sharedPeerId,
        retryPolicy: { mode: "never" },
      });

    const client1 = makeClient();
    await client1.connect();
    await waitFor(() => server.connections.size === 1);

    // Second client with same peerId — server closes the new connection
    const client2 = makeClient();
    try {
      await client2.connect();
    } catch {
      /* may be dropped before "active" */
    }

    await waitFor(() => unhandled.length > 0, { timeoutMs: 1000 });
    expect(unhandled[0]?.message).toContain("Duplicate");

    // Map must still contain exactly client1
    expect(server.connections.size).toBe(1);
    expect(server.connections.get(sharedPeerId)?.state).toBe("active");
    expect(client1.state).toBe("active");

    await client1.disconnect();
    await client2.disconnect().catch(() => {});
    await server.close();
  });
});

// ─── Fatal negotiation error ──────────────────────────────────────────────────

describe("fatal negotiation error", () => {
  it("goes to closed, not reconnecting", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://fatal-neg-${++testCounter}`;

    const server = await listen({
      endpoint,
      transport,
      onConnection() {},
    });

    const fatalNegotiator: Negotiator = {
      negotiate: async () => {
        throw new Error("crypto failure");
      },
      classifyError: () => "fatal",
      terminate: async () => {},
    };

    const client = createPeer({
      endpoint,
      transport,
      negotiator: fatalNegotiator,
      retryPolicy: {
        mode: "on-error",
        maxAttempts: 5,
        initialDelayMs: 10,
        maxDelayMs: 50,
        jitter: 0,
      },
    });

    const states: PeerState[] = [];
    client.on("stateChange", ({ state }) => states.push(state));

    await expect(client.connect()).rejects.toThrow();
    expect(client.state).toBe("closed");
    expect(states).not.toContain("reconnecting");

    await server.close();
  });
});
