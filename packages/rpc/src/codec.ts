// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RPC envelope codec (serialization and deserialization).
 *
 * Supports JSON encoding (v1, always available).
 * CBOR encoding can be added when Bun's built-in or lightweight CBOR support is available.
 *
 * See ADR-006 for the envelope specification.
 */

import type { RpcEnvelope } from "./envelope.js";
import { ProtocolViolation } from "./subject.js";

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

  throw new ProtocolViolation(`Unsupported encoding format: ${format}`);
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
 * @throws {ProtocolViolation} if decoding fails or envelope is malformed
 */
export function decodeRpcEnvelope(
  data: Uint8Array | ArrayBufferView,
  format: EncodingFormat = "json",
): RpcEnvelope {
  if (format === "json") {
    return decodeJson(data);
  }

  throw new ProtocolViolation(`Unsupported encoding format: ${format}`);
}

/**
 * Encode to JSON.
 */
function encodeJson(envelope: RpcEnvelope): Uint8Array {
  try {
    const json = JSON.stringify(envelope);
    const encoder = new TextEncoder();
    return encoder.encode(json);
  } catch (err) {
    throw new ProtocolViolation(
      `Failed to JSON-encode RPC envelope: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Decode from JSON.
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

    return envelope as RpcEnvelope;
  } catch (err) {
    if (err instanceof ProtocolViolation) {
      throw err;
    }
    throw new ProtocolViolation(
      `Failed to JSON-decode RPC envelope: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Validate envelope structure at runtime.
 * Ensures the decoded object matches RpcEnvelope schema.
 */
function validateEnvelopeStructure(obj: unknown): void {
  if (typeof obj !== "object" || obj === null) {
    throw new ProtocolViolation(
      "RPC envelope must be an object, got " + typeof obj,
    );
  }

  const envelope = obj as Record<string, unknown>;

  // Check discriminant
  const t = envelope.t;
  if (typeof t !== "string" || !["r", "R", "E", "N"].includes(t)) {
    throw new ProtocolViolation(
      `Invalid envelope type: "${t}". Must be one of: "r", "R", "E", "N"`,
    );
  }

  // Type-specific validation
  switch (t) {
    case "r": {
      // Request: must have method (m)
      if (typeof envelope.m !== "string") {
        throw new ProtocolViolation(
          `Request envelope missing or invalid method: ${envelope.m}`,
        );
      }
      break;
    }
    case "R": {
      // Success response: must have result (optional by spec)
      // No additional validation needed
      break;
    }
    case "E": {
      // Error response: must have code and message
      if (typeof envelope.code !== "number") {
        throw new ProtocolViolation(
          `Error response missing or invalid code: ${envelope.code}`,
        );
      }
      if (typeof envelope.message !== "string") {
        throw new ProtocolViolation(
          `Error response missing or invalid message: ${envelope.message}`,
        );
      }
      break;
    }
    case "N": {
      // Notification: must have event name (e)
      if (typeof envelope.e !== "string") {
        throw new ProtocolViolation(
          `Notification envelope missing or invalid event: ${envelope.e}`,
        );
      }
      break;
    }
  }
}
