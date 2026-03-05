// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import type { CloudPeerServer } from "@sideband/cloud";
import { parseExpiryMs, renewQc, scheduleQcRenewal } from "./commands/start.js";

// ─── parseExpiryMs ────────────────────────────────────────────────────────────

describe("parseExpiryMs", () => {
  it("parses valid ISO 8601 timestamp", () => {
    const iso = "2026-03-05T12:44:05Z";
    expect(parseExpiryMs(iso)).toBe(Date.parse(iso));
  });

  it("throws on invalid timestamp", () => {
    expect(() => parseExpiryMs("not-a-date")).toThrow(
      "Invalid Quick Connect expiry timestamp",
    );
  });

  it("throws on empty string", () => {
    expect(() => parseExpiryMs("")).toThrow();
  });
});

// ─── QC renewal helpers ───────────────────────────────────────────────────────

/** Capture stdout writes during an async operation. */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  let captured = "";
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    captured +=
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return captured;
}

async function captureStderr(fn: () => Promise<void>): Promise<string> {
  let captured = "";
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array) => {
    captured +=
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stderr.write = orig;
  }
  return captured;
}

function makeFakeServer(
  qcResult: { code: string; url: string; expiresAt: string } | Error,
): CloudPeerServer {
  return {
    createQuickConnect: () =>
      qcResult instanceof Error
        ? Promise.reject(qcResult)
        : Promise.resolve(qcResult),
  } as unknown as CloudPeerServer;
}

// ─── scheduleQcRenewal ────────────────────────────────────────────────────────

describe("scheduleQcRenewal", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("schedules renewal 30s before expiry (min 1s)", () => {
    const expiryMs = Date.now() + 300_000; // 5 min from now
    const server = makeFakeServer({
      code: "c",
      url: "u",
      expiresAt: new Date(expiryMs + 300_000).toISOString(),
    });

    scheduleQcRenewal(server, expiryMs, false);

    // Should have set exactly one timer at ~270s (300s - 30s)
    expect(jest.getTimerCount()).toBe(1);
  });

  it("clamps delay to at least 1s when expiresAt is in the past", () => {
    const expiryMs = Date.now() - 10_000; // already expired
    const server = makeFakeServer({
      code: "c",
      url: "u",
      expiresAt: new Date(expiryMs + 60_000).toISOString(),
    });

    scheduleQcRenewal(server, expiryMs, false);
    expect(jest.getTimerCount()).toBe(1);
  });
});

// ─── renewQc ─────────────────────────────────────────────────────────────────

describe("renewQc", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("emits quick_connect event on success (JSON mode)", async () => {
    const futureExpiry = Date.now() + 300_000;
    const server = makeFakeServer({
      code: "new-code",
      url: "https://sideband.cloud/connect#qc=new-code",
      expiresAt: new Date(futureExpiry).toISOString(),
    });

    const output = await captureStdout(async () => {
      await renewQc(server, futureExpiry + 100_000, true, 0, false);
    });

    const event = JSON.parse(output.split("\n")[0]!) as Record<string, unknown>;
    expect(event["event"]).toBe("quick_connect");
    expect(event["code"]).toBe("new-code");

    // Should schedule next renewal
    expect(jest.getTimerCount()).toBe(1);
  });

  it("retries with exponential backoff on failure", async () => {
    const prevExpiryMs = Date.now() + 300_000; // not yet expired
    const server = makeFakeServer(new Error("network error"));

    const stderr = await captureStderr(async () => {
      await renewQc(server, prevExpiryMs, false, 0, false);
    });

    expect(stderr).toContain("renewal failed");
    // Backoff timer should be set (1s for attempt 0)
    expect(jest.getTimerCount()).toBe(1);

    // Advance 1s → triggers attempt 1 (also fails) → sets 2s timer
    jest.advanceTimersByTime(1000);
    await Promise.resolve(); // flush microtasks
    expect(jest.getTimerCount()).toBe(1);
  });

  it("announces 'expired' exactly once across multiple retries", async () => {
    // Set time past expiry
    const prevExpiryMs = Date.now() - 1000;
    const server = makeFakeServer(new Error("still failing"));

    let expiredCount = 0;
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      const s =
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      if (s.includes("expired")) expiredCount++;
      return true;
    };

    try {
      // First retry after expiry → should announce "expired"
      await renewQc(server, prevExpiryMs, false, 0, false);
      expect(expiredCount).toBe(1);

      // Advance to trigger next retry (attempt 1, expiredAnnounced=true)
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      // Second retry → should NOT announce "expired" again
      // (timer was set; fire it manually via advanceTimersByTime above)
    } finally {
      process.stderr.write = origWrite;
      jest.clearAllTimers();
    }

    expect(expiredCount).toBe(1);
  });

  it("NDJSON 'error' event in JSON mode on failure", async () => {
    const prevExpiryMs = Date.now() + 300_000;
    const server = makeFakeServer(new Error("rate limited"));

    const output = await captureStdout(async () => {
      await renewQc(server, prevExpiryMs, true, 0, false);
    });

    const event = JSON.parse(output.split("\n")[0]!) as Record<string, unknown>;
    expect(event["event"]).toBe("error");
    expect(String(event["message"])).toContain("renewal failed");
  });
});
