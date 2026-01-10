// SPDX-License-Identifier: Apache-2.0

/**
 * Bitmap-based replay protection for Sideband Relay Protocol (SBRP).
 *
 * Uses a sliding window to track seen sequence numbers and prevent
 * replay attacks while avoiding memory exhaustion from attacker-controlled
 * sequence numbers.
 */

import { DEFAULT_REPLAY_WINDOW_SIZE } from "./constants.js";

/** Replay window state */
export interface ReplayWindow {
  /** Highest accepted sequence number */
  maxSeen: bigint;
  /** Bitmap: bit i set = sequence (maxSeen - i) was seen */
  bitmap: bigint;
  /** Window size in bits */
  windowSize: bigint;
}

/**
 * Create a new replay window.
 *
 * @param windowSize - Window size in bits (default: 64)
 */
export function createReplayWindow(
  windowSize: bigint = DEFAULT_REPLAY_WINDOW_SIZE,
): ReplayWindow {
  return {
    maxSeen: -1n, // No messages seen yet
    bitmap: 0n,
    windowSize,
  };
}

/**
 * Check if a sequence number is valid (not a replay) and update the window.
 *
 * @returns true if the sequence is valid and accepted, false if it's a replay
 */
export function checkAndUpdateReplay(
  seq: bigint,
  window: ReplayWindow,
): boolean {
  // First message ever
  if (window.maxSeen === -1n) {
    window.maxSeen = seq;
    window.bitmap = 1n;
    return true;
  }

  if (seq > window.maxSeen) {
    // New high sequence - shift window
    const shift = seq - window.maxSeen;
    if (shift >= window.windowSize) {
      // Sequence is far ahead, reset bitmap
      window.bitmap = 1n;
    } else {
      window.bitmap = (window.bitmap << shift) | 1n;
    }
    window.maxSeen = seq;
    return true;
  }

  // Sequence is within or before the window
  const diff = window.maxSeen - seq;
  if (diff >= window.windowSize) {
    // Too old, outside window
    return false;
  }

  const mask = 1n << diff;
  if (window.bitmap & mask) {
    // Already seen (replay)
    return false;
  }

  // Mark as seen
  window.bitmap |= mask;
  return true;
}

/**
 * Check if a sequence number would be valid without updating the window.
 *
 * Useful for pre-validation before decryption.
 */
export function isValidSequence(seq: bigint, window: ReplayWindow): boolean {
  if (window.maxSeen === -1n) {
    return true;
  }

  if (seq > window.maxSeen) {
    return true;
  }

  const diff = window.maxSeen - seq;
  if (diff >= window.windowSize) {
    return false;
  }

  const mask = 1n << diff;
  return (window.bitmap & mask) === 0n;
}

/**
 * Reset the replay window to initial state.
 */
export function resetReplayWindow(window: ReplayWindow): void {
  window.maxSeen = -1n;
  window.bitmap = 0n;
}
