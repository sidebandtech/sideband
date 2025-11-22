// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PeerId } from "./types.js";
import { PROTOCOL_NAME, PROTOCOL_VERSION } from "./constants.js";
import { ProtocolError } from "./error.js";
import { ErrorCode } from "./constants.js";

/**
 * Handshake payload exchanged during connection setup.
 * Identifies peers and advertises capabilities.
 */
export interface HandshakePayload {
  protocol: typeof PROTOCOL_NAME;
  version: typeof PROTOCOL_VERSION;
  peerId: PeerId;
  caps?: string[]; // e.g. ["rpc", "stream", "compression:gzip"]
  metadata?: Record<string, unknown>;
}

/**
 * Encode handshake payload to bytes.
 * Uses JSON encoding with UTF-8.
 */
export function encodeHandshake(payload: HandshakePayload): Uint8Array {
  const json = JSON.stringify(payload);
  const encoder = new TextEncoder();
  return encoder.encode(json);
}

/**
 * Decode handshake payload from bytes.
 * Validates required fields and throws ProtocolError on invalid data.
 */
export function decodeHandshake(bytes: Uint8Array): HandshakePayload {
  try {
    const decoder = new TextDecoder();
    const json = decoder.decode(bytes);
    const data = JSON.parse(json);

    // Validate required fields
    if (typeof data.protocol !== "string") {
      throw new Error("Missing or invalid protocol field");
    }
    if (typeof data.version !== "string") {
      throw new Error("Missing or invalid version field");
    }
    if (typeof data.peerId !== "string") {
      throw new Error("Missing or invalid peerId field");
    }

    // Check protocol compatibility
    if (data.protocol !== PROTOCOL_NAME) {
      throw new ProtocolError(
        "Unsupported protocol: " + data.protocol,
        ErrorCode.UnsupportedVersion
      );
    }
    if (data.version !== PROTOCOL_VERSION) {
      throw new ProtocolError(
        "Unsupported protocol version: " + data.version,
        ErrorCode.UnsupportedVersion
      );
    }

    return data as HandshakePayload;
  } catch (err) {
    if (err instanceof ProtocolError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ProtocolError(
      "Failed to decode handshake: " + message,
      ErrorCode.InvalidFrame,
      err
    );
  }
}
