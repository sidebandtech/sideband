// SPDX-License-Identifier: Apache-2.0

import {
  type PeerId,
  createCloseFrame,
  createHandshakeFrame,
  decodeFrame,
  decodeHandshake,
  encodeFrame,
  encodeHandshake,
  ErrorCode,
  FrameKind,
  isHandshakeFrame,
  ProtocolError,
} from "@sideband/protocol";
import type {
  CloseOptions,
  NegotiationResult,
  Negotiator,
  TransportConnection,
} from "../session/types.js";

export interface SbpNegotiatorOptions {
  peerId: PeerId;
  capabilities?: string[];
  metadata?: Record<string, string>;
  handshakeTimeoutMs?: number;
}

/**
 * SBP Negotiator - Simple handshake exchange.
 *
 * Sequence:
 * 1. Send Handshake frame with local peerId
 * 2. Receive Handshake frame with remote peerId
 * 3. Return NegotiationResult
 */
export class SbpNegotiator implements Negotiator {
  private readonly peerId: PeerId;
  private readonly capabilities: string[];
  private readonly metadata: Record<string, string>;
  private readonly handshakeTimeoutMs: number;

  constructor(options: SbpNegotiatorOptions) {
    this.peerId = options.peerId;
    this.capabilities = options.capabilities ?? [];
    this.metadata = options.metadata ?? {};
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 30000;
  }

  async negotiate(conn: TransportConnection): Promise<NegotiationResult> {
    // Create and send handshake
    const handshakePayload = encodeHandshake({
      protocol: "sideband",
      version: "1",
      peerId: this.peerId,
      caps: this.capabilities,
      metadata: this.metadata,
    });
    const handshakeFrame = createHandshakeFrame(handshakePayload);
    await conn.send(encodeFrame(handshakeFrame));

    // Wait for response with timeout
    let timeoutId: any;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => resolve("timeout"), this.handshakeTimeoutMs);
    });

    const receivePromise = this.receiveHandshake(conn);
    // Prevent unhandled rejection if timeout wins the race
    receivePromise.catch(() => {});

    try {
      const result = await Promise.race([receivePromise, timeoutPromise]);

      if (result === "timeout") {
        throw new ProtocolError(
          "Handshake timeout",
          ErrorCode.ProtocolViolation,
        );
      }

      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async receiveHandshake(
    conn: TransportConnection,
  ): Promise<NegotiationResult> {
    for await (const bytes of conn.inbound) {
      const frame = decodeFrame(bytes);

      if (!isHandshakeFrame(frame)) {
        throw new ProtocolError(
          "Expected Handshake frame, received " + FrameKind[frame.kind],
          ErrorCode.ProtocolViolation,
        );
      }

      const payload = decodeHandshake(frame.data);

      return {
        peerId: payload.peerId,
        capabilities: payload.caps ?? [],
        metadata: (payload.metadata as Record<string, string>) ?? {},
      };
    }

    throw new ProtocolError(
      "Connection closed before handshake",
      ErrorCode.ProtocolViolation,
    );
  }

  async terminate(
    conn: TransportConnection,
    options?: CloseOptions,
  ): Promise<void> {
    try {
      const reasonBytes = options?.reason
        ? new TextEncoder().encode(options.reason)
        : undefined;
      const closeFrame = createCloseFrame(reasonBytes);
      await conn.send(encodeFrame(closeFrame));
    } catch {
      // Ignore errors during terminate (connection may already be closed)
    }
  }

  classifyError(error: Error): "fatal" | "retryable" {
    if (error instanceof ProtocolError) {
      // Protocol violations and version mismatches are fatal per SBP spec
      if (
        error.code === ErrorCode.ProtocolViolation ||
        error.code === ErrorCode.UnsupportedVersion
      ) {
        return "fatal";
      }
    }
    // Network/transport errors are retryable
    return "retryable";
  }
}
