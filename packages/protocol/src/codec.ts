// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Frame,
  ControlFrame,
  MessageFrame,
  AckFrame,
  ErrorFrame,
} from "./frames.js";
import { FrameKind, ControlOp, ErrorCode } from "./constants.js";
import { ProtocolError } from "./error.js";
import type { FrameId } from "./types.js";
import { asFrameId } from "./types.js";

/**
 * Binary codec for frames.
 * Format (little-endian):
 *   - 1 byte: frame type
 *   - 1 byte: frame flags (bit 0: has frameId, bit 1: has ts)
 *   - Optional 16 bytes: frame ID (if flag 0 set)
 *   - Optional 8 bytes: timestamp (if flag 1 set)
 *   - Remaining: payload (type-specific)
 */

const FRAME_TYPE_OFFSET = 0;
const FLAGS_OFFSET = 1;
const HEADER_SIZE = 2;
const FRAME_ID_SIZE = 16;
const TIMESTAMP_SIZE = 8;

const FLAG_HAS_FRAME_ID = 0b01;
const FLAG_HAS_TS = 0b10;

/**
 * Encode a frame to bytes.
 */
export function encodeFrame(frame: Frame): Uint8Array {
  const hasFrameId = frame.frameId !== undefined;
  const hasTs = frame.timestamp !== undefined;

  let flags = 0;
  if (hasFrameId) flags |= FLAG_HAS_FRAME_ID;
  if (hasTs) flags |= FLAG_HAS_TS;

  const payloadBytes = encodeFramePayload(frame);
  const totalSize =
    HEADER_SIZE +
    (hasFrameId ? FRAME_ID_SIZE : 0) +
    (hasTs ? TIMESTAMP_SIZE : 0) +
    payloadBytes.length;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  let offset = 0;
  view.setUint8(offset, frame.kind);
  offset += 1;
  view.setUint8(offset, flags);
  offset += 1;

  if (hasFrameId) {
    const frameIdStr = frame.frameId as string;
    const frameIdBytes = new TextEncoder().encode(frameIdStr.slice(0, 16).padEnd(16));
    buffer.set(frameIdBytes, offset);
    offset += FRAME_ID_SIZE;
  }

  if (hasTs) {
    view.setBigInt64(offset, BigInt(frame.timestamp || 0), true);
    offset += TIMESTAMP_SIZE;
  }

  buffer.set(payloadBytes, offset);
  return buffer;
}

/**
 * Decode a frame from bytes.
 */
export function decodeFrame(buffer: Uint8Array): Frame {
  if (buffer.length < HEADER_SIZE) {
    throw new ProtocolError("Invalid frame: too short", ErrorCode.InvalidFrame);
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
  const frameKind = view.getUint8(FRAME_TYPE_OFFSET) as FrameKind;
  const flags = view.getUint8(FLAGS_OFFSET);

  const hasFrameId = (flags & FLAG_HAS_FRAME_ID) !== 0;
  const hasTs = (flags & FLAG_HAS_TS) !== 0;

  let offset = HEADER_SIZE;

  let frameId: FrameId | undefined;
  if (hasFrameId) {
    if (buffer.length < offset + FRAME_ID_SIZE) {
      throw new ProtocolError(
        "Invalid frame: incomplete frame ID",
        ErrorCode.InvalidFrame
      );
    }
    const frameIdBytes = buffer.slice(offset, offset + FRAME_ID_SIZE);
    const frameIdStr = new TextDecoder().decode(frameIdBytes).trim();
    frameId = asFrameId(frameIdStr);
    offset += FRAME_ID_SIZE;
  }

  let timestamp: number | undefined;
  if (hasTs) {
    if (buffer.length < offset + TIMESTAMP_SIZE) {
      throw new ProtocolError(
        "Invalid frame: incomplete timestamp",
        ErrorCode.InvalidFrame
      );
    }
    timestamp = Number(view.getBigInt64(offset, true));
    offset += TIMESTAMP_SIZE;
  }

  const payload = buffer.slice(offset);
  return decodeFramePayload(frameKind, payload, { frameId, timestamp });
}

/**
 * Encode the payload portion of a frame (type-specific).
 */
function encodeFramePayload(frame: Frame): Uint8Array {
  switch (frame.kind) {
    case FrameKind.Control: {
      const cf = frame as ControlFrame;
      const header = new Uint8Array([cf.op]);
      const data = cf.data || new Uint8Array();
      const result = new Uint8Array(header.length + data.length);
      result.set(header);
      result.set(data, header.length);
      return result;
    }

    case FrameKind.Message: {
      const mf = frame as MessageFrame;
      const subjectBytes = new TextEncoder().encode(mf.subject);
      const subjectLenBytes = new Uint8Array(4);
      new DataView(subjectLenBytes.buffer).setUint32(0, subjectBytes.length, true);
      const result = new Uint8Array(
        subjectLenBytes.length + subjectBytes.length + mf.data.length
      );
      result.set(subjectLenBytes);
      result.set(subjectBytes, subjectLenBytes.length);
      result.set(mf.data, subjectLenBytes.length + subjectBytes.length);
      return result;
    }

    case FrameKind.Ack: {
      const af = frame as AckFrame;
      const ackFrameIdStr = af.ackFrameId as string;
      return new TextEncoder().encode(ackFrameIdStr.slice(0, 16).padEnd(16));
    }

    case FrameKind.Error: {
      const ef = frame as ErrorFrame;
      const codeBytes = new Uint8Array(2);
      new DataView(codeBytes.buffer).setUint16(0, ef.code, true);
      const msgBytes = new TextEncoder().encode(ef.message);
      const msgLenBytes = new Uint8Array(4);
      new DataView(msgLenBytes.buffer).setUint32(0, msgBytes.length, true);
      const result = new Uint8Array(
        2 + 4 + msgBytes.length + (ef.details?.length || 0)
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
  base: { frameId?: FrameId; timestamp?: number }
): Frame {
  switch (frameKind) {
    case FrameKind.Control: {
      if (payload.length < 1) {
        throw new ProtocolError(
          "Invalid control frame: no operation",
          ErrorCode.InvalidFrame
        );
      }
      const op = payload[0] as ControlOp;
      const framePayload = payload.length > 1 ? payload.slice(1) : undefined;
      return { kind: FrameKind.Control, op, data: framePayload, ...base };
    }

    case FrameKind.Message: {
      if (payload.length < 4) {
        throw new ProtocolError(
          "Invalid message frame: no subject",
          ErrorCode.InvalidFrame
        );
      }
      const view = new DataView(payload.buffer, payload.byteOffset);
      const subjectLen = view.getUint32(0, true);
      if (payload.length < 4 + subjectLen) {
        throw new ProtocolError(
          "Invalid message frame: incomplete subject",
          ErrorCode.InvalidFrame
        );
      }
      const subject = new TextDecoder().decode(payload.slice(4, 4 + subjectLen));
      const framePayload = payload.slice(4 + subjectLen);
      return { kind: FrameKind.Message, subject, data: framePayload, ...base };
    }

    case FrameKind.Ack: {
      if (payload.length < 16) {
        throw new ProtocolError(
          "Invalid ack frame: no frame ID",
          ErrorCode.InvalidFrame
        );
      }
      const ackFrameIdStr = new TextDecoder().decode(payload.slice(0, 16)).trim();
      const ackFrameId = asFrameId(ackFrameIdStr);
      return { kind: FrameKind.Ack, ackFrameId, ...base };
    }

    case FrameKind.Error: {
      if (payload.length < 6) {
        throw new ProtocolError(
          "Invalid error frame: no code or message",
          ErrorCode.InvalidFrame
        );
      }
      const view = new DataView(payload.buffer, payload.byteOffset);
      const code = view.getUint16(0, true) as ErrorCode;
      const msgLen = view.getUint32(2, true);
      if (payload.length < 6 + msgLen) {
        throw new ProtocolError(
          "Invalid error frame: incomplete message",
          ErrorCode.InvalidFrame
        );
      }
      const message = new TextDecoder().decode(payload.slice(6, 6 + msgLen));
      const framePayload =
        payload.length > 6 + msgLen ? payload.slice(6 + msgLen) : undefined;
      return { kind: FrameKind.Error, code, message, details: framePayload, ...base };
    }

    default:
      throw new ProtocolError("Unknown frame kind", ErrorCode.InvalidFrame);
  }
}
