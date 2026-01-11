// SPDX-License-Identifier: Apache-2.0

import type { MessageHandler } from "./types.js";

/** Handler registration with metadata */
export interface HandlerEntry {
  handler: MessageHandler;
  mode: "exclusive" | "broadcast";
  registrationOrder: number;
}

/**
 * Handler registry with dispatch ordering.
 *
 * Ordering rules:
 * 1. Exact matches have priority over prefix matches
 * 2. Longer prefixes have priority over shorter prefixes
 * 3. Within each bucket, registration order is preserved
 */
export class HandlerRegistry {
  private exactHandlers = new Map<string, HandlerEntry[]>();
  private prefixHandlers: Array<{ prefix: string; entries: HandlerEntry[] }> =
    [];
  private registrationCounter = 0;

  /**
   * Register an exact match handler.
   */
  routeExact(
    subject: string,
    handler: MessageHandler,
    mode: "exclusive" | "broadcast",
  ): () => void {
    const entry: HandlerEntry = {
      handler,
      mode,
      registrationOrder: this.registrationCounter++,
    };

    const existing = this.exactHandlers.get(subject) ?? [];
    existing.push(entry);
    this.exactHandlers.set(subject, existing);

    return () => {
      const handlers = this.exactHandlers.get(subject);
      if (handlers) {
        const idx = handlers.indexOf(entry);
        if (idx !== -1) handlers.splice(idx, 1);
        if (handlers.length === 0) this.exactHandlers.delete(subject);
      }
    };
  }

  /**
   * Register a prefix handler.
   */
  routePrefix(
    prefix: string,
    handler: MessageHandler,
    mode: "exclusive" | "broadcast",
  ): () => void {
    const entry: HandlerEntry = {
      handler,
      mode,
      registrationOrder: this.registrationCounter++,
    };

    // Find or create entry for this prefix
    let prefixEntry = this.prefixHandlers.find((p) => p.prefix === prefix);
    if (!prefixEntry) {
      prefixEntry = { prefix, entries: [] };
      this.prefixHandlers.push(prefixEntry);
      // Sort by prefix length descending (longest first)
      this.prefixHandlers.sort((a, b) => b.prefix.length - a.prefix.length);
    }
    prefixEntry.entries.push(entry);

    return () => {
      const pe = this.prefixHandlers.find((p) => p.prefix === prefix);
      if (pe) {
        const idx = pe.entries.indexOf(entry);
        if (idx !== -1) pe.entries.splice(idx, 1);
        if (pe.entries.length === 0) {
          const peIdx = this.prefixHandlers.indexOf(pe);
          if (peIdx !== -1) this.prefixHandlers.splice(peIdx, 1);
        }
      }
    };
  }

  /**
   * Remove all handlers for a subject (exact match only).
   */
  unroute(subject: string): void {
    this.exactHandlers.delete(subject);
  }

  /**
   * Clear all handlers.
   */
  clear(): void {
    this.exactHandlers.clear();
    this.prefixHandlers = [];
    this.registrationCounter = 0;
  }

  /**
   * Get matching handlers in dispatch order.
   * Returns handlers sorted by: exact first, then prefix (longest first), then registration order.
   */
  getMatching(subject: string): HandlerEntry[] {
    const result: HandlerEntry[] = [];

    // Exact matches first
    const exact = this.exactHandlers.get(subject);
    if (exact) {
      result.push(...exact);
    }

    // Prefix matches (already sorted by length descending)
    for (const pe of this.prefixHandlers) {
      if (subject.startsWith(pe.prefix)) {
        result.push(...pe.entries);
      }
    }

    // Sort by registration order within combined result
    // Note: This maintains exact > prefix ordering because exact handlers
    // are added first, and we use stable sort semantics
    return result;
  }

  /**
   * Check if any handlers are registered.
   */
  hasHandlers(): boolean {
    return this.exactHandlers.size > 0 || this.prefixHandlers.length > 0;
  }
}
