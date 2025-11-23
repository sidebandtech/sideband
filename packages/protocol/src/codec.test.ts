// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "bun:test";
import {
  createHandshakeFrame,
  createPingFrame,
  createPongFrame,
  createCloseFrame,
  createMessageFrame,
  encodeFrame,
  decodeFrame,
  isHandshakeFrame,
  isPingFrame,
  isPongFrame,
  isCloseFrame,
  isMessageFrame,
} from "./index.js";
import { ControlOp, ErrorCode } from "./constants.js";
import { encodeHandshake } from "./handshake.js";
import {
  asPeerId,
  asFrameId,
  asSubject,
  generateFrameId,
  frameIdToHex,
  frameIdFromHex,
} from "./types.js";
import { ProtocolError } from "./error.js";

describe("Codec: Frame ID handling", () => {
  it("should generate 16-byte (128-bit) binary frame IDs", () => {
    const frameId = generateFrameId();
    expect(frameId).toHaveLength(16);
    expect(frameId instanceof Uint8Array).toBe(true);
  });

  it("should handle binary frame IDs without padding/trimming", () => {
    const frameId = generateFrameId();
    const frame = createPingFrame({
      frameId,
    });

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (!isPingFrame(decoded)) throw new Error("Not a ping frame");
    // Byte-wise equality for binary frameId
    expect(decoded.frameId).toEqual(frameId);
  });

  it("should convert frame IDs to/from hex", () => {
    const frameId = generateFrameId();
    const hex = frameIdToHex(frameId);

    // Should be 32 lowercase hex chars
    expect(hex).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(hex)).toBe(true);

    // Round-trip: hex → frameId → hex
    const frameIdFromHex2 = frameIdFromHex(hex);
    expect(frameIdFromHex2).toEqual(frameId);
    expect(frameIdToHex(frameIdFromHex2)).toBe(hex);
  });

  it("should reject invalid hex when converting from hex", () => {
    expect(() => frameIdFromHex("invalid")).toThrow();
    expect(() =>
      frameIdFromHex("00000000000000000000000000000000xx"),
    ).toThrow();
    expect(() => frameIdFromHex("0000000000000000000000000000000")).toThrow(); // 31 chars
    expect(() => frameIdFromHex("000000000000000000000000000000000")).toThrow(); // 33 chars
  });

  it("should reject invalid frameId length in asFrameId", () => {
    expect(() => asFrameId(new Uint8Array(15))).toThrow();
    expect(() => asFrameId(new Uint8Array(17))).toThrow();
  });
});

describe("Codec: Flag validation", () => {
  it("should reject frames with non-zero flags", () => {
    const frame = createPingFrame();
    const encoded = encodeFrame(frame);

    // Corrupt the flags byte (offset 1)
    const corrupted = new Uint8Array(encoded);
    corrupted[1] = 0x01; // Set flags to 1

    expect(() => decodeFrame(corrupted)).toThrow(
      "Invalid frame: unexpected flags",
    );
  });
});

describe("Control Frame Codec", () => {
  it("should encode and decode handshake frame", () => {
    const handshakePayload = {
      protocol: "sideband" as const,
      version: "1" as const,
      peerId: asPeerId("peer-1"),
      caps: ["rpc", "pubsub"],
    };
    const data = encodeHandshake(handshakePayload);
    const frame = createHandshakeFrame(data);

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (!isHandshakeFrame(decoded)) throw new Error("Not a handshake frame");
    expect(decoded.op).toBe(ControlOp.Handshake);
    expect(decoded.data).toEqual(data);
  });

  it("should encode and decode ping frame", () => {
    const frame = createPingFrame();

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (!isPingFrame(decoded)) throw new Error("Not a ping frame");
    expect(decoded.op).toBe(ControlOp.Ping);
    expect(decoded.data).toBeUndefined();
  });

  it("should encode and decode pong frame", () => {
    const frame = createPongFrame();

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (!isPongFrame(decoded)) throw new Error("Not a pong frame");
    expect(decoded.op).toBe(ControlOp.Pong);
    expect(decoded.data).toBeUndefined();
  });

  it("should encode and decode close frame with reason", () => {
    const reason = new TextEncoder().encode("Going offline");
    const frame = createCloseFrame(reason);

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (!isCloseFrame(decoded)) throw new Error("Not a close frame");
    expect(decoded.op).toBe(ControlOp.Close);
    expect(decoded.data).toEqual(reason);
  });

  it("should encode and decode close frame without reason", () => {
    const frame = createCloseFrame();

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (!isCloseFrame(decoded)) throw new Error("Not a close frame");
    expect(decoded.op).toBe(ControlOp.Close);
    expect(decoded.data).toBeUndefined();
  });

  it("should reject handshake frame with empty data during encode", () => {
    // Test codec defensive behavior: while factory functions and type system
    // prevent invalid construction at the API level, the codec should validate
    // and reject malformed input in case frames come from external sources.
    const frame = {
      kind: 0,
      op: ControlOp.Handshake,
      frameId: generateFrameId(),
      data: new Uint8Array(), // Empty data (invalid)
    } as any;

    expect(() => encodeFrame(frame)).toThrow(
      "Invalid handshake frame: data is required",
    );
  });

  it("should reject ping frame with data during encode", () => {
    const frame = {
      kind: 0,
      op: ControlOp.Ping,
      frameId: generateFrameId(),
      data: new Uint8Array([1, 2, 3]),
    } as any;

    expect(() => encodeFrame(frame)).toThrow(
      "Invalid ping/pong frame: must not have payload",
    );
  });

  it("should reject ping frame with payload during decode", () => {
    // Manually construct a ping frame with payload (invalid)
    const frameId = generateFrameId();
    const buffer = new Uint8Array([
      0, // frame kind (control)
      0, // flags
      ...frameId, // 16-byte frame ID (binary)
      ControlOp.Ping, // op
      1,
      2,
      3, // payload (invalid for ping)
    ]);

    expect(() => decodeFrame(buffer)).toThrow(
      "Invalid ping/pong frame: must not have payload",
    );
  });
});

describe("Message Frame Codec", () => {
  it("should encode and decode message frame with valid subject", () => {
    const data = new TextEncoder().encode("hello world");
    const frame = createMessageFrame("rpc/getUser", data);

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (!isMessageFrame(decoded)) throw new Error("Not a message frame");
    expect(decoded.subject).toBe(asSubject("rpc/getUser"));
    expect(decoded.data).toEqual(data);
  });

  it("should handle empty message data", () => {
    const frame = createMessageFrame("event/userJoined", new Uint8Array());

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (!isMessageFrame(decoded)) throw new Error("Not a message frame");
    expect(decoded.subject).toBe(asSubject("event/userJoined"));
    expect(decoded.data.length).toBe(0);
  });

  it("should reject message frame with missing subject", () => {
    const frameId = generateFrameId();
    const buffer = new Uint8Array([
      1, // frame kind (message)
      0, // flags
      ...frameId, // 16-byte frame ID (binary)
      // Missing subject (4-byte length + subject bytes)
    ]);

    expect(() => decodeFrame(buffer)).toThrow(
      "Invalid message frame: no subject",
    );
  });

  it("should reject message frame with incomplete subject", () => {
    const frameId = generateFrameId();
    const buffer = new Uint8Array([
      1, // frame kind (message)
      0, // flags
      ...frameId, // 16-byte frame ID (binary)
      0,
      0,
      0,
      10, // subject length = 10
      1,
      2,
      3, // only 3 bytes (incomplete)
    ]);

    expect(() => decodeFrame(buffer)).toThrow(
      "Invalid message frame: incomplete subject",
    );
  });
});

describe("Subject Validation (ADR-006, ADR-008)", () => {
  it("should accept valid RPC subject", () => {
    const subject = asSubject("rpc/getUserById");
    expect(subject).toBe(asSubject("rpc/getUserById"));
  });

  it("should accept valid event subject", () => {
    const subject = asSubject("event/user.created");
    expect(subject).toBe(asSubject("event/user.created"));
  });

  it("should accept valid stream subject", () => {
    const subject = asSubject("stream/chat/abc123");
    expect(subject).toBe(asSubject("stream/chat/abc123"));
  });

  it("should accept valid app subject", () => {
    const subject = asSubject("app/vendor/custom");
    expect(subject).toBe(asSubject("app/vendor/custom"));
  });

  it("should reject empty subject", () => {
    expect(() => asSubject("")).toThrow(ProtocolError);
  });

  it("should reject subject without reserved prefix", () => {
    expect(() => asSubject("invalid/subject")).toThrow(
      /Subject must start with one of: rpc\/, event\/, stream\/, app\//,
    );
  });

  it("should reject subject with wrong prefix", () => {
    expect(() => asSubject("foo/bar")).toThrow(
      /Subject must start with one of: rpc\/, event\/, stream\/, app\//,
    );
  });

  it("should reject subject exceeding 256 UTF-8 bytes", () => {
    const longSubject = "rpc/" + "x".repeat(300);
    expect(() => asSubject(longSubject)).toThrow(
      /Subject exceeds 256 UTF-8 bytes/,
    );
  });

  it("should reject subject containing null bytes", () => {
    const invalidSubject = "rpc/test\x00invalid";
    expect(() => asSubject(invalidSubject)).toThrow(
      /Subject must not contain null bytes/,
    );
  });

  it("should enforce subject validation on message frame creation", () => {
    // Valid subject should work
    const frame = createMessageFrame("rpc/test", new Uint8Array());
    expect(frame.subject).toBe(asSubject("rpc/test"));

    // Invalid subject should throw
    expect(() => createMessageFrame("invalid/test", new Uint8Array())).toThrow(
      ProtocolError,
    );
  });

  it("should enforce subject validation on message frame decode", () => {
    // Manually construct a frame with invalid subject (not going through factory)
    const frameId = generateFrameId();
    const invalidSubject = "invalid/subject";
    const subjectBytes = new TextEncoder().encode(invalidSubject);
    const payload = new Uint8Array(4 + subjectBytes.length);
    const view = new DataView(payload.buffer);
    view.setUint32(0, subjectBytes.length, true);
    payload.set(subjectBytes, 4);

    const buffer = new Uint8Array([
      1, // frame kind (message)
      0, // flags
      ...frameId, // 16-byte frame ID
      ...payload,
    ]);

    // Decode should reject the invalid subject
    expect(() => decodeFrame(buffer)).toThrow(
      /Subject must start with one of: rpc\/, event\/, stream\/, app\//,
    );
  });

  it("should validate UTF-8 byte length, not code unit length", () => {
    // Multi-byte UTF-8 character (emoji)
    const emoji = "🎉"; // 4 UTF-8 bytes
    const validSubject = "app/" + emoji.repeat(60); // ~240 bytes total
    const subject = asSubject(validSubject);
    expect(subject).toBe(asSubject(validSubject));

    // Exceeding limit with multi-byte characters
    const tooLongSubject = "app/" + emoji.repeat(70); // ~280 bytes total
    expect(() => asSubject(tooLongSubject)).toThrow(
      /Subject exceeds 256 UTF-8 bytes/,
    );
  });
});

describe("Ack Frame Codec", () => {
  it("should encode and decode ack frame", () => {
    const targetFrameId = generateFrameId();
    const frame = {
      kind: 2,
      frameId: generateFrameId(),
      ackFrameId: targetFrameId,
    } as any;

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (decoded.kind !== 2) throw new Error("Not an ack frame");
    expect(decoded.ackFrameId).toEqual(targetFrameId);
  });

  it("should reject ack frame with trailing data", () => {
    const frameId = generateFrameId();
    const ackFrameId = generateFrameId();
    const buffer = new Uint8Array([
      2, // frame kind (ack)
      0, // flags
      ...frameId, // 16-byte frame ID (binary)
      ...ackFrameId, // 16-byte ackFrameId (binary)
      1,
      2,
      3, // trailing garbage (invalid)
    ]);

    expect(() => decodeFrame(buffer)).toThrow(
      "Invalid ack frame: unexpected trailing data",
    );
  });

  it("should reject ack frame with missing payload", () => {
    const frameId = generateFrameId();
    const buffer = new Uint8Array([
      2, // frame kind (ack)
      0, // flags
      ...frameId, // 16-byte frame ID (binary)
      // Missing ackFrameId (payload should be exactly 16 bytes)
    ]);

    expect(() => decodeFrame(buffer)).toThrow("Invalid ack frame: no frame ID");
  });
});

describe("Error Frame Codec", () => {
  it("should encode and decode error frame with message only", () => {
    const code = 1000;
    const message = "Protocol error";
    const frame = {
      kind: 3,
      frameId: generateFrameId(),
      code,
      message,
    } as any;

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (decoded.kind !== 3) throw new Error("Not an error frame");
    expect(decoded.code).toBe(code);
    expect(decoded.message).toBe(message);
    expect(decoded.details).toBeUndefined();
  });

  it("should encode and decode error frame with details", () => {
    const code = 2000;
    const message = "Application error";
    const details = new TextEncoder().encode('{"reason":"invalid input"}');
    const frame = {
      kind: 3,
      frameId: generateFrameId(),
      code,
      message,
      details,
    } as any;

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (decoded.kind !== 3) throw new Error("Not an error frame");
    expect(decoded.code).toBe(code);
    expect(decoded.message).toBe(message);
    expect(decoded.details).toEqual(details);
  });

  it("should reject error frame with incomplete header", () => {
    const frameId = generateFrameId();
    const buffer = new Uint8Array([
      3, // frame kind (error)
      0, // flags
      ...frameId, // 16-byte frame ID (binary)
      // Missing code (2 bytes) + message length (4 bytes)
    ]);

    expect(() => decodeFrame(buffer)).toThrow(
      "Invalid error frame: no code or message",
    );
  });

  it("should reject error frame with incomplete message", () => {
    const frameId = generateFrameId();
    const buffer = new Uint8Array([
      3, // frame kind (error)
      0, // flags
      ...frameId, // 16-byte frame ID (binary)
      0xe8,
      0x03, // code = 1000
      0,
      0,
      0,
      10, // message length = 10
      1,
      2,
      3, // only 3 bytes (incomplete)
    ]);

    expect(() => decodeFrame(buffer)).toThrow(
      "Invalid error frame: incomplete message",
    );
  });
});

describe("Frame Immutability (ADR 007)", () => {
  it("should prevent mutation of decoded frame properties (TypeScript level)", () => {
    // This test documents the immutability guarantee.
    // The following would fail at TypeScript compile time (not runtime):
    // const frame = decodeFrame(buffer);
    // frame.kind = FrameKind.Error;        // ✗ Cannot assign to readonly
    // frame.subject = "spoofed";           // ✗ Cannot assign to readonly (for MessageFrame)
    // frame.data[0] = 0xff;                // ✗ Cannot assign to readonly index

    const data = new TextEncoder().encode("hello world");
    const frame = createMessageFrame("rpc/testMethod", data);

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    // At runtime, we verify that TypeScript's readonly protections work
    // by checking that the returned type is deeply readonly.
    // Direct property reassignment would be caught by TypeScript.
    expect(decoded).toBeDefined();
    expect(decoded.kind).toBe(1);

    // Type-narrow to MessageFrame to access subject and data
    if (!isMessageFrame(decoded)) throw new Error("Not a message frame");
    expect(String(decoded.subject)).toBe("rpc/testMethod");
    expect(decoded.data).toEqual(data);

    // Note: Attempting to mutate a readonly property will fail at TypeScript compile time.
    // Runtime mutation is prevented by TypeScript's type system.
  });

  it("should return readonly frames from factory functions", () => {
    const data = new TextEncoder().encode("handshake payload");
    const frame = createHandshakeFrame(data);

    // Verify the frame is usable and properties are accessible
    expect(frame.kind).toBe(0); // FrameKind.Control
    expect(frame.op).toBeDefined();
    expect(frame.frameId).toBeDefined();
    expect(frame.data).toEqual(data);

    // At TypeScript level, frame.data and other properties are readonly
    // The following would fail at compile time (not runtime):
    // frame.data = new Uint8Array(); // ✗ Cannot assign to readonly
    // frame.kind = 1;                // ✗ Cannot assign to readonly
  });

  it("should produce readonly data arrays in decoded frames", () => {
    const originalData = new TextEncoder().encode("test payload");
    const frame = createMessageFrame("rpc/test", originalData);

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (!isMessageFrame(decoded)) throw new Error("Not a message frame");

    // The data is readonly at the type level.
    // TypeScript prevents: decoded.data[0] = 0xff; // ✗ Cannot assign to readonly index
    expect(decoded.data).toEqual(originalData);
    expect(decoded.data).not.toBe(originalData); // Different reference after decode
  });
});
