// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Frame,
  ControlFrame,
  HandshakeControlFrame,
  PingControlFrame,
  PongControlFrame,
  CloseControlFrame,
  MessageFrame,
  AckFrame,
  ErrorFrame,
} from "./frames.js";
import { FrameKind, ControlOp, ErrorCode } from "./constants.js";
import { ProtocolError } from "./error.js";
import type { FrameId } from "./types.js";
import { asFrameId, asSubject } from "./types.js";

/**
 * Binary codec for frames.
 * Format (little-endian):
 *   - 1 byte: frame type (FrameKind)
 *   - 1 byte: frame flags (reserved; must be 0)
 *   - 16 bytes: frame ID (always present, opaque binary)
 *   - Remaining: payload (type-specific)
 */

const FRAME_TYPE_OFFSET = 0;
const FLAGS_OFFSET = 1;
const HEADER_SIZE = 2;
const FRAME_ID_SIZE = 16;
const HEADER_WITH_FRAME_ID_SIZE = HEADER_SIZE + FRAME_ID_SIZE;

/**
 * Encode a frame to bytes.
 */
export function encodeFrame(frame: Frame): Uint8Array {
  const flags = 0; // reserved for future use

  const payloadBytes = encodeFramePayload(frame);
  const totalSize = HEADER_WITH_FRAME_ID_SIZE + payloadBytes.length;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  let offset = 0;
  view.setUint8(offset, frame.kind);
  offset += 1;
  view.setUint8(offset, flags);
  offset += 1;

  // frameId is always present, opaque 16 bytes
  buffer.set(frame.frameId, offset);
  offset += FRAME_ID_SIZE;

  buffer.set(payloadBytes, offset);
  return buffer;
}

/**
 * Decode a frame from bytes.
 * Returns a deeply readonly frame to prevent accidental mutation.
 * See ADR 007 for immutability rationale.
 */
export function decodeFrame(buffer: Uint8Array): Readonly<Frame> {
  if (buffer.length < HEADER_WITH_FRAME_ID_SIZE) {
    throw new ProtocolError("Invalid frame: too short", ErrorCode.InvalidFrame);
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
  const frameKind = view.getUint8(FRAME_TYPE_OFFSET) as FrameKind;
  const flags = view.getUint8(FLAGS_OFFSET);

  // flags is reserved for future use; validate it's zero for now
  if (flags !== 0) {
    throw new ProtocolError(
      "Invalid frame: unexpected flags",
      ErrorCode.InvalidFrame,
    );
  }

  let offset = HEADER_SIZE;

  // frameId is always present, opaque 16 bytes
  if (buffer.length < offset + FRAME_ID_SIZE) {
    throw new ProtocolError(
      "Invalid frame: incomplete frame ID",
      ErrorCode.InvalidFrame,
    );
  }
  const frameIdBytes = buffer.slice(offset, offset + FRAME_ID_SIZE);
  const frameId = asFrameId(frameIdBytes);
  offset += FRAME_ID_SIZE;

  const payload = buffer.slice(offset);
  return decodeFramePayload(frameKind, payload, { frameId });
}

/**
 * Encode the payload portion of a frame (type-specific).
 */
function encodeFramePayload(frame: Frame): Uint8Array {
  const encodeString = (str: string): Uint8Array => {
    return globalThis.TextEncoder
      ? new (globalThis.TextEncoder as any)().encode(str)
      : new Uint8Array(str.split("").map((c) => c.charCodeAt(0)));
  };

  switch (frame.kind) {
    case FrameKind.Control: {
      const cf = frame as ControlFrame;
      const opByte = new Uint8Array([cf.op]);

      // Per ADR 002, control ops have specific data invariants:
      // Handshake and Close may have data; Ping/Pong must not.
      switch (cf.op) {
        case ControlOp.Handshake: {
          // Handshake requires data (JSON-encoded HandshakePayload)
          const hcf = cf as HandshakeControlFrame;
          if (!hcf.data || hcf.data.length === 0) {
            throw new ProtocolError(
              "Invalid handshake frame: data is required",
              ErrorCode.InvalidFrame,
            );
          }
          const result = new Uint8Array(opByte.length + hcf.data.length);
          result.set(opByte);
          result.set(hcf.data, opByte.length);
          return result;
        }

        case ControlOp.Ping:
        case ControlOp.Pong: {
          // Ping/Pong must not carry payload
          const pcf = cf as PingControlFrame | PongControlFrame;
          if (pcf.data !== undefined) {
            throw new ProtocolError(
              "Invalid ping/pong frame: must not have payload",
              ErrorCode.InvalidFrame,
            );
          }
          return opByte;
        }

        case ControlOp.Close: {
          // Close may optionally have reason bytes
          const ccf = cf as CloseControlFrame;
          if (ccf.data) {
            const result = new Uint8Array(opByte.length + ccf.data.length);
            result.set(opByte);
            result.set(ccf.data, opByte.length);
            return result;
          }
          return opByte;
        }

        default:
          // Exhaustiveness: all ControlOp variants handled above
          throw new ProtocolError("Unknown control op", ErrorCode.InvalidFrame);
      }
    }

    case FrameKind.Message: {
      const mf = frame as MessageFrame;
      const subjectBytes = encodeString(mf.subject);
      const subjectLenBytes = new Uint8Array(4);
      new DataView(subjectLenBytes.buffer).setUint32(
        0,
        subjectBytes.length,
        true,
      );
      const result = new Uint8Array(
        subjectLenBytes.length + subjectBytes.length + mf.data.length,
      );
      result.set(subjectLenBytes);
      result.set(subjectBytes, subjectLenBytes.length);
      result.set(mf.data, subjectLenBytes.length + subjectBytes.length);
      return result;
    }

    case FrameKind.Ack: {
      const af = frame as AckFrame;
      return new Uint8Array(af.ackFrameId);
    }

    case FrameKind.Error: {
      const ef = frame as ErrorFrame;
      const codeBytes = new Uint8Array(2);
      new DataView(codeBytes.buffer).setUint16(0, ef.code, true);
      const msgBytes = encodeString(ef.message);
      const msgLenBytes = new Uint8Array(4);
      new DataView(msgLenBytes.buffer).setUint32(0, msgBytes.length, true);
      const result = new Uint8Array(
        2 + 4 + msgBytes.length + (ef.details?.length || 0),
      );
      let offset = 0;
      result.set(codeBytes, offset);
      offset += 2;
      result.set(msgLenBytes, offset);
      offset += 4;
      result.set(msgBytes, offset);
      offset += msgBytes.length;
      if (ef.details) {
        result.set(ef.details, offset);
      }
      return result;
    }

    default:
      throw new ProtocolError("Unknown frame kind", ErrorCode.InvalidFrame);
  }
}

/**
 * Decode the payload portion of a frame (type-specific).
 */
function decodeFramePayload(
  frameKind: FrameKind,
  payload: Uint8Array,
  base: { frameId: FrameId },
): Frame {
  const decodeString = (bytes: Uint8Array): string => {
    return globalThis.TextDecoder
      ? new (globalThis.TextDecoder as any)().decode(bytes)
      : new Uint8Array(bytes).reduce(
          (acc, byte) => acc + String.fromCharCode(byte),
          "",
        );
  };
  switch (frameKind) {
    case FrameKind.Control: {
      if (payload.length < 1) {
        throw new ProtocolError(
          "Invalid control frame: no operation",
          ErrorCode.InvalidFrame,
        );
      }
      const op = payload[0] as ControlOp;
      const remainingPayload =
        payload.length > 1 ? payload.slice(1) : undefined;

      // Per ADR 002, validate control op invariants during decode.
      switch (op) {
        case ControlOp.Handshake: {
          // Handshake requires data (JSON-encoded HandshakePayload)
          if (!remainingPayload || remainingPayload.length === 0) {
            throw new ProtocolError(
              "Invalid handshake frame: data is required",
              ErrorCode.InvalidFrame,
            );
          }
          return {
            kind: FrameKind.Control,
            op: ControlOp.Handshake,
            data: remainingPayload,
            ...base,
          } satisfies HandshakeControlFrame;
        }

        case ControlOp.Ping: {
          // Ping must not carry payload
          if (remainingPayload !== undefined) {
            throw new ProtocolError(
              "Invalid ping/pong frame: must not have payload",
              ErrorCode.InvalidFrame,
            );
          }
          return {
            kind: FrameKind.Control,
            op: ControlOp.Ping,
            data: undefined,
            ...base,
          } satisfies PingControlFrame;
        }

        case ControlOp.Pong: {
          // Pong must not carry payload
          if (remainingPayload !== undefined) {
            throw new ProtocolError(
              "Invalid ping/pong frame: must not have payload",
              ErrorCode.InvalidFrame,
            );
          }
          return {
            kind: FrameKind.Control,
            op: ControlOp.Pong,
            data: undefined,
            ...base,
          } satisfies PongControlFrame;
        }

        case ControlOp.Close: {
          // Close may optionally have reason bytes
          return {
            kind: FrameKind.Control,
            op: ControlOp.Close,
            data: remainingPayload,
            ...base,
          } satisfies CloseControlFrame;
        }

        default:
          // Exhaustiveness: all ControlOp variants handled above
          throw new ProtocolError("Unknown control op", ErrorCode.InvalidFrame);
      }
    }

    case FrameKind.Message: {
      if (payload.length < 4) {
        throw new ProtocolError(
          "Invalid message frame: no subject",
          ErrorCode.InvalidFrame,
        );
      }
      const view = new DataView(payload.buffer, payload.byteOffset);
      const subjectLen = view.getUint32(0, true);
      if (payload.length < 4 + subjectLen) {
        throw new ProtocolError(
          "Invalid message frame: incomplete subject",
          ErrorCode.InvalidFrame,
        );
      }
      const rawSubject = decodeString(payload.slice(4, 4 + subjectLen));
      // Validate subject per ADR-006 and ADR-008
      const subject = asSubject(rawSubject);
      const framePayload = payload.slice(4 + subjectLen);
      return { kind: FrameKind.Message, subject, data: framePayload, ...base };
    }

    case FrameKind.Ack: {
      // ACK frames are exactly 16 bytes: the ackFrameId (opaque binary). No payload allowed.
      if (payload.length < 16) {
        throw new ProtocolError(
          "Invalid ack frame: no frame ID",
          ErrorCode.InvalidFrame,
        );
      }
      if (payload.length > 16) {
        throw new ProtocolError(
          "Invalid ack frame: unexpected trailing data",
          ErrorCode.InvalidFrame,
        );
      }
      const ackFrameId = asFrameId(payload.slice(0, 16));
      return { kind: FrameKind.Ack, ackFrameId, ...base };
    }

    case FrameKind.Error: {
      if (payload.length < 6) {
        throw new ProtocolError(
          "Invalid error frame: no code or message",
          ErrorCode.InvalidFrame,
        );
      }
      const view = new DataView(payload.buffer, payload.byteOffset);
      const code = view.getUint16(0, true) as ErrorCode;
      const msgLen = view.getUint32(2, true);
      if (payload.length < 6 + msgLen) {
        throw new ProtocolError(
          "Invalid error frame: incomplete message",
          ErrorCode.InvalidFrame,
        );
      }
      const message = decodeString(payload.slice(6, 6 + msgLen));
      const framePayload =
        payload.length > 6 + msgLen ? payload.slice(6 + msgLen) : undefined;
      return {
        kind: FrameKind.Error,
        code,
        message,
        details: framePayload,
        ...base,
      };
    }

    default:
      throw new ProtocolError("Unknown frame kind", ErrorCode.InvalidFrame);
  }
}
