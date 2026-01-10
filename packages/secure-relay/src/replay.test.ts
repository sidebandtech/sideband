// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { DEFAULT_REPLAY_WINDOW_SIZE } from "./constants.js";
import {
  checkAndUpdateReplay,
  createReplayWindow,
  isValidSequence,
  resetReplayWindow,
} from "./replay.js";

describe("replay protection", () => {
  describe("createReplayWindow", () => {
    it("creates window with default size", () => {
      const window = createReplayWindow();
      expect(window.maxSeen).toBe(-1n);
      expect(window.bitmap).toBe(0n);
      expect(window.windowSize).toBe(DEFAULT_REPLAY_WINDOW_SIZE);
    });

    it("creates window with custom size", () => {
      const window = createReplayWindow(128n);
      expect(window.windowSize).toBe(128n);
      expect(window.maxSeen).toBe(-1n);
      expect(window.bitmap).toBe(0n);
    });
  });

  describe("checkAndUpdateReplay", () => {
    it("accepts first message at seq=0", () => {
      const window = createReplayWindow();
      expect(checkAndUpdateReplay(0n, window)).toBe(true);
      expect(window.maxSeen).toBe(0n);
      expect(window.bitmap).toBe(1n);
    });

    it("accepts sequential messages 0,1,2,3", () => {
      const window = createReplayWindow();
      expect(checkAndUpdateReplay(0n, window)).toBe(true);
      expect(checkAndUpdateReplay(1n, window)).toBe(true);
      expect(checkAndUpdateReplay(2n, window)).toBe(true);
      expect(checkAndUpdateReplay(3n, window)).toBe(true);

      expect(window.maxSeen).toBe(3n);
      // Bitmap should have bits 0,1,2,3 set (counting from maxSeen backwards)
      // bit 0 = seq 3, bit 1 = seq 2, bit 2 = seq 1, bit 3 = seq 0
      expect(window.bitmap).toBe(0b1111n);
    });

    it("rejects duplicate sequence (replay attack)", () => {
      const window = createReplayWindow();
      expect(checkAndUpdateReplay(5n, window)).toBe(true);
      expect(checkAndUpdateReplay(5n, window)).toBe(false);
    });

    it("rejects multiple replays of same sequence", () => {
      const window = createReplayWindow();
      expect(checkAndUpdateReplay(10n, window)).toBe(true);
      expect(checkAndUpdateReplay(10n, window)).toBe(false);
      expect(checkAndUpdateReplay(10n, window)).toBe(false);
      expect(checkAndUpdateReplay(10n, window)).toBe(false);
    });

    it("accepts out-of-order within window", () => {
      const window = createReplayWindow();
      expect(checkAndUpdateReplay(5n, window)).toBe(true);
      expect(checkAndUpdateReplay(3n, window)).toBe(true); // Out of order
      expect(checkAndUpdateReplay(4n, window)).toBe(true); // Out of order
      expect(checkAndUpdateReplay(2n, window)).toBe(true); // Out of order

      expect(window.maxSeen).toBe(5n);
    });

    it("rejects sequence too old (outside window)", () => {
      const window = createReplayWindow(64n);
      expect(checkAndUpdateReplay(100n, window)).toBe(true);
      // Sequence 36 is exactly at windowSize boundary (100 - 64 = 36)
      expect(checkAndUpdateReplay(36n, window)).toBe(false);
      // Sequence 35 is outside window
      expect(checkAndUpdateReplay(35n, window)).toBe(false);
      expect(checkAndUpdateReplay(0n, window)).toBe(false);
    });

    it("accepts sequence at exact boundary (maxSeen - windowSize + 1)", () => {
      const window = createReplayWindow(64n);
      expect(checkAndUpdateReplay(100n, window)).toBe(true);
      // Sequence 37 is exactly at boundary (100 - 64 + 1 = 37)
      expect(checkAndUpdateReplay(37n, window)).toBe(true);
    });

    it("resets bitmap on large jump ahead", () => {
      const window = createReplayWindow(64n);
      expect(checkAndUpdateReplay(0n, window)).toBe(true);
      expect(checkAndUpdateReplay(1n, window)).toBe(true);

      // Jump far ahead (beyond window size)
      expect(checkAndUpdateReplay(1000n, window)).toBe(true);
      expect(window.maxSeen).toBe(1000n);
      expect(window.bitmap).toBe(1n); // Reset to just the new sequence
    });

    it("rejects old sequences after large jump", () => {
      const window = createReplayWindow(64n);
      expect(checkAndUpdateReplay(0n, window)).toBe(true);
      expect(checkAndUpdateReplay(1000n, window)).toBe(true);

      // Old sequences should be rejected
      expect(checkAndUpdateReplay(0n, window)).toBe(false);
      expect(checkAndUpdateReplay(1n, window)).toBe(false);
      expect(checkAndUpdateReplay(935n, window)).toBe(false); // 1000 - 65
    });

    it("tracks bitmap correctly for interleaved sequences", () => {
      const window = createReplayWindow();
      // Receive: 0, 2, 4, 6
      expect(checkAndUpdateReplay(0n, window)).toBe(true);
      expect(checkAndUpdateReplay(2n, window)).toBe(true);
      expect(checkAndUpdateReplay(4n, window)).toBe(true);
      expect(checkAndUpdateReplay(6n, window)).toBe(true);

      // Now fill in gaps: 1, 3, 5
      expect(checkAndUpdateReplay(1n, window)).toBe(true);
      expect(checkAndUpdateReplay(3n, window)).toBe(true);
      expect(checkAndUpdateReplay(5n, window)).toBe(true);

      // All should be marked as seen now
      expect(window.maxSeen).toBe(6n);
      // Bitmap: bits 0-6 set = 0b1111111 = 127
      expect(window.bitmap).toBe(0b1111111n);
    });

    it("handles first message with high sequence number", () => {
      const window = createReplayWindow();
      expect(checkAndUpdateReplay(1000000n, window)).toBe(true);
      expect(window.maxSeen).toBe(1000000n);
      expect(window.bitmap).toBe(1n);
    });
  });

  describe("isValidSequence", () => {
    it("does not modify window state", () => {
      const window = createReplayWindow();
      checkAndUpdateReplay(10n, window);

      const originalMaxSeen = window.maxSeen;
      const originalBitmap = window.bitmap;

      // Check validity without updating
      expect(isValidSequence(5n, window)).toBe(true);
      expect(isValidSequence(15n, window)).toBe(true);
      expect(isValidSequence(10n, window)).toBe(false); // Already seen

      // State should be unchanged
      expect(window.maxSeen).toBe(originalMaxSeen);
      expect(window.bitmap).toBe(originalBitmap);
    });

    it("returns true for empty window", () => {
      const window = createReplayWindow();
      expect(isValidSequence(0n, window)).toBe(true);
      expect(isValidSequence(100n, window)).toBe(true);
    });

    it("returns true for sequence ahead of maxSeen", () => {
      const window = createReplayWindow();
      checkAndUpdateReplay(10n, window);
      expect(isValidSequence(11n, window)).toBe(true);
      expect(isValidSequence(100n, window)).toBe(true);
    });

    it("returns false for sequence outside window", () => {
      const window = createReplayWindow(64n);
      checkAndUpdateReplay(100n, window);
      expect(isValidSequence(35n, window)).toBe(false);
      expect(isValidSequence(0n, window)).toBe(false);
    });

    it("returns false for already seen sequence", () => {
      const window = createReplayWindow();
      checkAndUpdateReplay(5n, window);
      checkAndUpdateReplay(3n, window);

      expect(isValidSequence(5n, window)).toBe(false);
      expect(isValidSequence(3n, window)).toBe(false);
    });

    it("returns true for unseen sequence within window", () => {
      const window = createReplayWindow();
      checkAndUpdateReplay(10n, window);

      // Sequences 0-9 are within window and unseen
      expect(isValidSequence(0n, window)).toBe(true);
      expect(isValidSequence(5n, window)).toBe(true);
      expect(isValidSequence(9n, window)).toBe(true);
    });
  });

  describe("resetReplayWindow", () => {
    it("clears window state", () => {
      const window = createReplayWindow();
      checkAndUpdateReplay(100n, window);
      checkAndUpdateReplay(50n, window);

      resetReplayWindow(window);

      expect(window.maxSeen).toBe(-1n);
      expect(window.bitmap).toBe(0n);
    });

    it("preserves window size", () => {
      const window = createReplayWindow(128n);
      checkAndUpdateReplay(100n, window);

      resetReplayWindow(window);

      expect(window.windowSize).toBe(128n);
    });

    it("allows accepting same sequences after reset", () => {
      const window = createReplayWindow();
      checkAndUpdateReplay(5n, window);
      expect(checkAndUpdateReplay(5n, window)).toBe(false);

      resetReplayWindow(window);

      expect(checkAndUpdateReplay(5n, window)).toBe(true);
    });
  });

  describe("window size variations", () => {
    it("works with small window (8 bits)", () => {
      const window = createReplayWindow(8n);
      expect(checkAndUpdateReplay(0n, window)).toBe(true);
      expect(checkAndUpdateReplay(10n, window)).toBe(true);

      // Sequence 2 is within window (10 - 8 + 1 = 3, so 2 is outside)
      expect(checkAndUpdateReplay(2n, window)).toBe(false);
      // Sequence 3 is at boundary
      expect(checkAndUpdateReplay(3n, window)).toBe(true);
    });

    it("works with large window (256 bits)", () => {
      const window = createReplayWindow(256n);
      expect(checkAndUpdateReplay(300n, window)).toBe(true);

      // Sequence 45 is within window (300 - 256 + 1 = 45)
      expect(checkAndUpdateReplay(45n, window)).toBe(true);
      // Sequence 44 is outside
      expect(checkAndUpdateReplay(44n, window)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles maxSeen=-1n correctly (first message ever)", () => {
      const window = createReplayWindow();
      expect(window.maxSeen).toBe(-1n);

      // Any first sequence should be accepted
      expect(isValidSequence(0n, window)).toBe(true);
      expect(isValidSequence(1000n, window)).toBe(true);

      expect(checkAndUpdateReplay(42n, window)).toBe(true);
      expect(window.maxSeen).toBe(42n);
    });

    it("handles shift exactly equal to window size", () => {
      const window = createReplayWindow(64n);
      expect(checkAndUpdateReplay(0n, window)).toBe(true);
      // Jump exactly windowSize ahead
      expect(checkAndUpdateReplay(64n, window)).toBe(true);
      expect(window.bitmap).toBe(1n); // Reset
    });

    it("handles shift one less than window size", () => {
      const window = createReplayWindow(64n);
      expect(checkAndUpdateReplay(0n, window)).toBe(true);
      // Jump windowSize - 1 ahead (shift within range)
      expect(checkAndUpdateReplay(63n, window)).toBe(true);
      // Bitmap should have both bits set
      // bit 0 = seq 63 (current), bit 63 = seq 0
      expect(window.bitmap & 1n).toBe(1n); // Sequence 63
      expect(window.bitmap & (1n << 63n)).toBe(1n << 63n); // Sequence 0
    });

    it("bitmap correctly handles sequences near boundaries", () => {
      const window = createReplayWindow(64n);

      // Set up window at maxSeen=63
      expect(checkAndUpdateReplay(63n, window)).toBe(true);

      // Sequences 0-63 should all be within window
      expect(isValidSequence(0n, window)).toBe(true);
      expect(isValidSequence(1n, window)).toBe(true);
      expect(isValidSequence(62n, window)).toBe(true);

      // Accept some in-window sequences
      expect(checkAndUpdateReplay(0n, window)).toBe(true);
      expect(checkAndUpdateReplay(62n, window)).toBe(true);

      // Verify they're now marked as seen
      expect(isValidSequence(0n, window)).toBe(false);
      expect(isValidSequence(62n, window)).toBe(false);
      expect(isValidSequence(63n, window)).toBe(false);
    });
  });
});
