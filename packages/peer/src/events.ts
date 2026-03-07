// SPDX-License-Identifier: Apache-2.0

/**
 * Events sub-namespace implementation.
 *
 * Handles:
 *   - Outgoing: encodes RpcNotification frames and sends them when active;
 *     buffers up to `eventPolicy.maxBufferedEvents` when disconnected
 *     (evict-oldest on overflow — no error thrown).
 *   - Incoming: decodes RpcNotification frames and broadcasts to all matching
 *     exact-name or NATS-pattern subscriptions.
 *   - Subscription survival: exact and pattern subscriptions persist across
 *     reconnects (no re-registration needed — subscriptions are in-process).
 *   - Handler errors forwarded via `host.onUnhandledError`; never abort dispatch.
 */

import {
  createMessageFrame,
  encodeFrame,
  type MessageFrame,
} from "@sideband/protocol";
import {
  createRpcNotification,
  decodeRpcEnvelope,
  encodeRpcEnvelope,
  isRpcNotification,
} from "@sideband/rpc";
import { PeerError, PeerErrorCode } from "./errors.js";
import { isValidEventName, matchPattern, validatePattern } from "./pattern.js";
import type {
  EventPolicy,
  EventsInterface,
  PatternSubscription,
  PeerState,
  Unsubscribe,
} from "./types.js";

// Protocol-defined channel subject — not user-configurable.
export const EVENT_SUBJECT = "event";

export interface EventHost {
  readonly state: PeerState;
  readonly eventPolicy: EventPolicy;
  sendRaw(data: Uint8Array): Promise<void>;
  onUnhandledError(err: Error): void;
}

interface PatternSub {
  pattern: string;
  handler: (eventName: string, data: unknown) => void;
}

/** Events implementation shared by PeerImpl and ConnectedPeerImpl. */
export class EventsImpl implements EventsInterface {
  private exactSubs = new Map<string, Set<(data: unknown) => void>>();
  private patternSubs: PatternSub[] = [];
  // Outbound buffer for events emitted while disconnected
  private outboundBuffer: Array<{ name: string; data: unknown }> = [];

  constructor(private readonly host: EventHost) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Public EventsInterface

  emit(eventName: string, data?: unknown): void {
    if (!isValidEventName(eventName)) {
      throw new PeerError(
        PeerErrorCode.InvalidPattern,
        `Invalid event name: "${eventName}"`,
      );
    }
    if (this.host.state === "active") {
      this.sendEvent(eventName, data);
      return;
    }
    if (this.host.state === "closed") return;

    // Buffer for later delivery (maxBufferedEvents: 0 disables buffering)
    const max = this.host.eventPolicy.maxBufferedEvents;
    if (max === 0) return;
    if (this.outboundBuffer.length >= max) {
      this.outboundBuffer.shift(); // evict oldest
    }
    this.outboundBuffer.push({ name: eventName, data });
  }

  on(eventName: string, handler: (data: unknown) => void): Unsubscribe {
    if (!isValidEventName(eventName)) {
      throw new PeerError(
        PeerErrorCode.InvalidPattern,
        `Invalid event name: "${eventName}" — use onPattern() for wildcard subscriptions`,
      );
    }
    let subs = this.exactSubs.get(eventName);
    if (!subs) {
      subs = new Set();
      this.exactSubs.set(eventName, subs);
    }
    subs.add(handler);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      subs!.delete(handler);
      if (subs!.size === 0) this.exactSubs.delete(eventName);
    };
  }

  onPattern(
    pattern: string,
    handler: (eventName: string, data: unknown) => void,
  ): PatternSubscription {
    validatePattern(pattern); // throws PeerError on invalid
    const sub: PatternSub = { pattern, handler };
    this.patternSubs.push(sub);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const idx = this.patternSubs.indexOf(sub);
      if (idx !== -1) this.patternSubs.splice(idx, 1);
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Called by the hosting peer on lifecycle transitions

  /** Flush buffered outbound events now that the peer is active. */
  flushBuffer(): void {
    const buffered = this.outboundBuffer.splice(0);
    for (const { name, data } of buffered) {
      this.sendEvent(name, data);
    }
  }

  /** Discard outbound buffer on close (no errors emitted per spec). */
  onClosed(): void {
    this.outboundBuffer = [];
  }

  /** Dispatch an inbound event message frame. */
  async handleFrame(frame: MessageFrame): Promise<void> {
    let envelope;
    try {
      envelope = decodeRpcEnvelope(frame.data);
    } catch (err) {
      this.host.onUnhandledError(
        err instanceof Error ? err : new Error(String(err)),
      );
      return;
    }

    if (!isRpcNotification(envelope)) return; // unexpected type on event channel

    const eventName = envelope.e;
    const data = envelope.d;

    const subs = this.exactSubs.get(eventName);
    if (subs) {
      // Snapshot: handlers may unsubscribe synchronously during dispatch
      for (const handler of [...subs]) {
        this.invokeHandler(() => handler(data));
      }
    }

    for (const sub of [...this.patternSubs]) {
      if (matchPattern(sub.pattern, eventName)) {
        this.invokeHandler(() => sub.handler(eventName, data));
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private

  // Invoke a handler, catching both synchronous throws and async rejections so
  // that `async (data) => { await ... }` handlers never produce unhandled
  // Promise rejections that crash the process. Thenable check covers cross-realm
  // promises and userland promise implementations that fail instanceof.
  private invokeHandler(fn: () => unknown): void {
    try {
      const result = fn();
      if (
        result !== null &&
        result !== undefined &&
        typeof (result as { then?: unknown }).then === "function"
      ) {
        (result as Promise<unknown>).catch((err) =>
          this.host.onUnhandledError(
            err instanceof Error ? err : new Error(String(err)),
          ),
        );
      }
    } catch (err) {
      this.host.onUnhandledError(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  private sendEvent(name: string, data: unknown): void {
    const envelope = createRpcNotification(name, data);
    const encoded = encodeRpcEnvelope(envelope);
    const frame = createMessageFrame(EVENT_SUBJECT, encoded);
    this.host.sendRaw(encodeFrame(frame)).catch((err: unknown) => {
      // Fire-and-forget: suppress race-at-disconnect errors (expected when the
      // connection drops between the state check and the actual send).
      if (
        err instanceof PeerError &&
        (err.code === PeerErrorCode.NotConnected ||
          err.code === PeerErrorCode.PeerClosed)
      ) {
        return;
      }
      this.host.onUnhandledError(
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  }
}
