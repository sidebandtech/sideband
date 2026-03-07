// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { registerRpcMeta, type MethodMeta } from "./rpc-meta.js";
import { makeStubPeer } from "./test-utils.js";

describe("registerRpcMeta", () => {
  it("$sideband/rpc.list returns sorted method names (including infrastructure methods)", () => {
    const { peer, callHandler, registerHandler } = makeStubPeer();
    registerHandler("$sideband/stats");
    registerHandler("$sideband/echo");
    registerRpcMeta(peer, {});
    const result = callHandler("$sideband/rpc.list") as { methods: string[] };
    expect(result.methods).toEqual([
      "$sideband/echo",
      "$sideband/rpc.describe",
      "$sideband/rpc.list",
      "$sideband/stats",
    ]);
  });

  it("$sideband/rpc.list reflects all registered handlers in real order", () => {
    const { peer, callHandler, registerHandler } = makeStubPeer();
    // Simulate real registration order: stats → echo → info → rpc-meta (last)
    registerHandler("$sideband/stats");
    registerHandler("$sideband/stats.start");
    registerHandler("$sideband/stats.stop");
    registerHandler("$sideband/echo");
    registerHandler("$sideband/info");
    registerRpcMeta(peer, {});
    const { methods } = callHandler("$sideband/rpc.list") as {
      methods: string[];
    };
    // rpc.list and rpc.describe registered last — must be present
    expect(methods).toContain("$sideband/rpc.list");
    expect(methods).toContain("$sideband/rpc.describe");
    expect(methods).toContain("$sideband/stats");
    expect(methods).toContain("$sideband/echo");
    expect(methods).toEqual([...methods].sort());
  });

  it("$sideband/rpc.describe returns sparse metadata for described methods", () => {
    const { peer, callHandler } = makeStubPeer();
    const descriptions: Record<string, MethodMeta> = {
      "$sideband/stats": { description: "System stats", input: "none" },
    };
    registerRpcMeta(peer, descriptions);
    const result = callHandler("$sideband/rpc.describe") as Record<
      string,
      MethodMeta
    >;
    expect(result["$sideband/stats"]).toEqual({
      description: "System stats",
      input: "none",
    });
    expect(Object.keys(result)).toEqual(["$sideband/stats"]);
  });

  it("$sideband/rpc.describe on daemon with no metadata → {}", () => {
    const { peer, callHandler } = makeStubPeer();
    registerRpcMeta(peer, {});
    expect(callHandler("$sideband/rpc.describe")).toEqual({});
  });
});
