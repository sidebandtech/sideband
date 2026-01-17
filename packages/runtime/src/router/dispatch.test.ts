// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { HandlerRegistry } from "./dispatch.js";

describe("HandlerRegistry", () => {
  describe("exact matching", () => {
    it("matches exact subject", () => {
      const registry = new HandlerRegistry();
      const handler = async () => {};
      registry.routeExact("rpc", handler, "exclusive");

      const matches = registry.getMatching("rpc");
      expect(matches).toHaveLength(1);
      expect(matches[0]!.handler).toBe(handler);
    });

    it("does not match different subject", () => {
      const registry = new HandlerRegistry();
      registry.routeExact("rpc", async () => {}, "exclusive");

      const matches = registry.getMatching("event");
      expect(matches).toHaveLength(0);
    });

    it("supports multiple handlers for same subject", () => {
      const registry = new HandlerRegistry();
      const h1 = async () => {};
      const h2 = async () => {};
      registry.routeExact("rpc", h1, "broadcast");
      registry.routeExact("rpc", h2, "broadcast");

      const matches = registry.getMatching("rpc");
      expect(matches).toHaveLength(2);
    });
  });

  describe("prefix matching", () => {
    it("matches prefix", () => {
      const registry = new HandlerRegistry();
      const handler = async () => {};
      registry.routePrefix("app/", handler, "exclusive");

      const matches = registry.getMatching("app/getUser");
      expect(matches).toHaveLength(1);
    });

    it("longer prefix has priority", () => {
      const registry = new HandlerRegistry();
      const shortHandler = async () => {};
      const longHandler = async () => {};
      registry.routePrefix("app/", shortHandler, "broadcast");
      registry.routePrefix("app/user.", longHandler, "broadcast");

      const matches = registry.getMatching("app/user.joined");
      expect(matches).toHaveLength(2);
      // Longer prefix should come first
      expect(matches[0]!.handler).toBe(longHandler);
      expect(matches[1]!.handler).toBe(shortHandler);
    });
  });

  describe("dispatch ordering", () => {
    it("exact handlers before prefix handlers", () => {
      const registry = new HandlerRegistry();
      const exact = async () => {};
      const prefix = async () => {};
      registry.routePrefix("app/", prefix, "broadcast");
      registry.routeExact("app/getUser", exact, "broadcast");

      const matches = registry.getMatching("app/getUser");
      expect(matches).toHaveLength(2);
      expect(matches[0]!.handler).toBe(exact);
      expect(matches[1]!.handler).toBe(prefix);
    });

    it("maintains registration order within same bucket", () => {
      const registry = new HandlerRegistry();
      const h1 = async () => {};
      const h2 = async () => {};
      const h3 = async () => {};
      registry.routeExact("app/test", h1, "broadcast");
      registry.routeExact("app/test", h2, "broadcast");
      registry.routeExact("app/test", h3, "broadcast");

      const matches = registry.getMatching("app/test");
      expect(matches[0]!.handler).toBe(h1);
      expect(matches[1]!.handler).toBe(h2);
      expect(matches[2]!.handler).toBe(h3);
    });
  });

  describe("unsubscribe", () => {
    it("removes exact handler", () => {
      const registry = new HandlerRegistry();
      const handler = async () => {};
      const unsub = registry.routeExact("app/test", handler, "exclusive");

      expect(registry.getMatching("app/test")).toHaveLength(1);
      unsub();
      expect(registry.getMatching("app/test")).toHaveLength(0);
    });

    it("removes prefix handler", () => {
      const registry = new HandlerRegistry();
      const handler = async () => {};
      const unsub = registry.routePrefix("app/", handler, "exclusive");

      expect(registry.getMatching("app/test")).toHaveLength(1);
      unsub();
      expect(registry.getMatching("app/test")).toHaveLength(0);
    });
  });

  describe("unroute", () => {
    it("removes all handlers for subject", () => {
      const registry = new HandlerRegistry();
      registry.routeExact("app/test", async () => {}, "broadcast");
      registry.routeExact("app/test", async () => {}, "broadcast");

      expect(registry.getMatching("app/test")).toHaveLength(2);
      registry.unroute("app/test");
      expect(registry.getMatching("app/test")).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("removes all handlers", () => {
      const registry = new HandlerRegistry();
      registry.routeExact("rpc", async () => {}, "exclusive");
      registry.routePrefix("app/", async () => {}, "broadcast");

      expect(registry.hasHandlers()).toBe(true);
      registry.clear();
      expect(registry.hasHandlers()).toBe(false);
    });
  });
});
