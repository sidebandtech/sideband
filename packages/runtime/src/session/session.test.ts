// SPDX-License-Identifier: Apache-2.0

import { asPeerId } from "@sideband/protocol";
import { describe, expect, it, mock } from "bun:test";
import { SessionManager, type SessionConfig } from "./session.js";
import type {
  NegotiationResult,
  Negotiator,
  SessionEvents,
  TransportConnection,
} from "./types.js";

// Mock transport whose inbound stays open until close() is called.
// This accurately models real transport behavior: the channel stays alive
// until explicitly closed (e.g. via terminate()). Tests that need the
// channel to close early can call the returned `closeChannel` callback.
function createMockTransport(id = "test-transport"): TransportConnection & {
  closeChannel(): void;
} {
  let closeResolve: (() => void) | undefined;
  const closedPromise = new Promise<void>((resolve) => {
    closeResolve = resolve;
  });

  const transport = {
    id,
    endpoint: "ws://localhost:8080",
    send: mock(() => Promise.resolve()),
    close: mock(() => {
      closeResolve?.();
      return Promise.resolve();
    }),
    inbound: {
      async *[Symbol.asyncIterator]() {
        // Stay open until close() is called (mirrors LoopbackTransport behavior).
        await closedPromise;
      },
    },
    closeChannel() {
      closeResolve?.();
    },
  };
  return transport;
}

// Mock negotiator
function createMockNegotiator(
  result: NegotiationResult = {
    peerId: asPeerId("test-peer"),
    capabilities: ["sbp/1"],
    metadata: {},
  },
  errorClassification: "retryable" | "fatal" = "retryable",
): Negotiator {
  return {
    negotiate: mock(() => Promise.resolve(result)),
    terminate: mock(() => Promise.resolve()),
    classifyError: mock(() => errorClassification),
  };
}

// Helper to create session config
function createConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  const transport = createMockTransport();
  return {
    endpoint: "ws://localhost:8080",
    transportFactory: mock(() => Promise.resolve(transport)),
    negotiator: createMockNegotiator(),
    ...overrides,
  };
}

describe("SessionManager", () => {
  describe("state transitions", () => {
    it("starts in idle state", () => {
      const manager = new SessionManager(createConfig());
      expect(manager.state).toBe("idle");
    });

    it("transitions idle -> connecting -> negotiating -> active on successful connect", async () => {
      const states: string[] = [];
      const config = createConfig();
      const manager = new SessionManager(config);

      manager.on("connecting", () => states.push("connecting"));
      manager.on("negotiating", () => states.push("negotiating"));
      manager.on("active", () => states.push("active"));

      await manager.connect();

      expect(states).toEqual(["connecting", "negotiating", "active"]);
      expect(manager.state).toBe("active");
    });

    it("throws when connecting from non-idle state", async () => {
      const config = createConfig();
      const manager = new SessionManager(config);

      await manager.connect();

      await expect(manager.connect()).rejects.toThrow(
        "Cannot connect from state: active",
      );
    });
  });

  describe("successful negotiation", () => {
    it("returns session with peerId from negotiation result", async () => {
      const expectedPeerId = asPeerId("expected-peer-id");
      const negotiator = createMockNegotiator({
        peerId: expectedPeerId,
        capabilities: ["sbp/1"],
        metadata: { version: "1.0" },
      });
      const config = createConfig({ negotiator });
      const manager = new SessionManager(config);

      const session = await manager.connect();

      expect(session.peerId).toBe(expectedPeerId);
      expect(session.state).toBe("active");
    });

    it("includes identity when negotiator provides one", async () => {
      const expectedIdentity = {
        type: "ed25519" as const,
        fingerprint: "abc123",
      };
      const negotiator = createMockNegotiator({
        peerId: asPeerId("peer-with-identity"),
        identity: expectedIdentity,
        capabilities: [],
        metadata: {},
      });
      const config = createConfig({ negotiator });
      const manager = new SessionManager(config);

      const session = await manager.connect();

      expect(session.identity).toEqual(expectedIdentity);
    });

    it("emits identity_established event when identity is present", async () => {
      const expectedIdentity = {
        type: "ed25519" as const,
        fingerprint: "def456",
      };
      const negotiator = createMockNegotiator({
        peerId: asPeerId("peer"),
        identity: expectedIdentity,
        capabilities: [],
        metadata: {},
      });
      const config = createConfig({ negotiator });
      const manager = new SessionManager(config);

      let emittedIdentity: typeof expectedIdentity | undefined;
      manager.on("identity_established", (event) => {
        emittedIdentity = event.identity as typeof expectedIdentity;
      });

      await manager.connect();

      expect(emittedIdentity).toEqual(expectedIdentity);
    });

    it("session sendRaw delegates to channel", async () => {
      const transport = createMockTransport();
      const config = createConfig({
        transportFactory: () => Promise.resolve(transport),
      });
      const manager = new SessionManager(config);

      const session = await manager.connect();
      const data = new Uint8Array([1, 2, 3]);
      await session.sendRaw(data);

      expect(transport.send).toHaveBeenCalledWith(data);
    });
  });

  describe("failed negotiation - fatal error", () => {
    it("transitions to idle on fatal error", async () => {
      const negotiator: Negotiator = {
        negotiate: () => Promise.reject(new Error("Fatal protocol error")),
        terminate: () => Promise.resolve(),
        classifyError: () => "fatal",
      };
      const config = createConfig({ negotiator });
      const manager = new SessionManager(config);

      await expect(manager.connect()).rejects.toThrow("Fatal protocol error");
      expect(manager.state).toBe("idle");
    });

    it("emits closed event with fatal=true", async () => {
      const negotiator: Negotiator = {
        negotiate: () => Promise.reject(new Error("Security violation")),
        terminate: () => Promise.resolve(),
        classifyError: () => "fatal",
      };
      const config = createConfig({ negotiator });
      const manager = new SessionManager(config);

      let closedEvent: SessionEvents["closed"] | undefined;
      manager.on("closed", (event) => {
        closedEvent = event;
      });

      await expect(manager.connect()).rejects.toThrow();

      expect(closedEvent).toBeDefined();
      expect(closedEvent!.fatal).toBe(true);
      expect(closedEvent!.graceful).toBe(false);
    });

    it("does not retry on fatal error even with retry policy", async () => {
      let negotiateCallCount = 0;
      const negotiator: Negotiator = {
        negotiate: () => {
          negotiateCallCount++;
          return Promise.reject(new Error("Identity mismatch"));
        },
        terminate: () => Promise.resolve(),
        classifyError: () => "fatal",
      };
      const config = createConfig({
        negotiator,
        retryPolicy: { mode: "on-error", maxAttempts: 3 },
      });
      const manager = new SessionManager(config);

      await expect(manager.connect()).rejects.toThrow();

      expect(negotiateCallCount).toBe(1);
    });
  });

  describe("retry on retryable error", () => {
    it("retries on retryable error with on-error mode", async () => {
      let attempts = 0;
      const negotiator: Negotiator = {
        negotiate: () => {
          attempts++;
          if (attempts < 3) {
            return Promise.reject(new Error("Transient error"));
          }
          return Promise.resolve({
            peerId: asPeerId("peer"),
            capabilities: [],
            metadata: {},
          });
        },
        terminate: () => Promise.resolve(),
        classifyError: () => "retryable",
      };

      // Use zero jitter for predictable timing
      const config = createConfig({
        negotiator,
        retryPolicy: {
          mode: "on-error",
          maxAttempts: 5,
          initialDelayMs: 10,
          maxDelayMs: 100,
          jitter: 0,
        },
      });
      const manager = new SessionManager(config);

      const session = await manager.connect();

      expect(attempts).toBe(3);
      expect(session.peerId).toBe(asPeerId("peer"));
    });

    it("emits retrying event with correct attempt count", async () => {
      let attempts = 0;
      const retryEvents: SessionEvents["retrying"][] = [];
      const negotiator: Negotiator = {
        negotiate: () => {
          attempts++;
          if (attempts < 3) {
            return Promise.reject(new Error(`Attempt ${attempts} failed`));
          }
          return Promise.resolve({
            peerId: asPeerId("peer"),
            capabilities: [],
            metadata: {},
          });
        },
        terminate: () => Promise.resolve(),
        classifyError: () => "retryable",
      };

      const config = createConfig({
        negotiator,
        retryPolicy: {
          mode: "on-error",
          maxAttempts: 5,
          initialDelayMs: 1,
          maxDelayMs: 10,
          jitter: 0,
        },
      });
      const manager = new SessionManager(config);

      manager.on("retrying", (event) => retryEvents.push(event));

      await manager.connect();

      expect(retryEvents).toHaveLength(2);
      expect(retryEvents[0]!.attempt).toBe(1);
      expect(retryEvents[1]!.attempt).toBe(2);
    });

    it("transitions to retry-wait state during backoff", async () => {
      let capturedState: string | undefined;
      const negotiator: Negotiator = {
        negotiate: () => Promise.reject(new Error("Connection refused")),
        terminate: () => Promise.resolve(),
        classifyError: () => "retryable",
      };

      const config = createConfig({
        negotiator,
        retryPolicy: {
          mode: "on-error",
          maxAttempts: 1,
          initialDelayMs: 50,
          maxDelayMs: 100,
          jitter: 0,
        },
      });
      const manager = new SessionManager(config);

      manager.on("retrying", () => {
        capturedState = manager.state;
      });

      await expect(manager.connect()).rejects.toThrow();

      expect(capturedState).toBe("retry-wait");
    });

    it("does not retry with mode=never", async () => {
      let attempts = 0;
      const negotiator: Negotiator = {
        negotiate: () => {
          attempts++;
          return Promise.reject(new Error("Error"));
        },
        terminate: () => Promise.resolve(),
        classifyError: () => "retryable",
      };

      const config = createConfig({
        negotiator,
        retryPolicy: { mode: "never" },
      });
      const manager = new SessionManager(config);

      await expect(manager.connect()).rejects.toThrow();

      expect(attempts).toBe(1);
    });
  });

  describe("max retry limit", () => {
    it("stops retrying after maxAttempts", async () => {
      let attempts = 0;
      const negotiator: Negotiator = {
        negotiate: () => {
          attempts++;
          return Promise.reject(new Error("Persistent error"));
        },
        terminate: () => Promise.resolve(),
        classifyError: () => "retryable",
      };

      const config = createConfig({
        negotiator,
        retryPolicy: {
          mode: "on-error",
          maxAttempts: 3,
          initialDelayMs: 1,
          maxDelayMs: 10,
          jitter: 0,
        },
      });
      const manager = new SessionManager(config);

      await expect(manager.connect()).rejects.toThrow("Persistent error");

      // Initial attempt + maxAttempts retries
      expect(attempts).toBe(4);
      expect(manager.state).toBe("idle");
    });

    it("emits closed event with max retries exceeded message", async () => {
      const negotiator: Negotiator = {
        negotiate: () => Promise.reject(new Error("Error")),
        terminate: () => Promise.resolve(),
        classifyError: () => "retryable",
      };

      const config = createConfig({
        negotiator,
        retryPolicy: {
          mode: "on-error",
          maxAttempts: 2,
          initialDelayMs: 1,
          maxDelayMs: 10,
          jitter: 0,
        },
      });
      const manager = new SessionManager(config);

      let closedEvent: SessionEvents["closed"] | undefined;
      manager.on("closed", (event) => {
        closedEvent = event;
      });

      await expect(manager.connect()).rejects.toThrow();

      expect(closedEvent).toBeDefined();
      expect(closedEvent!.reason).toBe("Max retry attempts exceeded");
      expect(closedEvent!.fatal).toBe(false);
    });

    it("resets retry counter on successful connection", async () => {
      let attempts = 0;
      const negotiator: Negotiator = {
        negotiate: () => {
          attempts++;
          if (attempts < 3) {
            return Promise.reject(new Error("Transient"));
          }
          return Promise.resolve({
            peerId: asPeerId("peer"),
            capabilities: [],
            metadata: {},
          });
        },
        terminate: () => Promise.resolve(),
        classifyError: () => "retryable",
      };

      const config = createConfig({
        negotiator,
        retryPolicy: {
          mode: "on-error",
          maxAttempts: 5,
          initialDelayMs: 1,
          maxDelayMs: 10,
          jitter: 0,
        },
      });
      const manager = new SessionManager(config);

      // First connect succeeds after 2 retries
      const session = await manager.connect();
      expect(session).toBeDefined();
      expect(attempts).toBe(3);

      // Terminate and reconnect - should start fresh
      await manager.terminate();
      attempts = 0;

      // Retry counter should be reset
      const session2 = await manager.connect();
      expect(session2).toBeDefined();
      expect(attempts).toBe(3);
    });
  });

  describe("terminate during active state", () => {
    it("transitions to idle and emits closed event", async () => {
      const config = createConfig();
      const manager = new SessionManager(config);

      let closedEvent: SessionEvents["closed"] | undefined;
      manager.on("closed", (event) => {
        closedEvent = event;
      });

      await manager.connect();
      expect(manager.state).toBe("active");

      await manager.terminate({ reason: "user requested" });

      expect(manager.state).toBe("idle");
      expect(closedEvent).toBeDefined();
      expect(closedEvent!.reason).toBe("user requested");
      expect(closedEvent!.graceful).toBe(true);
    });

    it("calls negotiator.terminate and transport.close", async () => {
      const transport = createMockTransport();
      const negotiator = createMockNegotiator();
      const config = createConfig({
        transportFactory: () => Promise.resolve(transport),
        negotiator,
      });
      const manager = new SessionManager(config);

      await manager.connect();
      await manager.terminate({ reason: "shutdown" });

      expect(negotiator.terminate).toHaveBeenCalledWith(transport, {
        reason: "shutdown",
      });
      expect(transport.close).toHaveBeenCalledWith({ reason: "shutdown" });
    });

    it("ignores errors during termination", async () => {
      const transport = createMockTransport();
      (transport.close as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.reject(new Error("Close failed")),
      );
      const negotiator = createMockNegotiator();
      (negotiator.terminate as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.reject(new Error("Terminate failed")),
      );

      const config = createConfig({
        transportFactory: () => Promise.resolve(transport),
        negotiator,
      });
      const manager = new SessionManager(config);

      await manager.connect();

      // Should not throw
      await manager.terminate();
      expect(manager.state).toBe("idle");
    });

    it("cancels pending retry on terminate", async () => {
      let attempts = 0;
      const negotiator: Negotiator = {
        negotiate: () => {
          attempts++;
          return Promise.reject(new Error("Error"));
        },
        terminate: () => Promise.resolve(),
        classifyError: () => "retryable",
      };

      const config = createConfig({
        negotiator,
        retryPolicy: {
          mode: "on-error",
          maxAttempts: 10,
          initialDelayMs: 100, // Short delay for test
          maxDelayMs: 500,
          jitter: 0,
        },
      });
      const manager = new SessionManager(config);

      // Set up promise to wait for retry event BEFORE starting connect
      const retryPromise = new Promise<void>((resolve) => {
        manager.on("retrying", () => resolve());
      });

      // Start connection (will fail and enter retry)
      const connectPromise = manager.connect();

      // Wait for first retry event
      await retryPromise;

      // Terminate during retry wait
      await manager.terminate({ reason: "cancelled" });

      // Connect should reject
      await expect(connectPromise).rejects.toThrow();

      // Should have only attempted once before termination
      expect(attempts).toBe(1);
      expect(manager.state).toBe("idle");
    });
  });

  describe("event emission", () => {
    it("emits connecting event with endpoint", async () => {
      const config = createConfig({ endpoint: "ws://test.example.com:9000" });
      const manager = new SessionManager(config);

      let connectingEvent: SessionEvents["connecting"] | undefined;
      manager.on("connecting", (event) => {
        connectingEvent = event;
      });

      await manager.connect();

      expect(connectingEvent).toBeDefined();
      expect(connectingEvent!.endpoint).toBe("ws://test.example.com:9000");
    });

    it("emits negotiating event with transport", async () => {
      const transport = createMockTransport("custom-transport");
      const config = createConfig({
        transportFactory: () => Promise.resolve(transport),
      });
      const manager = new SessionManager(config);

      let negotiatingEvent: SessionEvents["negotiating"] | undefined;
      manager.on("negotiating", (event) => {
        negotiatingEvent = event;
      });

      await manager.connect();

      expect(negotiatingEvent).toBeDefined();
      expect(negotiatingEvent!.transport.id).toBe("custom-transport");
    });

    it("emits active event with peerId and capabilities", async () => {
      const negotiator = createMockNegotiator({
        peerId: asPeerId("active-peer"),
        capabilities: ["sbp/1", "rpc/1"],
        metadata: {},
      });
      const config = createConfig({ negotiator });
      const manager = new SessionManager(config);

      let activeEvent: SessionEvents["active"] | undefined;
      manager.on("active", (event) => {
        activeEvent = event;
      });

      await manager.connect();

      expect(activeEvent).toBeDefined();
      expect(activeEvent!.peerId).toBe(asPeerId("active-peer"));
      expect(activeEvent!.capabilities).toEqual(["sbp/1", "rpc/1"]);
    });

    it("allows unsubscribing from events", async () => {
      const config = createConfig();
      const manager = new SessionManager(config);

      let callCount = 0;
      const unsubscribe = manager.on("connecting", () => {
        callCount++;
      });

      await manager.connect();
      expect(callCount).toBe(1);

      await manager.terminate();
      unsubscribe();

      await manager.connect();
      expect(callCount).toBe(1); // Should not have been called again
    });

    it("handles errors in event handlers gracefully", async () => {
      const config = createConfig();
      const manager = new SessionManager(config);

      manager.on("connecting", () => {
        throw new Error("Handler error");
      });

      // Should not throw despite handler error
      const session = await manager.connect();
      expect(session).toBeDefined();
    });
  });

  describe("transport factory errors", () => {
    it("handles transport factory rejection", async () => {
      const config = createConfig({
        transportFactory: () => Promise.reject(new Error("Connection refused")),
        negotiator: createMockNegotiator(undefined, "retryable"),
        retryPolicy: { mode: "never" },
      });
      const manager = new SessionManager(config);

      await expect(manager.connect()).rejects.toThrow("Connection refused");
      expect(manager.state).toBe("idle");
    });
  });

  describe("terminate during transport creation", () => {
    it("aborts and closes transport if terminate() called during transportFactory()", async () => {
      const transport = createMockTransport();
      let resolveTransport: (t: TransportConnection) => void;
      const transportPromise = new Promise<TransportConnection>((resolve) => {
        resolveTransport = resolve;
      });

      const config = createConfig({
        transportFactory: () => transportPromise,
      });
      const manager = new SessionManager(config);

      // Start connection (will await transport creation)
      const connectPromise = manager.connect();

      // Terminate while transport is being created
      const terminatePromise = manager.terminate({ reason: "cancelled" });

      // Now resolve the transport factory
      resolveTransport!(transport);

      // Both should complete
      await terminatePromise;
      await expect(connectPromise).rejects.toThrow("Session terminated");

      // Transport should have been closed
      expect(transport.close).toHaveBeenCalledWith({ reason: "terminated" });
      expect(manager.state).toBe("idle");
    });
  });
});

describe("createSessionManager", () => {
  it("creates a SessionManager instance", async () => {
    const { createSessionManager } = await import("./session.js");
    const config = createConfig();
    const manager = createSessionManager(config);

    expect(manager).toBeInstanceOf(SessionManager);
    expect(manager.state).toBe("idle");
  });
});
