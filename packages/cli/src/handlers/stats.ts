// SPDX-License-Identifier: Apache-2.0

import type { ConnectedPeer } from "@sideband/cloud";
import * as os from "node:os";
import type { MethodMeta } from "./rpc-meta.js";

export interface StatsSnapshot {
  loadAvg: [number, number, number];
  memory: { total: number; free: number };
  uptime: number;
  cpuCount: number;
  platform: string;
}

// Cache static values — these don't change during a process's lifetime.
const PLATFORM = os.platform();
const CPU_COUNT = os.cpus().length;

function getSnapshot(): StatsSnapshot {
  const [a, b, c] = os.loadavg();
  return {
    loadAvg: [a!, b!, c!],
    memory: { total: os.totalmem(), free: os.freemem() },
    uptime: os.uptime(),
    cpuCount: CPU_COUNT,
    platform: PLATFORM,
  };
}

/**
 * Registers $sideband/stats, $sideband/stats.start, and $sideband/stats.stop
 * handlers for the given peer. The disconnect listener is attached once at
 * registration scope — not inside stats.start — to prevent listener accumulation
 * on repeated calls.
 *
 * Returns the capability descriptor to be merged into $sideband/info capabilities.
 */
export function registerStatsHandlers(peer: ConnectedPeer): {
  stats: Record<string, never>;
} {
  let timer: ReturnType<typeof setInterval> | undefined;

  const clearTimer = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  };

  peer.rpc.handle("$sideband/stats", () => getSnapshot());

  peer.rpc.handle("$sideband/stats.start", (params: unknown) => {
    clearTimer();
    const raw = (params as { intervalMs?: unknown } | null | undefined)
      ?.intervalMs;
    // Number.isFinite rejects NaN, Infinity, and non-numbers in one check.
    const ms = Math.max(
      1000,
      Math.min(Number.isFinite(raw) ? (raw as number) : 2000, 60000),
    );
    timer = setInterval(() => {
      peer.events.emit("$sideband/stats.tick", {
        ...getSnapshot(),
        timestamp: Date.now(),
      });
    }, ms);
    timer.unref?.();
    return { ok: true, intervalMs: ms };
  });

  peer.rpc.handle("$sideband/stats.stop", () => {
    clearTimer();
    return { ok: true };
  });

  // Attached once at registration scope — cleans up on terminal disconnect.
  peer.on("disconnected", clearTimer);

  return { stats: {} };
}

export const statsMeta: Record<string, MethodMeta> = {
  "$sideband/stats": {
    description: "System stats snapshot. loadAvg is [0,0,0] on Windows.",
    input: "none",
  },
  "$sideband/stats.start": {
    description: "Start live stats (emits $sideband/stats.tick events)",
    input: "{ intervalMs?: number }",
    inputExample: { intervalMs: 2000 },
  },
  "$sideband/stats.stop": {
    description: "Stop live stats",
    input: "none",
  },
};
