// SPDX-License-Identifier: Apache-2.0

/**
 * Binary wire format for Sideband Relay Protocol (SBRP).
 *
 * Frame structure (§13):
 * ```
 * ┌───────────┬──────────────┬────────────────┬─────────────────────┐
 * │ Type (1B) │ Length (4B)  │ SessionID (8B) │ Payload (0..64KB)   │
 * └───────────┴──────────────┴────────────────┴─────────────────────┘
 * ```
 *
 * All multi-byte integers are big-endian.
 */

import {
  ED25519_PUBLIC_KEY_LENGTH,
  ED25519_SIGNATURE_LENGTH,
  FRAME_HEADER_SIZE,
  HANDSHAKE_ACCEPT_PAYLOAD_SIZE,
  HANDSHAKE_INIT_PAYLOAD_SIZE,
  MAX_PAYLOAD_SIZE,
  MAX_PING_PAYLOAD_SIZE,
  MIN_CONTROL_PAYLOAD_SIZE,
  MIN_ENCRYPTED_PAYLOAD_SIZE,
  SIGNAL_PAYLOAD_SIZE,
  X25519_PUBLIC_KEY_LENGTH,
} from "./constants.js";
import { extractSequence } from "./crypto.js";
import type {
  EncryptedMessage,
  HandshakeAccept,
  HandshakeInit,
  SessionId,
} from "./types.js";
import { SbrpError, SbrpErrorCode, SignalCode, SignalReason } from "./types.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: false });

/**
 * Frame type discriminant (wire byte).
 *
 * Frame types are organized by authority:
 * - Endpoint frames (0x01-0x03): Forwarded by relay, E2EE
 * - Signal frame (0x04): Daemon → Relay only
 * - Keepalive frames (0x10-0x11): Connection-scoped, never forwarded
 * - Control frame (0x20): Relay → Endpoint only
 */
export const FrameType = {
  // Endpoint frames (forwarded, E2EE)
  HandshakeInit: 0x01,
  HandshakeAccept: 0x02,
  Data: 0x03, // Renamed from Encrypted for clarity

  // Signal frame (daemon → relay)
  Signal: 0x04,

  // Keepalive frames (connection-scoped, never forwarded)
  Ping: 0x10,
  Pong: 0x11,

  // Control frame (relay → endpoint)
  Control: 0x20,
} as const;

export type FrameType = (typeof FrameType)[keyof typeof FrameType];

/**
 * Wire control codes (uint16, §14).
 *
 * Codes use ranges for categorization:
 * - 0x01xx: Authentication (terminal)
 * - 0x02xx: Routing (terminal)
 * - 0x03xx: Session (terminal)
 * - 0x04xx: Wire format (terminal)
 * - 0x09xx: Throttling (varies: rate_limited=N, backpressure=T)
 * - 0x10xx: Session state (non-terminal)
 */
export const WireControlCode = {
  // Authentication (0x01xx) - Terminal
  Unauthorized: 0x0101,
  Forbidden: 0x0102,

  // Routing (0x02xx) - Terminal
  DaemonNotFound: 0x0201,
  DaemonOffline: 0x0202, // Terminal

  // Session (0x03xx) - Terminal
  SessionNotFound: 0x0301,
  SessionExpired: 0x0302,

  // Wire Format (0x04xx) - Terminal
  MalformedFrame: 0x0401,
  PayloadTooLarge: 0x0402,
  InvalidFrameType: 0x0403,
  InvalidSessionId: 0x0404,
  DisallowedSender: 0x0405,

  // Internal (0x06xx) - Terminal
  InternalError: 0x0601,

  // Throttling (0x09xx) - Varies (RateLimited=N, Backpressure=T)
  RateLimited: 0x0901,
  Backpressure: 0x0902,

  // Session State (0x10xx) - Non-terminal
  SessionPaused: 0x1001,
  SessionResumed: 0x1002,
  SessionEnded: 0x1003,
  SessionPending: 0x1004,
} as const;

export type WireControlCode =
  (typeof WireControlCode)[keyof typeof WireControlCode];

/**
 * Check if a control code is terminal (relay closes WebSocket after sending).
 *
 * Fail-safe pattern: only enumerate non-terminal exceptions; unknown/new codes
 * default to terminal so they never silently keep a session alive.
 */
export function isTerminalCode(code: WireControlCode): boolean {
  switch (code) {
    case WireControlCode.RateLimited:
    case WireControlCode.SessionPaused:
    case WireControlCode.SessionResumed:
    case WireControlCode.SessionEnded:
    case WireControlCode.SessionPending:
      return false;
    default:
      return true;
  }
}

/** Decoded frame header */
export interface FrameHeader {
  type: FrameType;
  length: number;
  sessionId: SessionId;
}

/** Decoded frame (header + payload) */
export interface Frame extends FrameHeader {
  payload: Uint8Array;
}

/** Decoded Control frame payload */
export interface ControlPayload {
  code: WireControlCode;
  message: string;
}

/** Decoded Signal frame payload */
export interface SignalPayload {
  signal: SignalCode;
  reason: SignalReason;
}

// ============================================================================
// Control code mapping
// ============================================================================

const sbrpToWire: Record<string, WireControlCode> = {
  // Authentication
  [SbrpErrorCode.Unauthorized]: WireControlCode.Unauthorized,
  [SbrpErrorCode.Forbidden]: WireControlCode.Forbidden,

  // Routing
  [SbrpErrorCode.DaemonNotFound]: WireControlCode.DaemonNotFound,
  [SbrpErrorCode.DaemonOffline]: WireControlCode.DaemonOffline,

  // Session
  [SbrpErrorCode.SessionNotFound]: WireControlCode.SessionNotFound,
  [SbrpErrorCode.SessionExpired]: WireControlCode.SessionExpired,

  // Wire Format
  [SbrpErrorCode.MalformedFrame]: WireControlCode.MalformedFrame,
  [SbrpErrorCode.PayloadTooLarge]: WireControlCode.PayloadTooLarge,
  [SbrpErrorCode.InvalidFrameType]: WireControlCode.InvalidFrameType,
  [SbrpErrorCode.InvalidSessionId]: WireControlCode.InvalidSessionId,
  [SbrpErrorCode.DisallowedSender]: WireControlCode.DisallowedSender,

  // Internal
  [SbrpErrorCode.InternalError]: WireControlCode.InternalError,

  // Rate Limiting / Backpressure
  [SbrpErrorCode.RateLimited]: WireControlCode.RateLimited,
  [SbrpErrorCode.Backpressure]: WireControlCode.Backpressure,

  // Session State
  [SbrpErrorCode.SessionPaused]: WireControlCode.SessionPaused,
  [SbrpErrorCode.SessionResumed]: WireControlCode.SessionResumed,
  [SbrpErrorCode.SessionEnded]: WireControlCode.SessionEnded,
  [SbrpErrorCode.SessionPending]: WireControlCode.SessionPending,
};

const wireToSbrp: Record<number, SbrpErrorCode> = {
  // Authentication
  [WireControlCode.Unauthorized]: SbrpErrorCode.Unauthorized,
  [WireControlCode.Forbidden]: SbrpErrorCode.Forbidden,

  // Routing
  [WireControlCode.DaemonNotFound]: SbrpErrorCode.DaemonNotFound,
  [WireControlCode.DaemonOffline]: SbrpErrorCode.DaemonOffline,

  // Session
  [WireControlCode.SessionNotFound]: SbrpErrorCode.SessionNotFound,
  [WireControlCode.SessionExpired]: SbrpErrorCode.SessionExpired,

  // Wire Format
  [WireControlCode.MalformedFrame]: SbrpErrorCode.MalformedFrame,
  [WireControlCode.PayloadTooLarge]: SbrpErrorCode.PayloadTooLarge,
  [WireControlCode.InvalidFrameType]: SbrpErrorCode.InvalidFrameType,
  [WireControlCode.InvalidSessionId]: SbrpErrorCode.InvalidSessionId,
  [WireControlCode.DisallowedSender]: SbrpErrorCode.DisallowedSender,

  // Internal
  [WireControlCode.InternalError]: SbrpErrorCode.InternalError,

  // Rate Limiting / Backpressure
  [WireControlCode.RateLimited]: SbrpErrorCode.RateLimited,
  [WireControlCode.Backpressure]: SbrpErrorCode.Backpressure,

  // Session State
  [WireControlCode.SessionPaused]: SbrpErrorCode.SessionPaused,
  [WireControlCode.SessionResumed]: SbrpErrorCode.SessionResumed,
  [WireControlCode.SessionEnded]: SbrpErrorCode.SessionEnded,
  [WireControlCode.SessionPending]: SbrpErrorCode.SessionPending,
};

/** Convert SbrpErrorCode to wire format (for relay-transmittable codes only) */
export function toWireControlCode(code: SbrpErrorCode): WireControlCode {
  const wire = sbrpToWire[code];
  if (wire === undefined) {
    throw new Error(`Unknown or non-wire SbrpErrorCode: ${code}`);
  }
  return wire;
}

/** Convert wire control code to SbrpErrorCode */
export function fromWireControlCode(code: WireControlCode): SbrpErrorCode {
  const sbrp = wireToSbrp[code];
  if (sbrp === undefined) {
    throw new Error(
      `Unknown WireControlCode: 0x${code.toString(16).padStart(4, "0")}`,
    );
  }
  return sbrp;
}

// ============================================================================
// Validation helpers
// ============================================================================

const MAX_UINT64 = 0xffff_ffff_ffff_ffffn;

/**
 * Check if frame type requires non-zero sessionId (§13.2).
 *
 * Session-bound: HandshakeInit, HandshakeAccept, Data, Signal
 * Connection-scoped (sessionId must be 0): Ping, Pong
 * Variable (depends on content): Control
 */
function isSessionBound(type: FrameType): boolean {
  return (
    type === FrameType.HandshakeInit ||
    type === FrameType.HandshakeAccept ||
    type === FrameType.Data ||
    type === FrameType.Signal
  );
}

/** Check if frame type requires sessionId = 0 (connection-scoped) */
function isConnectionScoped(type: FrameType): boolean {
  return type === FrameType.Ping || type === FrameType.Pong;
}

function validateSessionId(sessionId: SessionId, type: FrameType): void {
  if (sessionId < 0n || sessionId > MAX_UINT64) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `SessionId out of uint64 range: ${sessionId}`,
    );
  }
  if (isSessionBound(type) && sessionId === 0n) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Session-bound frame type 0x${type.toString(16).padStart(2, "0")} requires non-zero sessionId`,
    );
  }
  if (isConnectionScoped(type) && sessionId !== 0n) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Connection-scoped frame type 0x${type.toString(16).padStart(2, "0")} requires sessionId = 0`,
    );
  }
}

// ============================================================================
// Low-level frame encoding/decoding
// ============================================================================

/**
 * Encode a frame to binary wire format.
 *
 * @throws {SbrpError} if payload exceeds MAX_PAYLOAD_SIZE or sessionId is invalid
 */
export function encodeFrame(
  type: FrameType,
  sessionId: SessionId,
  payload: Uint8Array,
): Uint8Array {
  validateSessionId(sessionId, type);

  if (payload.length > MAX_PAYLOAD_SIZE) {
    throw new SbrpError(
      SbrpErrorCode.PayloadTooLarge,
      `Payload size ${payload.length} exceeds maximum ${MAX_PAYLOAD_SIZE}`,
    );
  }

  const frame = new Uint8Array(FRAME_HEADER_SIZE + payload.length);
  const view = new DataView(frame.buffer);

  frame[0] = type;
  view.setUint32(1, payload.length, false);
  view.setBigUint64(5, sessionId, false);
  frame.set(payload, FRAME_HEADER_SIZE);

  return frame;
}

/**
 * Read frame header without decoding payload.
 * Useful for routing decisions before full decode.
 *
 * Validates wire format constraints including non-zero sessionId
 * for session-bound frames (§13.2).
 *
 * @throws {SbrpError} if buffer is too short, length exceeds max, or sessionId invalid
 */
export function readFrameHeader(data: Uint8Array): FrameHeader {
  if (data.length < FRAME_HEADER_SIZE) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Frame too short: ${data.length} < ${FRAME_HEADER_SIZE}`,
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const type = data[0] as FrameType;

  switch (type) {
    case FrameType.HandshakeInit:
    case FrameType.HandshakeAccept:
    case FrameType.Data:
    case FrameType.Signal:
    case FrameType.Ping:
    case FrameType.Pong:
    case FrameType.Control:
      break;
    default:
      throw new SbrpError(
        SbrpErrorCode.InvalidFrameType,
        `Unknown frame type: 0x${(type as number).toString(16).padStart(2, "0")}`,
      );
  }

  const length = view.getUint32(1, false);
  const sessionId = view.getBigUint64(5, false);

  if (length > MAX_PAYLOAD_SIZE) {
    throw new SbrpError(
      SbrpErrorCode.PayloadTooLarge,
      `Payload length ${length} exceeds maximum ${MAX_PAYLOAD_SIZE}`,
    );
  }

  // Wire format constraint: session-bound frames require non-zero sessionId
  if (isSessionBound(type) && sessionId === 0n) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Session-bound frame type 0x${type.toString(16).padStart(2, "0")} requires non-zero sessionId`,
    );
  }

  // Wire format constraint: connection-scoped frames require sessionId = 0
  if (isConnectionScoped(type) && sessionId !== 0n) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Connection-scoped frame type 0x${type.toString(16).padStart(2, "0")} requires sessionId = 0`,
    );
  }

  return { type, length, sessionId };
}

/**
 * Decode a complete frame from binary data.
 *
 * Rejects trailing bytes to catch framing mistakes. Use `FrameDecoder`
 * for streaming scenarios with multiple frames per buffer.
 *
 * @throws {SbrpError} if frame is malformed or has trailing bytes
 */
export function decodeFrame(data: Uint8Array): Frame {
  const header = readFrameHeader(data);
  const expectedSize = FRAME_HEADER_SIZE + header.length;

  if (data.length < expectedSize) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Frame truncated: got ${data.length}, expected ${expectedSize}`,
    );
  }

  if (data.length > expectedSize) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Frame has ${data.length - expectedSize} trailing bytes`,
    );
  }

  const payload = data.subarray(FRAME_HEADER_SIZE, expectedSize);
  return { ...header, payload };
}

// ============================================================================
// High-level frame encoding (typed message → binary)
// ============================================================================

/**
 * Encode HandshakeInit to wire frame.
 *
 * @throws {SbrpError} if initPublicKey is not exactly 32 bytes or sessionId is invalid
 */
export function encodeHandshakeInit(
  sessionId: SessionId,
  init: HandshakeInit,
): Uint8Array {
  if (init.initPublicKey.length !== HANDSHAKE_INIT_PAYLOAD_SIZE) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `initPublicKey must be ${HANDSHAKE_INIT_PAYLOAD_SIZE} bytes, got ${init.initPublicKey.length}`,
    );
  }
  return encodeFrame(FrameType.HandshakeInit, sessionId, init.initPublicKey);
}

/**
 * Encode HandshakeAccept to wire frame.
 *
 * Wire layout (128 bytes): identityPublicKey(32) + acceptPublicKey(32) + signature(64)
 *
 * @throws {SbrpError} if field sizes are wrong or sessionId is invalid
 */
export function encodeHandshakeAccept(
  sessionId: SessionId,
  accept: HandshakeAccept,
): Uint8Array {
  if (accept.identityPublicKey.length !== ED25519_PUBLIC_KEY_LENGTH) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `identityPublicKey must be ${ED25519_PUBLIC_KEY_LENGTH} bytes, got ${accept.identityPublicKey.length}`,
    );
  }
  if (accept.acceptPublicKey.length !== X25519_PUBLIC_KEY_LENGTH) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `acceptPublicKey must be ${X25519_PUBLIC_KEY_LENGTH} bytes, got ${accept.acceptPublicKey.length}`,
    );
  }
  if (accept.signature.length !== ED25519_SIGNATURE_LENGTH) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `signature must be ${ED25519_SIGNATURE_LENGTH} bytes, got ${accept.signature.length}`,
    );
  }
  const payload = new Uint8Array(HANDSHAKE_ACCEPT_PAYLOAD_SIZE);
  payload.set(accept.identityPublicKey, 0);
  payload.set(accept.acceptPublicKey, ED25519_PUBLIC_KEY_LENGTH);
  payload.set(
    accept.signature,
    ED25519_PUBLIC_KEY_LENGTH + X25519_PUBLIC_KEY_LENGTH,
  );
  return encodeFrame(FrameType.HandshakeAccept, sessionId, payload);
}

/**
 * Encode Data frame (encrypted message).
 *
 * @throws {SbrpError} if data is too short (< nonce + authTag) or sessionId is invalid
 */
export function encodeData(
  sessionId: SessionId,
  message: EncryptedMessage,
): Uint8Array {
  if (message.data.length < MIN_ENCRYPTED_PAYLOAD_SIZE) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Data payload must be at least ${MIN_ENCRYPTED_PAYLOAD_SIZE} bytes, got ${message.data.length}`,
    );
  }
  return encodeFrame(FrameType.Data, sessionId, message.data);
}

/**
 * Encode Signal frame (daemon → relay).
 *
 * @param sessionId Session being signaled
 * @param signal Signal code (ready or close)
 * @param reason Reason code (for close signal)
 */
export function encodeSignal(
  sessionId: SessionId,
  signal: SignalCode,
  reason: SignalReason = SignalReason.None,
): Uint8Array {
  const payload = new Uint8Array(SIGNAL_PAYLOAD_SIZE);
  payload[0] = signal;
  payload[1] = reason;
  return encodeFrame(FrameType.Signal, sessionId, payload);
}

/**
 * Encode Ping frame (connection-scoped keepalive).
 *
 * @param payload Optional 0-8 byte payload for RTT measurement
 */
export function encodePing(
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  if (payload.length > MAX_PING_PAYLOAD_SIZE) {
    throw new SbrpError(
      SbrpErrorCode.PayloadTooLarge,
      `Ping payload must be 0-${MAX_PING_PAYLOAD_SIZE} bytes, got ${payload.length}`,
    );
  }
  return encodeFrame(FrameType.Ping, 0n, payload);
}

/**
 * Encode Pong frame (connection-scoped keepalive response).
 *
 * @param payload Payload from corresponding Ping (must be copied)
 */
export function encodePong(
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  if (payload.length > MAX_PING_PAYLOAD_SIZE) {
    throw new SbrpError(
      SbrpErrorCode.PayloadTooLarge,
      `Pong payload must be 0-${MAX_PING_PAYLOAD_SIZE} bytes, got ${payload.length}`,
    );
  }
  return encodeFrame(FrameType.Pong, 0n, payload);
}

/**
 * Encode Control frame (relay → endpoint).
 *
 * @param sessionId Session ID (non-zero for session events, 0 for connection errors)
 * @param code Control code from WireControlCode
 * @param message Optional diagnostic message (for errors only)
 */
export function encodeControl(
  sessionId: SessionId,
  code: WireControlCode,
  message?: string,
): Uint8Array {
  const msgBytes = message ? textEncoder.encode(message) : null;
  const payload = new Uint8Array(2 + (msgBytes?.length ?? 0));
  new DataView(payload.buffer).setUint16(0, code, false);
  if (msgBytes) payload.set(msgBytes, 2);
  return encodeFrame(FrameType.Control, sessionId, payload);
}

// ============================================================================
// High-level frame decoding (Frame → typed message)
// ============================================================================

/**
 * Decode HandshakeInit from frame.
 *
 * @throws {SbrpError} if frame type or payload size is invalid
 */
export function decodeHandshakeInit(frame: Frame): HandshakeInit {
  if (frame.type !== FrameType.HandshakeInit) {
    throw new SbrpError(
      SbrpErrorCode.InvalidFrameType,
      `Expected HandshakeInit (0x01), got 0x${frame.type.toString(16).padStart(2, "0")}`,
    );
  }
  if (frame.payload.length !== HANDSHAKE_INIT_PAYLOAD_SIZE) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `HandshakeInit payload must be ${HANDSHAKE_INIT_PAYLOAD_SIZE} bytes, got ${frame.payload.length}`,
    );
  }
  return {
    type: "handshake.init",
    initPublicKey: frame.payload.slice(),
  };
}

/**
 * Decode HandshakeAccept from frame.
 *
 * Wire layout (128 bytes): identityPublicKey(32) + acceptPublicKey(32) + signature(64)
 *
 * @throws {SbrpError} if frame type or payload size is invalid
 */
export function decodeHandshakeAccept(frame: Frame): HandshakeAccept {
  if (frame.type !== FrameType.HandshakeAccept) {
    throw new SbrpError(
      SbrpErrorCode.InvalidFrameType,
      `Expected HandshakeAccept (0x02), got 0x${frame.type.toString(16).padStart(2, "0")}`,
    );
  }
  if (frame.payload.length !== HANDSHAKE_ACCEPT_PAYLOAD_SIZE) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `HandshakeAccept payload must be ${HANDSHAKE_ACCEPT_PAYLOAD_SIZE} bytes, got ${frame.payload.length}`,
    );
  }
  const keyEnd = ED25519_PUBLIC_KEY_LENGTH + X25519_PUBLIC_KEY_LENGTH;
  return {
    type: "handshake.accept",
    identityPublicKey: frame.payload.slice(0, ED25519_PUBLIC_KEY_LENGTH),
    acceptPublicKey: frame.payload.slice(ED25519_PUBLIC_KEY_LENGTH, keyEnd),
    signature: frame.payload.slice(keyEnd, keyEnd + ED25519_SIGNATURE_LENGTH),
  };
}

/**
 * Decode Data frame (encrypted message).
 *
 * @throws {SbrpError} if frame type or payload is invalid
 */
export function decodeData(frame: Frame): EncryptedMessage {
  if (frame.type !== FrameType.Data) {
    throw new SbrpError(
      SbrpErrorCode.InvalidFrameType,
      `Expected Data (0x03), got 0x${frame.type.toString(16).padStart(2, "0")}`,
    );
  }
  if (frame.payload.length < MIN_ENCRYPTED_PAYLOAD_SIZE) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Data payload must be at least ${MIN_ENCRYPTED_PAYLOAD_SIZE} bytes, got ${frame.payload.length}`,
    );
  }
  const seq = extractSequence(frame.payload);
  return {
    type: "encrypted",
    seq,
    data: frame.payload.slice(),
  };
}

/**
 * Decode Signal frame (daemon → relay).
 *
 * @throws {SbrpError} if frame type, payload size, or signal values are invalid
 */
export function decodeSignal(frame: Frame): SignalPayload {
  if (frame.type !== FrameType.Signal) {
    throw new SbrpError(
      SbrpErrorCode.InvalidFrameType,
      `Expected Signal (0x04), got 0x${frame.type.toString(16).padStart(2, "0")}`,
    );
  }
  if (frame.payload.length !== SIGNAL_PAYLOAD_SIZE) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Signal payload must be ${SIGNAL_PAYLOAD_SIZE} bytes, got ${frame.payload.length}`,
    );
  }
  // Length validated above (exactly SIGNAL_PAYLOAD_SIZE = 2 bytes)
  const signal = frame.payload[0]!;
  const reason = frame.payload[1]!;
  if (signal !== SignalCode.Ready && signal !== SignalCode.Close) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Unknown signal code: 0x${signal.toString(16).padStart(2, "0")}`,
    );
  }
  switch (reason) {
    case SignalReason.None:
    case SignalReason.StateLost:
    case SignalReason.Shutdown:
    case SignalReason.Policy:
    case SignalReason.Error:
      break;
    default:
      throw new SbrpError(
        SbrpErrorCode.MalformedFrame,
        `Unknown signal reason: 0x${reason.toString(16).padStart(2, "0")}`,
      );
  }
  return { signal: signal as SignalCode, reason: reason as SignalReason };
}

/**
 * Decode Control frame (relay → endpoint).
 *
 * Invalid UTF-8 sequences in message are replaced with U+FFFD.
 *
 * @throws {SbrpError} if frame type or payload is invalid
 */
export function decodeControl(frame: Frame): ControlPayload {
  if (frame.type !== FrameType.Control) {
    throw new SbrpError(
      SbrpErrorCode.InvalidFrameType,
      `Expected Control (0x20), got 0x${frame.type.toString(16).padStart(2, "0")}`,
    );
  }
  if (frame.payload.length < MIN_CONTROL_PAYLOAD_SIZE) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Control payload must be at least ${MIN_CONTROL_PAYLOAD_SIZE} bytes, got ${frame.payload.length}`,
    );
  }
  const view = new DataView(
    frame.payload.buffer,
    frame.payload.byteOffset,
    frame.payload.byteLength,
  );
  const rawCode = view.getUint16(0, false);
  if (wireToSbrp[rawCode] === undefined) {
    throw new SbrpError(
      SbrpErrorCode.MalformedFrame,
      `Unknown control code: 0x${rawCode.toString(16).padStart(4, "0")}`,
    );
  }
  const code = rawCode as WireControlCode;
  // TextDecoder with fatal:false replaces invalid UTF-8 with U+FFFD
  const message = textDecoder.decode(frame.payload.subarray(2));
  return { code, message };
}

// ============================================================================
// Streaming frame decoder
// ============================================================================

/**
 * Streaming frame decoder for incremental parsing.
 *
 * Accumulates bytes and yields complete frames. Useful when frames
 * may be fragmented across WebSocket messages or TCP reads.
 *
 * @example
 * ```typescript
 * const decoder = new FrameDecoder();
 * ws.on("message", (data) => {
 *   for (const frame of decoder.push(data)) {
 *     handleFrame(frame);
 *   }
 * });
 * ```
 */
export class FrameDecoder {
  private buffer: Uint8Array = new Uint8Array(0);

  /**
   * Push data and yield any complete frames.
   */
  *push(data: Uint8Array): Generator<Frame> {
    // Append to buffer
    if (this.buffer.length === 0) {
      this.buffer = data;
    } else {
      const combined = new Uint8Array(this.buffer.length + data.length);
      combined.set(this.buffer, 0);
      combined.set(data, this.buffer.length);
      this.buffer = combined;
    }

    // Yield complete frames
    while (this.buffer.length >= FRAME_HEADER_SIZE) {
      const header = readFrameHeader(this.buffer);
      const frameSize = FRAME_HEADER_SIZE + header.length;

      if (this.buffer.length < frameSize) {
        break; // Incomplete frame, wait for more data
      }

      const payload = this.buffer.subarray(FRAME_HEADER_SIZE, frameSize);
      yield { ...header, payload };
      this.buffer = this.buffer.subarray(frameSize);
    }
  }

  /** Reset decoder state, discarding any buffered data */
  reset(): void {
    this.buffer = new Uint8Array(0);
  }

  /** Number of bytes currently buffered */
  get bufferedBytes(): number {
    return this.buffer.length;
  }
}
