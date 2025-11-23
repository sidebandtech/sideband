// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ErrorCode } from "./constants.js";
import { ProtocolError } from "./error.js";

/**
 * Branded types for compile-time safety without runtime overhead.
 */

type Brand<T, B> = T & { readonly __brand: B };

/**
 * Unique identifier for a peer.
 */
export type PeerId = Brand<string, "PeerId">;

/**
 * Unique identifier for a connection between peers.
 */
export type ConnectionId = Brand<string, "ConnectionId">;

/**
 * Unique identifier for a frame instance on the wire.
 * In v1, this ID is used for request/response correlation and ACK linkage.
 * Reserved CorrelationId for v2 multi-hop tracing semantics.
 * FrameId is 16 opaque bytes (128 bits) of cryptographic randomness, generated via crypto.getRandomValues().
 *
 * **Important**: FrameId is opaque entropy with no semantic bits or structure.
 * Decoders MUST NOT interpret any bits within FrameId.
 * Validation is length-only (must be exactly 16 bytes).
 *
 * Frame header flags (byte 1 of the envelope) are separate from FrameId.
 * See ADR-001, ADR-004, and protocol-wire-format.md for details.
 */
export type FrameId = Uint8Array & { readonly __brand: "FrameId" };

/**
 * Unique identifier for correlating request/response pairs (reserved for v2).
 * In v1, frameId serves this purpose.
 */
export type CorrelationId = Brand<string, "CorrelationId">;

/**
 * Unique identifier for a logical stream within a connection.
 */
export type StreamId = Brand<string, "StreamId">;

/**
 * Subject (routing key) for MessageFrame.
 * Must start with one of the reserved prefixes: "rpc/", "event/", "stream/", "app/".
 * Per ADR-006, all subjects are namespaced to prevent collisions and disambiguate intent.
 */
export type Subject = Brand<string, "Subject">;

/**
 * Helper to create branded types at runtime.
 */
export function asPeerId(value: string): PeerId {
  return value as PeerId;
}

export function asConnectionId(value: string): ConnectionId {
  return value as ConnectionId;
}

/**
 * Brand a Uint8Array as a valid FrameId.
 * Per ADR-004 and protocol-wire-format, FrameId is opaque entropy with no semantic bits.
 * Validation is length-only; FrameId bytes are treated as raw binary and never interpreted.
 *
 * @param value The bytes to validate
 * @returns The branded FrameId
 * @throws {ProtocolError} with code InvalidFrame if value is not exactly 16 bytes
 */
export function asFrameId(value: Uint8Array): FrameId {
  if (value.length !== 16) {
    throw new ProtocolError(
      `FrameId must be exactly 16 bytes, got ${value.length}`,
      ErrorCode.InvalidFrame,
    );
  }
  return value as FrameId;
}

export function asCorrelationId(value: string): CorrelationId {
  return value as CorrelationId;
}

export function asStreamId(value: string): StreamId {
  return value as StreamId;
}

/**
 * Reserved subject prefixes per ADR-006 and ADR-008.
 * All MessageFrame subjects must start with one of these.
 */
const RESERVED_SUBJECT_PREFIXES = [
  "rpc/",
  "event/",
  "stream/",
  "app/",
] as const;

/**
 * Maximum length of a subject in UTF-8 bytes.
 * Used to prevent unbounded memory allocations and enforce protocol limits.
 */
export const MAX_SUBJECT_BYTES = 256;

/**
 * Validate and brand a subject string.
 *
 * A valid subject:
 * - Must be 1–MAX_SUBJECT_BYTES UTF-8 bytes in length
 * - Must not contain null bytes
 * - Must start with one of the reserved prefixes: "rpc/", "event/", "stream/", "app/"
 *
 * Violations throw ProtocolError with code ProtocolViolation.
 * This enforces the wire contract defined in ADR-006 and ADR-008.
 *
 * @param value The subject string to validate
 * @returns The branded subject if valid
 * @throws {ProtocolError} with code ProtocolViolation if invalid
 */
export function asSubject(value: string): Subject {
  if (typeof value !== "string") {
    throw new ProtocolError(
      "Subject must be a string",
      ErrorCode.ProtocolViolation,
    );
  }

  if (value.includes("\0")) {
    throw new ProtocolError(
      "Subject must not contain null bytes",
      ErrorCode.ProtocolViolation,
    );
  }

  // Measure UTF-8 byte length (not JavaScript string length)
  const utf8Bytes = new TextEncoder().encode(value);
  if (utf8Bytes.byteLength === 0) {
    throw new ProtocolError(
      "Subject must not be empty",
      ErrorCode.ProtocolViolation,
    );
  }
  if (utf8Bytes.byteLength > MAX_SUBJECT_BYTES) {
    throw new ProtocolError(
      `Subject exceeds ${MAX_SUBJECT_BYTES} UTF-8 bytes (got ${utf8Bytes.byteLength})`,
      ErrorCode.ProtocolViolation,
    );
  }

  // Check reserved prefix
  const hasValidPrefix = RESERVED_SUBJECT_PREFIXES.some((p) =>
    value.startsWith(p),
  );
  if (!hasValidPrefix) {
    throw new ProtocolError(
      `Subject must start with one of: ${RESERVED_SUBJECT_PREFIXES.join(
        ", ",
      )} (got "${value}")`,
      ErrorCode.ProtocolViolation,
    );
  }

  return value as Subject;
}

/**
 * Generate a unique FrameId for a new frame instance.
 * Uses 16 bytes (128 bits) of cryptographic randomness.
 * Collision probability is astronomically low across any practical system.
 */
export function generateFrameId(): FrameId {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return asFrameId(bytes);
}

/**
 * Convert FrameId to lowercase hex string (32 chars).
 * Suitable for logging, JSON, and human-readable contexts.
 */
export function frameIdToHex(id: FrameId): string {
  return Array.from(id)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert lowercase hex string (32 chars) to FrameId.
 * Inverse of frameIdToHex; validates 32-char hex format.
 */
export function frameIdFromHex(hex: string): FrameId {
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(
      "FrameId hex must be 32 lowercase hex chars (0-9a-f), got: " + hex,
    );
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return asFrameId(bytes);
}
