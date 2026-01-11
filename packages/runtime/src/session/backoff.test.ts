// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import {
  calculateBackoff,
  defaultBackoffPolicy,
  type BackoffPolicy,
} from "./backoff.js";

describe("calculateBackoff", () => {
  const noJitterPolicy: BackoffPolicy = {
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    maxAttempts: 5,
    jitter: 0, // No jitter for deterministic testing
  };

  it("returns initial delay for first attempt (attempt=0)", () => {
    const delay = calculateBackoff(0, noJitterPolicy);
    expect(delay).toBe(1000);
  });

  it("doubles delay each attempt", () => {
    expect(calculateBackoff(0, noJitterPolicy)).toBe(1000);
    expect(calculateBackoff(1, noJitterPolicy)).toBe(2000);
    expect(calculateBackoff(2, noJitterPolicy)).toBe(4000);
    expect(calculateBackoff(3, noJitterPolicy)).toBe(8000);
  });

  it("caps delay at maxDelayMs", () => {
    expect(calculateBackoff(10, noJitterPolicy)).toBe(30000);
    expect(calculateBackoff(100, noJitterPolicy)).toBe(30000);
  });

  it("applies jitter within range", () => {
    const policy: BackoffPolicy = { ...noJitterPolicy, jitter: 0.2 };
    const results: number[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(calculateBackoff(0, policy));
    }
    // With 20% jitter on 1000ms, range is 800-1200
    const min = Math.min(...results);
    const max = Math.max(...results);
    expect(min).toBeGreaterThanOrEqual(800);
    expect(max).toBeLessThanOrEqual(1200);
  });

  it("never returns negative values", () => {
    const policy: BackoffPolicy = { ...noJitterPolicy, jitter: 1.0 };
    for (let i = 0; i < 100; i++) {
      expect(calculateBackoff(0, policy)).toBeGreaterThanOrEqual(0);
    }
  });

  it("uses default policy values correctly", () => {
    expect(defaultBackoffPolicy.initialDelayMs).toBe(1000);
    expect(defaultBackoffPolicy.maxDelayMs).toBe(30000);
    expect(defaultBackoffPolicy.maxAttempts).toBe(5);
    expect(defaultBackoffPolicy.jitter).toBe(0.2);
  });
});
