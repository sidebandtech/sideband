// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { registerStatsHandlers, type StatsSnapshot } from "./stats.js";
import { makeStubPeer } from "./test-utils.js";

describe("registerStatsHandlers", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("$sideband/stats returns valid StatsSnapshot shape", () => {
    const { peer, callHandler } = makeStubPeer();
    registerStatsHandlers(peer);
    const snap = callHandler("$sideband/stats") as StatsSnapshot;
    expect(Array.isArray(snap.loadAvg)).toBe(true);
    expect(snap.loadAvg).toHaveLength(3);
    expect(typeof snap.memory.total).toBe("number");
    expect(typeof snap.memory.free).toBe("number");
    expect(typeof snap.uptime).toBe("number");
    expect(typeof snap.cpuCount).toBe("number");
    expect(typeof snap.platform).toBe("string");
  });

  it("$sideband/stats.start returns { ok: true, intervalMs } with default 2000", () => {
    const { peer, callHandler } = makeStubPeer();
    registerStatsHandlers(peer);
    expect(callHandler("$sideband/stats.start")).toEqual({
      ok: true,
      intervalMs: 2000,
    });
  });

  it("$sideband/stats.start clamps intervalMs: 500 → 1000", () => {
    const { peer, callHandler } = makeStubPeer();
    registerStatsHandlers(peer);
    expect(callHandler("$sideband/stats.start", { intervalMs: 500 })).toEqual({
      ok: true,
      intervalMs: 1000,
    });
  });

  it("$sideband/stats.start clamps intervalMs: 120000 → 60000", () => {
    const { peer, callHandler } = makeStubPeer();
    registerStatsHandlers(peer);
    expect(
      callHandler("$sideband/stats.start", { intervalMs: 120_000 }),
    ).toEqual({ ok: true, intervalMs: 60000 });
  });

  it('$sideband/stats.start with intervalMs: "fast" → defaults to 2000 (NaN guard)', () => {
    const { peer, callHandler } = makeStubPeer();
    registerStatsHandlers(peer);
    expect(
      callHandler("$sideband/stats.start", { intervalMs: "fast" }),
    ).toEqual({ ok: true, intervalMs: 2000 });
  });

  it("$sideband/stats.start with intervalMs: null → defaults to 2000", () => {
    const { peer, callHandler } = makeStubPeer();
    registerStatsHandlers(peer);
    expect(callHandler("$sideband/stats.start", { intervalMs: null })).toEqual({
      ok: true,
      intervalMs: 2000,
    });
  });

  it("$sideband/stats.start with intervalMs: Infinity → defaults to 2000", () => {
    const { peer, callHandler } = makeStubPeer();
    registerStatsHandlers(peer);
    expect(
      callHandler("$sideband/stats.start", { intervalMs: Infinity }),
    ).toEqual({ ok: true, intervalMs: 2000 });
  });

  it("$sideband/stats.start called twice → only one interval active", () => {
    const { peer, callHandler } = makeStubPeer();
    registerStatsHandlers(peer);
    callHandler("$sideband/stats.start", { intervalMs: 5000 });
    callHandler("$sideband/stats.start", { intervalMs: 5000 });
    expect(jest.getTimerCount()).toBe(1);
  });

  it("$sideband/stats.stop is idempotent and returns { ok: true }", () => {
    const { peer, callHandler } = makeStubPeer();
    registerStatsHandlers(peer);
    expect(callHandler("$sideband/stats.stop")).toEqual({ ok: true });
    expect(callHandler("$sideband/stats.stop")).toEqual({ ok: true });
  });

  it("$sideband/stats.stop halts tick emissions", () => {
    const { peer, callHandler, getEmitted } = makeStubPeer();
    registerStatsHandlers(peer);
    callHandler("$sideband/stats.start", { intervalMs: 1000 });
    jest.advanceTimersByTime(2500);
    callHandler("$sideband/stats.stop");
    const countAfterStop = getEmitted().length;
    jest.advanceTimersByTime(3000);
    expect(getEmitted().length).toBe(countAfterStop);
  });

  it("$sideband/stats.tick payload matches StatsSnapshot & { timestamp }", () => {
    const { peer, callHandler, getEmitted } = makeStubPeer();
    registerStatsHandlers(peer);
    callHandler("$sideband/stats.start", { intervalMs: 1000 });
    jest.advanceTimersByTime(1100);
    const ticks = getEmitted().filter(
      (e) => e.event === "$sideband/stats.tick",
    );
    expect(ticks.length).toBeGreaterThan(0);
    const tick = ticks[0]!.data as StatsSnapshot & { timestamp: number };
    expect(typeof tick.timestamp).toBe("number");
    expect(Array.isArray(tick.loadAvg)).toBe(true);
  });

  it("start → stop → start again works correctly", () => {
    const { peer, callHandler, getEmitted } = makeStubPeer();
    registerStatsHandlers(peer);
    callHandler("$sideband/stats.start", { intervalMs: 1000 });
    jest.advanceTimersByTime(1100);
    callHandler("$sideband/stats.stop");
    const countAfterStop = getEmitted().length;
    callHandler("$sideband/stats.start", { intervalMs: 1000 });
    jest.advanceTimersByTime(1100);
    expect(getEmitted().length).toBeGreaterThan(countAfterStop);
    expect(jest.getTimerCount()).toBe(1);
  });

  it("peer disconnect → interval auto-cleared", () => {
    const { peer, callHandler, getEmitted, triggerDisconnect } = makeStubPeer();
    registerStatsHandlers(peer);
    callHandler("$sideband/stats.start", { intervalMs: 1000 });
    expect(jest.getTimerCount()).toBe(1);
    triggerDisconnect();
    const countAfterDisconnect = getEmitted().length;
    jest.advanceTimersByTime(5000);
    expect(getEmitted().length).toBe(countAfterDisconnect);
  });

  it("returns capability descriptor { stats: {} }", () => {
    const { peer } = makeStubPeer();
    const caps = registerStatsHandlers(peer);
    expect(caps).toEqual({ stats: {} });
  });
});
