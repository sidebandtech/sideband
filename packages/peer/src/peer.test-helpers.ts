// SPDX-License-Identifier: Apache-2.0

/**
 * Poll `predicate` until it returns true or `timeoutMs` elapses.
 * Much more reliable than fixed sleeps in async tests.
 */
export async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 1000 } = {},
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start >= timeoutMs)
      throw new Error(`waitFor timeout after ${timeoutMs}ms`);
    await new Promise<void>((r) => setTimeout(r, 5));
  }
}
