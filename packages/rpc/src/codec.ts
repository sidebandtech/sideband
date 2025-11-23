// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RPC envelope codec (serialization and deserialization).
 *
 * Supports JSON encoding (v1, always available).
 * CBOR encoding can be added when Bun's built-in or lightweight CBOR support is available.
 *
 * See ADR-006 and ADR-010 for the envelope specification.
 */

import type { RpcEnvelope } from "./envelope.js";
import {
  frameIdFromHex,
  frameIdToHex,
  ProtocolError,
  ErrorCode,
} from "@sideband/protocol";

export type EncodingFormat = "json";

/**
 * Encode an RPC envelope to bytes using the specified format.
 *
 * Currently only JSON is supported in v1.
 * Future: CBOR encoding (more compact, faster).
 *
 * @param envelope The RPC envelope to encode
 * @param format The encoding format ("json")
 * @returns Encoded bytes
 */
export function encodeRpcEnvelope(
  envelope: RpcEnvelope,
  format: EncodingFormat = "json",
): Uint8Array {
  if (format === "json") {
    return encodeJson(envelope);
  }

  throw new ProtocolError(
    `Unsupported encoding format: ${format}`,
    ErrorCode.ProtocolViolation,
  );
}

/**
 * Decode bytes to an RPC envelope using the specified format.
 *
 * Currently only JSON is supported in v1.
 * Future: CBOR decoding.
 *
 * @param data The encoded bytes
 * @param format The encoding format ("json")
 * @returns The decoded RPC envelope
 * @throws {ProtocolError} if decoding fails or envelope is malformed
 */
export function decodeRpcEnvelope(
  data: Uint8Array | ArrayBufferView,
  format: EncodingFormat = "json",
): RpcEnvelope {
  if (format === "json") {
    return decodeJson(data);
  }

  throw new ProtocolError(
    `Unsupported encoding format: ${format}`,
    ErrorCode.ProtocolViolation,
  );
}

/**
 * Encode to JSON.
 * Converts FrameId (Uint8Array) to hex string for JSON serialization.
 */
function encodeJson(envelope: RpcEnvelope): Uint8Array {
  try {
    // Convert FrameId to hex string for JSON serialization
    const envelopeForJson = { ...envelope };
    if ("cid" in envelope) {
      (envelopeForJson as any).cid = frameIdToHex(envelope.cid);
    }
    const json = JSON.stringify(envelopeForJson);
    const encoder = new TextEncoder();
    return encoder.encode(json);
  } catch (err) {
    throw new ProtocolError(
      `Failed to JSON-encode RPC envelope: ${
        err instanceof Error ? err.message : String(err)
      }`,
      ErrorCode.ProtocolViolation,
    );
  }
}

/**
 * Decode from JSON.
 * Converts hex string cid back to FrameId (Uint8Array).
 */
function decodeJson(data: Uint8Array | ArrayBufferView): RpcEnvelope {
  try {
    // Convert to Uint8Array if needed
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    const decoder = new TextDecoder();
    const json = decoder.decode(bytes);
    const envelope = JSON.parse(json);

    // Validate envelope structure
    validateEnvelopeStructure(envelope);

    // Convert cid hex string back to FrameId
    if ("cid" in envelope && typeof envelope.cid === "string") {
      try {
        (envelope as any).cid = frameIdFromHex(envelope.cid);
      } catch (err) {
        throw new ProtocolError(
          `Invalid cid hex value: ${envelope.cid}`,
          ErrorCode.ProtocolViolation,
        );
      }
    }

    return envelope as RpcEnvelope;
  } catch (err) {
    if (err instanceof ProtocolError) {
      throw err;
    }
    throw new ProtocolError(
      `Failed to JSON-decode RPC envelope: ${
        err instanceof Error ? err.message : String(err)
      }`,
      ErrorCode.ProtocolViolation,
    );
  }
}

/**
 * Check if a string is a valid hex-encoded FrameId (32 hex characters = 16 bytes).
 */
function isValidHexFrameId(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  // FrameId is 16 bytes = 32 hex characters
  return /^[0-9a-f]{32}$/i.test(value);
}

/**
 * Validate envelope structure at runtime.
 * Ensures the decoded object matches RpcEnvelope schema.
 */
function validateEnvelopeStructure(obj: unknown): void {
  if (typeof obj !== "object" || obj === null) {
    throw new ProtocolError(
      "RPC envelope must be an object, got " + typeof obj,
      ErrorCode.ProtocolViolation,
    );
  }

  const envelope = obj as Record<string, unknown>;

  // Check discriminant
  const t = envelope.t;
  if (typeof t !== "string" || !["r", "R", "E", "N"].includes(t)) {
    throw new ProtocolError(
      `Invalid envelope type: "${t}". Must be one of: "r", "R", "E", "N"`,
      ErrorCode.ProtocolViolation,
    );
  }

  // Validate cid for request/response envelopes (required for correlation)
  const t_char = t as string;
  if (t_char === "r" || t_char === "R" || t_char === "E") {
    // Request and responses must have cid (correlation ID)
    if (typeof envelope.cid !== "string" || !isValidHexFrameId(envelope.cid)) {
      throw new ProtocolError(
        `${t === "r" ? "Request" : "Response"} envelope missing or invalid cid (must be 32-char hex): ${envelope.cid}`,
        ErrorCode.ProtocolViolation,
      );
    }
  }

  // Type-specific validation
  switch (t) {
    case "r": {
      // Request: must have method (m)
      if (typeof envelope.m !== "string") {
        throw new ProtocolError(
          `Request envelope missing or invalid method: ${envelope.m}`,
          ErrorCode.ProtocolViolation,
        );
      }
      break;
    }
    case "R": {
      // Success response: result is optional by spec
      // cid validation already done above
      break;
    }
    case "E": {
      // Error response: must have code and message
      if (typeof envelope.code !== "number") {
        throw new ProtocolError(
          `Error response missing or invalid code: ${envelope.code}`,
          ErrorCode.ProtocolViolation,
        );
      }
      if (typeof envelope.message !== "string") {
        throw new ProtocolError(
          `Error response missing or invalid message: ${envelope.message}`,
          ErrorCode.ProtocolViolation,
        );
      }
      break;
    }
    case "N": {
      // Notification: must have event name (e), no cid needed
      if (typeof envelope.e !== "string") {
        throw new ProtocolError(
          `Notification envelope missing or invalid event: ${envelope.e}`,
          ErrorCode.ProtocolViolation,
        );
      }
      break;
    }
  }
}
