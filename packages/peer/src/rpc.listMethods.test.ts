// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { RpcImpl, type RpcHost } from "./rpc.js";
import { PeerErrorCode } from "./errors.js";

function makeHost(state: "active" | "closed" = "active"): RpcHost {
  return {
    state,
    connectionPolicy: { onDisconnect: "fail" },
    rpcPolicy: { defaultTimeoutMs: 10_000, disconnectBufferLimitBytes: 65536 },
    sendRaw: () => Promise.resolve(),
    onUnhandledError: () => {},
  };
}

describe("RpcImpl.listMethods()", () => {
  it("returns [] when no handlers are registered", () => {
    const rpc = new RpcImpl(makeHost());
    expect(rpc.listMethods()).toEqual([]);
  });

  it("returns registered method names sorted lexicographically", () => {
    const rpc = new RpcImpl(makeHost());
    rpc.handle("$sideband/stats", () => null);
    rpc.handle("$sideband/echo", () => null);
    rpc.handle("$sideband/info", () => null);
    expect(rpc.listMethods()).toEqual([
      "$sideband/echo",
      "$sideband/info",
      "$sideband/stats",
    ]);
  });

  it("reflects registrations after construction", () => {
    const rpc = new RpcImpl(makeHost());
    expect(rpc.listMethods()).toEqual([]);
    rpc.handle("foo", () => null);
    expect(rpc.listMethods()).toEqual(["foo"]);
  });

  it("reflects unsubscriptions", () => {
    const rpc = new RpcImpl(makeHost());
    const unsub = rpc.handle("$sideband/stats", () => null);
    rpc.handle("$sideband/echo", () => null);
    expect(rpc.listMethods()).toEqual(["$sideband/echo", "$sideband/stats"]);
    unsub();
    expect(rpc.listMethods()).toEqual(["$sideband/echo"]);
  });

  it("returns a stable sorted copy — mutations do not affect internals", () => {
    const rpc = new RpcImpl(makeHost());
    rpc.handle("b", () => null);
    rpc.handle("a", () => null);
    const list = rpc.listMethods();
    list.push("injected");
    expect(rpc.listMethods()).toEqual(["a", "b"]);
  });
});
