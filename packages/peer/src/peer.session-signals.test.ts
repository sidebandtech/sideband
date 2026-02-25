// SPDX-License-Identifier: Apache-2.0

import type { Negotiator, SessionSignal } from "@sideband/runtime";
import { LoopbackTransport } from "@sideband/transport";
import { describe, expect, it } from "bun:test";
import { listen } from "./listen.js";
import { createPeer, sbpNegotiator } from "./peer.js";
import { waitFor } from "./peer.test-helpers.js";
import type { AcceptedPeer } from "./types.js";

// Coverage obligation: every SessionSignal type handled by handleSessionSignal
// (session_paused, session_resumed, session_ended, session_pending) MUST have
// a test here for both PeerImpl (createPeer) and AcceptedPeerImpl (listen).
// When new signal types are added to the protocol, extend this file first.
// See ADR-014 for behavioral contracts.

// ─── Test harness ─────────────────────────────────────────────────────────────

let testCounter = 0;

/**
 * Wraps a negotiator so tests can emit arbitrary session signals after
 * negotiation completes. The subscribeSignals callback registered by the caller
 * (PeerImpl or handleIncoming) is captured and exposed via `emitSignal`.
 */
function withControllableSignals(base: Negotiator): {
  negotiator: Negotiator;
  emitSignal: (signal: SessionSignal) => void;
} {
  let listener: ((s: SessionSignal) => void) | undefined;
  return {
    negotiator: {
      negotiate: async (conn) => {
        const result = await base.negotiate(conn);
        return {
          ...result,
          subscribeSignals: (h) => {
            listener = h;
            // Compose with the real subscription so any internal signal
            // wiring in the base negotiator is also exercised.
            const unsub = result.subscribeSignals?.(h);
            return () => {
              listener = undefined;
              unsub?.();
            };
          },
        };
      },
      classifyError: (e) => base.classifyError(e),
      terminate: (c, o) => base.terminate(c, o),
    },
    emitSignal: (signal) => listener?.(signal),
  };
}

// ─── Session signals — AcceptedPeer ───────────────────────────────────────────

describe("session signals — AcceptedPeer", () => {
  it("session_paused transitions to paused and emits sessionPaused", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://sig-accepted-pause-${++testCounter}`;
    const { negotiator, emitSignal } = withControllableSignals(sbpNegotiator());

    let serverPeer: AcceptedPeer | undefined;
    const server = await listen({
      endpoint,
      transport,
      negotiator,
      onConnection(peer) {
        serverPeer = peer;
      },
    });
    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
    });

    try {
      await client.connect();
      await waitFor(() => serverPeer !== undefined);

      const events: string[] = [];
      serverPeer!.on("stateChange", ({ state }) => events.push(state));
      serverPeer!.on("sessionPaused", () => events.push("sessionPaused"));

      emitSignal({ type: "session_paused" });
      await waitFor(() => serverPeer!.state === "paused");

      expect(serverPeer!.state).toBe("paused");
      expect(serverPeer!.connected).toBe(true);
      expect(serverPeer!.ready).toBe(false);
      expect(events).toEqual(["paused", "sessionPaused"]);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("session_resumed restores active state and emits sessionResumed", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://sig-accepted-resume-${++testCounter}`;
    const { negotiator, emitSignal } = withControllableSignals(sbpNegotiator());

    let serverPeer: AcceptedPeer | undefined;
    const server = await listen({
      endpoint,
      transport,
      negotiator,
      onConnection(peer) {
        serverPeer = peer;
      },
    });
    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
    });

    try {
      await client.connect();
      await waitFor(() => serverPeer !== undefined);

      const events: string[] = [];
      serverPeer!.on("stateChange", ({ state }) => events.push(state));
      serverPeer!.on("sessionPaused", () => events.push("sessionPaused"));
      serverPeer!.on("sessionResumed", () => events.push("sessionResumed"));

      emitSignal({ type: "session_paused" });
      await waitFor(() => serverPeer!.state === "paused");

      emitSignal({ type: "session_resumed" });
      await waitFor(() => serverPeer!.state === "active");

      expect(serverPeer!.state).toBe("active");
      expect(serverPeer!.ready).toBe(true);
      expect(events).toEqual([
        "paused",
        "sessionPaused",
        "active",
        "sessionResumed",
      ]);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("session_ended closes the accepted peer", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://sig-accepted-ended-${++testCounter}`;
    const { negotiator, emitSignal } = withControllableSignals(sbpNegotiator());

    let serverPeer: AcceptedPeer | undefined;
    const server = await listen({
      endpoint,
      transport,
      negotiator,
      onConnection(peer) {
        serverPeer = peer;
      },
    });
    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
    });

    try {
      await client.connect();
      await waitFor(() => serverPeer !== undefined);

      let disconnectedFired = false;
      serverPeer!.on("disconnected", () => {
        disconnectedFired = true;
      });

      emitSignal({ type: "session_ended" });
      await waitFor(() => serverPeer!.state === "closed");

      expect(serverPeer!.state).toBe("closed");
      expect(serverPeer!.connected).toBe(false);
      expect(disconnectedFired).toBe(true);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("session_pending while paused keeps paused state (no-op)", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://sig-accepted-pending-${++testCounter}`;
    const { negotiator, emitSignal } = withControllableSignals(sbpNegotiator());

    let serverPeer: AcceptedPeer | undefined;
    const server = await listen({
      endpoint,
      transport,
      negotiator,
      onConnection(peer) {
        serverPeer = peer;
      },
    });
    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
    });

    try {
      await client.connect();
      await waitFor(() => serverPeer !== undefined);

      emitSignal({ type: "session_paused" });
      await waitFor(() => serverPeer!.state === "paused");

      const events: string[] = [];
      serverPeer!.on("stateChange", ({ state }) => events.push(state));
      serverPeer!.on("sessionResumed", () => events.push("sessionResumed"));

      emitSignal({ type: "session_pending" });
      // Allow any async ticks to settle
      await new Promise((r) => setTimeout(r, 20));

      expect(serverPeer!.state).toBe("paused");
      expect(events).toEqual([]);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("duplicate session_paused signals are idempotent", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://sig-accepted-idempotent-${++testCounter}`;
    const { negotiator, emitSignal } = withControllableSignals(sbpNegotiator());

    let serverPeer: AcceptedPeer | undefined;
    const server = await listen({
      endpoint,
      transport,
      negotiator,
      onConnection(peer) {
        serverPeer = peer;
      },
    });
    const client = createPeer({
      endpoint,
      transport,
      retryPolicy: { mode: "never" },
    });

    try {
      await client.connect();
      await waitFor(() => serverPeer !== undefined);

      let pauseCount = 0;
      serverPeer!.on("sessionPaused", () => pauseCount++);

      emitSignal({ type: "session_paused" });
      emitSignal({ type: "session_paused" }); // duplicate
      await waitFor(() => serverPeer!.state === "paused");

      expect(pauseCount).toBe(1);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });
});

// ─── Session signals — client Peer ────────────────────────────────────────────

describe("session signals — client Peer", () => {
  it("session_paused transitions to paused and emits sessionPaused", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://sig-client-pause-${++testCounter}`;
    const { negotiator, emitSignal } = withControllableSignals(sbpNegotiator());

    const server = await listen({
      endpoint,
      transport,
      onConnection: () => {},
    });
    const client = createPeer({
      endpoint,
      transport,
      negotiator,
      retryPolicy: { mode: "never" },
    });

    try {
      await client.connect();

      const events: string[] = [];
      client.on("stateChange", ({ state }) => events.push(state));
      client.on("sessionPaused", () => events.push("sessionPaused"));

      emitSignal({ type: "session_paused" });
      await waitFor(() => client.state === "paused");

      expect(client.state).toBe("paused");
      expect(client.connected).toBe(true);
      expect(client.ready).toBe(false);
      expect(events).toEqual(["paused", "sessionPaused"]);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("session_resumed restores active state and emits sessionResumed (not connected)", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://sig-client-resume-${++testCounter}`;
    const { negotiator, emitSignal } = withControllableSignals(sbpNegotiator());

    const server = await listen({
      endpoint,
      transport,
      onConnection: () => {},
    });
    const client = createPeer({
      endpoint,
      transport,
      negotiator,
      retryPolicy: { mode: "never" },
    });

    try {
      await client.connect();

      const events: string[] = [];
      client.on("stateChange", ({ state }) => events.push(state));
      client.on("sessionPaused", () => events.push("sessionPaused"));
      client.on("sessionResumed", () => events.push("sessionResumed"));
      // "connected" must NOT fire on resume from pause — only on fresh connection
      client.on("connected", () => events.push("connected"));

      emitSignal({ type: "session_paused" });
      await waitFor(() => client.state === "paused");

      emitSignal({ type: "session_resumed" });
      await waitFor(() => client.state === "active");

      expect(client.state).toBe("active");
      expect(client.ready).toBe(true);
      expect(events).toEqual([
        "paused",
        "sessionPaused",
        "active",
        "sessionResumed",
      ]);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("whenReady() stays pending while paused, resolves on session_resumed", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://sig-client-whenready-paused-${++testCounter}`;
    const { negotiator, emitSignal } = withControllableSignals(sbpNegotiator());

    const server = await listen({
      endpoint,
      transport,
      onConnection: () => {},
    });
    const client = createPeer({
      endpoint,
      transport,
      negotiator,
      retryPolicy: { mode: "never" },
    });

    try {
      await client.connect();

      emitSignal({ type: "session_paused" });
      await waitFor(() => client.state === "paused");

      // whenReady() must not resolve while paused
      let resolved = false;
      const readyP = client.whenReady().then(() => {
        resolved = true;
      });
      // Yield to micro-tasks — still paused
      await Promise.resolve();
      expect(resolved).toBe(false);

      // Resume unblocks whenReady()
      emitSignal({ type: "session_resumed" });
      await readyP;
      expect(resolved).toBe(true);
      expect(client.state).toBe("active");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("tryCall() reports reconnected: true when buffered during pause", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://sig-client-trycall-paused-${++testCounter}`;
    const { negotiator, emitSignal } = withControllableSignals(sbpNegotiator());

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
      negotiator,
      retryPolicy: { mode: "never" },
      connectionPolicy: { onDisconnect: "pause" },
    });

    try {
      await client.connect();

      emitSignal({ type: "session_paused" });
      await waitFor(() => client.state === "paused");

      // Call while paused — should be buffered
      const callP = client.rpc.tryCall<string>("ping");

      // Yield to ensure it's not resolved immediately
      await new Promise((r) => setTimeout(r, 20));

      emitSignal({ type: "session_resumed" });
      const result = await callP;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("pong");
        expect(result.reconnected).toBe(true);
      }
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("session_pending while paused keeps paused state (no-op)", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://sig-client-pending-${++testCounter}`;
    const { negotiator, emitSignal } = withControllableSignals(sbpNegotiator());

    const server = await listen({
      endpoint,
      transport,
      onConnection: () => {},
    });
    const client = createPeer({
      endpoint,
      transport,
      negotiator,
      retryPolicy: { mode: "never" },
    });

    try {
      await client.connect();

      emitSignal({ type: "session_paused" });
      await waitFor(() => client.state === "paused");

      const events: string[] = [];
      client.on("stateChange", ({ state }) => events.push(state));
      client.on("sessionResumed", () => events.push("sessionResumed"));

      emitSignal({ type: "session_pending" });
      await new Promise((r) => setTimeout(r, 20));

      expect(client.state).toBe("paused");
      expect(events).toEqual([]);
    } finally {
      await client.disconnect();
      await server.close();
    }
  });

  it("session_ended triggers retry/close cycle via sessionMgr.terminate", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://sig-client-ended-${++testCounter}`;
    const { negotiator, emitSignal } = withControllableSignals(sbpNegotiator());

    const server = await listen({
      endpoint,
      transport,
      onConnection: () => {},
    });
    const client = createPeer({
      endpoint,
      transport,
      negotiator,
      // no-retry: session_ended should lead to closed after one attempt
      retryPolicy: { mode: "never" },
    });

    try {
      await client.connect();

      emitSignal({ type: "session_ended" });
      // session_ended terminates the session; with no-retry policy peer closes.
      await waitFor(() => client.state === "closed", { timeoutMs: 2000 });

      expect(client.state).toBe("closed");
    } finally {
      await client.disconnect();
      await server.close();
    }
  });
});

// ─── Signal subscription cleanup ──────────────────────────────────────────────

describe("signal subscription cleanup", () => {
  it("subscribeSignals throws → peer removed from connections and channel closed", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://signal-subscribe-throws-${++testCounter}`;

    const base = sbpNegotiator();
    const throwingNegotiator: Negotiator = {
      negotiate: async (conn) => {
        const result = await base.negotiate(conn);
        return {
          ...result,
          subscribeSignals: () => {
            throw new Error("subscribeSignals failed");
          },
        };
      },
      classifyError: (err) => base.classifyError(err),
      terminate: (conn, opts) => base.terminate(conn, opts),
    };

    const serverErrors: Error[] = [];
    const server = await listen({
      endpoint,
      transport,
      negotiator: throwingNegotiator,
      onConnection: () => {},
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
    } catch {
      // connect() may reject if transport closes before negotiation resolves
    }

    await waitFor(() => serverErrors.length > 0);
    expect(serverErrors[0]!.message).toBe("subscribeSignals failed");
    expect(server.connections.size).toBe(0);

    await client.disconnect();
    await server.close();
  });

  it("subscribeSignals is unsubscribed when onConnection throws", async () => {
    const transport = new LoopbackTransport();
    const endpoint = `loopback://signal-cleanup-${++testCounter}`;
    let unsubCallCount = 0;

    // Wraps the default SBP negotiator to inject a trackable subscribeSignals token
    const base = sbpNegotiator();
    const trackingNegotiator: Negotiator = {
      negotiate: async (conn) => {
        const result = await base.negotiate(conn);
        return {
          ...result,
          subscribeSignals: (_handler) => () => {
            unsubCallCount++;
          },
        };
      },
      classifyError: (err) => base.classifyError(err),
      terminate: (conn, opts) => base.terminate(conn, opts),
    };

    const serverErrors: Error[] = [];
    const server = await listen({
      endpoint,
      transport,
      negotiator: trackingNegotiator,
      async onConnection() {
        throw new Error("setup failed");
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
    } catch {
      // connect() rejects — expected
    }

    await waitFor(() => serverErrors.length > 0);
    await waitFor(() => unsubCallCount > 0);
    expect(unsubCallCount).toBe(1);

    await client.disconnect();
    await server.close();
  });
});
