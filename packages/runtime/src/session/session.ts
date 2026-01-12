// SPDX-License-Identifier: Apache-2.0

import type { Frame, PeerId } from "@sideband/protocol";
import { decodeFrame, encodeFrame } from "@sideband/protocol";
import type { SessionState, Unsubscribe, VerifiedIdentity } from "../types.js";
import { calculateBackoff } from "./backoff.js";
import type {
  CloseOptions,
  Negotiator,
  RetryPolicy,
  SessionChannel,
  SessionEvents,
  TransportConnection,
} from "./types.js";
import { defaultRetryPolicy } from "./types.js";

/** Transport endpoint type */
export type TransportEndpoint = string;

/** Transport factory for creating connections */
export type TransportFactory = (
  endpoint: TransportEndpoint,
) => Promise<TransportConnection>;

/** Decode error handling disposition */
export type DecodeErrorAction = "ignore" | "fatal";

/** Session configuration */
export interface SessionConfig {
  endpoint: TransportEndpoint;
  transportFactory: TransportFactory;
  negotiator: Negotiator;
  retryPolicy?: Partial<RetryPolicy>;
  onFrame?: (frame: Frame) => void;
  /**
   * Hook for frame decode errors. Return "fatal" to treat as connection failure
   * (triggers retry/close), or "ignore" to skip the malformed frame (default).
   * Useful for encrypted channels where decode failure indicates crypto issues.
   */
  onDecodeError?: (error: Error, bytes: Uint8Array) => DecodeErrorAction;
}

/**
 * Active session with peer.
 *
 * Note: `state` is a snapshot at session creation time. For lifecycle changes,
 * subscribe to SessionManager events rather than polling this property.
 */
export interface Session {
  readonly peerId: PeerId;
  readonly identity?: VerifiedIdentity;
  /** Lifecycle state snapshot (use events for live updates) */
  readonly state: SessionState;
  /** Session channel for frame I/O (may be raw transport or wrapped with encryption) */
  readonly channel: SessionChannel;
  /** Send an SBP frame (preferred API - type-safe, enforces frame structure) */
  sendFrame(frame: Frame): Promise<void>;
  /**
   * Send raw bytes (expert-only escape hatch).
   *
   * Normative: Callers MUST ensure data is a complete, valid SBP frame.
   * Misuse MAY result in protocol violations or undefined behavior.
   * Prefer sendFrame() for type-safe frame transmission.
   */
  sendRaw(data: Uint8Array): Promise<void>;
}

type EventHandler<K extends keyof SessionEvents> = (
  data: SessionEvents[K],
) => void;

/**
 * Session manager per ADR-009.
 * Manages connection lifecycle: Idle -> Connecting -> Negotiating -> Active -> RetryWait
 */
export class SessionManager {
  private _state: SessionState = "idle";
  private transport?: TransportConnection;
  private channel?: SessionChannel;
  private peerId?: PeerId;
  private identity?: VerifiedIdentity;
  private retryAttempt = 0;
  private retryTimeout?: ReturnType<typeof setTimeout>;
  private retryReject?: (reason: Error) => void;
  private terminated = false;
  private readonly eventHandlers = new Map<
    keyof SessionEvents,
    Set<EventHandler<any>>
  >();

  private readonly config: SessionConfig;
  private readonly retryPolicy: RetryPolicy;

  constructor(config: SessionConfig) {
    this.config = config;
    this.retryPolicy = { ...defaultRetryPolicy, ...config.retryPolicy };
  }

  get state(): SessionState {
    return this._state;
  }

  /**
   * Start the session connection.
   */
  async connect(): Promise<Session> {
    if (this._state !== "idle") {
      throw new Error(`Cannot connect from state: ${this._state}`);
    }

    this.terminated = false;
    return this.attemptConnection();
  }

  private async attemptConnection(): Promise<Session> {
    // Connecting
    this.setState("connecting");
    this.emit("connecting", { endpoint: this.config.endpoint });

    try {
      // Create transport
      this.transport = await this.config.transportFactory(this.config.endpoint);

      // Guard: terminate() may have been called while awaiting transport creation.
      // Close the newly created transport and abort before negotiation.
      if (this.terminated) {
        await this.transport.close({ reason: "terminated" }).catch(() => {});
        this.setState("idle");
        throw new Error("Session terminated");
      }

      // Negotiating
      this.setState("negotiating");
      this.emit("negotiating", { transport: this.transport });

      // Run negotiator
      const result = await this.config.negotiator.negotiate(this.transport);
      this.peerId = result.peerId;
      this.identity = result.identity;

      // Use channel if negotiator provided one (e.g., for SBRP encryption)
      this.channel = result.channel ?? this.transport;

      // Active
      this.setState("active");
      this.retryAttempt = 0;
      this.emit("active", {
        peerId: result.peerId,
        capabilities: result.capabilities,
      });

      if (result.identity) {
        this.emit("identity_established", {
          identity: result.identity,
          trusted: false,
        });
      }

      // Start frame processing on the channel
      this.processFrames(this.channel);

      return this.createSession();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return this.handleError(error);
    }
  }

  private async handleError(error: Error): Promise<Session> {
    // Check if terminated
    if (this.terminated) {
      this.setState("idle");
      this.emit("closed", {
        reason: "terminated",
        graceful: true,
        fatal: false,
      });
      throw error;
    }

    // Classify error
    const classification = this.config.negotiator.classifyError(error);

    if (classification === "fatal" || this.retryPolicy.mode === "never") {
      this.setState("idle");
      this.emit("closed", {
        reason: error.message,
        graceful: false,
        fatal: classification === "fatal",
      });
      throw error;
    }

    // Check max attempts
    if (
      this.retryPolicy.maxAttempts > 0 &&
      this.retryAttempt >= this.retryPolicy.maxAttempts
    ) {
      this.setState("idle");
      this.emit("closed", {
        reason: "Max retry attempts exceeded",
        graceful: false,
        fatal: false,
      });
      throw error;
    }

    // Retry
    this.setState("retry-wait");
    const delayMs = calculateBackoff(this.retryAttempt, {
      initialDelayMs: this.retryPolicy.initialDelayMs,
      maxDelayMs: this.retryPolicy.maxDelayMs,
      maxAttempts: this.retryPolicy.maxAttempts,
      jitter: this.retryPolicy.jitter,
    });
    this.retryAttempt++;
    this.emit("retrying", {
      attempt: this.retryAttempt,
      delayMs,
      lastError: error,
    });

    // Wait and retry (delay may be cancelled via terminate())
    try {
      await this.delay(delayMs);
    } catch {
      // Delay cancelled by terminate()
      this.setState("idle");
      throw error;
    }

    if (this.terminated) {
      this.setState("idle");
      throw error;
    }

    return this.attemptConnection();
  }

  private async processFrames(channel: SessionChannel): Promise<void> {
    // Capture channel identity to prevent cross-session frame bleed.
    // If retry creates a new channel, this loop exits cleanly.
    const activeChannel = channel;

    try {
      for await (const bytes of activeChannel.inbound) {
        // Exit if session terminated or channel replaced by retry
        if (this.terminated || this.channel !== activeChannel) break;

        try {
          const frame = decodeFrame(bytes);
          this.config.onFrame?.(frame);
        } catch (err) {
          // Validation ownership: Runtime handles syntactic frame decoding only.
          // Semantic validation and ErrorFrame emission are the responsibility
          // of higher layers (Router/RPC). This boundary is intentional.
          const error = err instanceof Error ? err : new Error(String(err));
          const action = this.config.onDecodeError?.(error, bytes) ?? "ignore";
          if (action === "fatal") {
            throw error;
          }
          // Default: ignore malformed frames (log for diagnostics)
          console.warn("Failed to decode frame:", err);
        }
      }
    } catch (err) {
      // Channel-level errors (transport failure, decryption failure) are
      // classified via negotiator and may trigger retry.
      // Only handle if this is still the active channel.
      if (
        !this.terminated &&
        this._state === "active" &&
        this.channel === activeChannel
      ) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.handleError(error).catch(() => {});
      }
    }
  }

  /**
   * Terminate the session.
   */
  async terminate(options?: CloseOptions): Promise<void> {
    this.terminated = true;

    // Cancel retry timer and reject pending delay
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = undefined;
    }
    if (this.retryReject) {
      this.retryReject(new Error(options?.reason ?? "terminated"));
      this.retryReject = undefined;
    }

    // Terminate via negotiator (uses raw transport for protocol-level close)
    if (this.transport) {
      try {
        await this.config.negotiator.terminate(this.transport, options);
      } catch {
        // Ignore termination errors
      }
    }

    // Close channel if it differs from transport (session-layer cleanup)
    if (this.channel && this.channel !== this.transport) {
      try {
        await this.channel.close(options);
      } catch {
        // Ignore channel close errors
      }
    }

    // Close underlying transport
    if (this.transport) {
      try {
        await this.transport.close(options);
      } catch {
        // Ignore transport close errors
      }
    }

    this.channel = undefined;
    this.setState("idle");
    this.emit("closed", {
      reason: options?.reason ?? "terminated",
      graceful: true,
      fatal: false,
    });
  }

  /**
   * Register event handler.
   */
  on<K extends keyof SessionEvents>(
    event: K,
    handler: EventHandler<K>,
  ): Unsubscribe {
    let handlers = this.eventHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(event, handlers);
    }
    handlers.add(handler);
    return () => handlers!.delete(handler);
  }

  private emit<K extends keyof SessionEvents>(
    event: K,
    data: SessionEvents[K],
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.warn(`Event handler error for ${event}:`, err);
        }
      }
    }
  }

  private setState(state: SessionState): void {
    this._state = state;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.retryReject = reject;
      this.retryTimeout = setTimeout(() => {
        this.retryReject = undefined;
        resolve();
      }, ms);
    });
  }

  private createSession(): Session {
    if (!this.channel || !this.peerId) {
      throw new Error("Session not established");
    }

    const ch = this.channel;
    return {
      peerId: this.peerId,
      identity: this.identity,
      state: this._state,
      channel: ch,
      sendFrame: async (frame: Frame) => {
        const bytes = encodeFrame(frame);
        await ch.send(bytes);
      },
      sendRaw: async (data: Uint8Array) => {
        await ch.send(data);
      },
    };
  }
}

/**
 * Create a session manager.
 */
export function createSessionManager(config: SessionConfig): SessionManager {
  return new SessionManager(config);
}
