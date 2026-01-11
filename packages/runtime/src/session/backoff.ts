// SPDX-License-Identifier: Apache-2.0

export interface BackoffPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
  jitter: number;
}

export const defaultBackoffPolicy: BackoffPolicy = {
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  maxAttempts: 5,
  jitter: 0.2,
};

/**
 * Calculate backoff delay for a retry attempt.
 * Formula: min(initial * 2^attempt, max) * (1 + random(-jitter, +jitter))
 */
export function calculateBackoff(
  attempt: number,
  policy: BackoffPolicy,
): number {
  const baseDelay = Math.min(
    policy.initialDelayMs * Math.pow(2, attempt),
    policy.maxDelayMs,
  );
  const jitterRange = baseDelay * policy.jitter;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(baseDelay + jitter));
}
