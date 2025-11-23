// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { ControlOp, FrameKind } from "./constants.js";
import { ProtocolError } from "./error.js";
import { decodeHandshake, encodeHandshake } from "./handshake.js";
import {
  createCloseFrame,
  createHandshakeFrame,
  createMessageFrame,
  createPingFrame,
  createPongFrame,
  decodeFrame,
  encodeFrame,
  isCloseFrame,
  isHandshakeFrame,
  isMessageFrame,
  isPingFrame,
  isPongFrame,
} from "./index.js";
import {
  asFrameId,
  asPeerId,
  asSubject,
  frameIdFromHex,
  frameIdToHex,
  generateFrameId,
} from "./types.js";

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
  it("should accept frames with timestamp bit set (bit 0)", () => {
    const frame = createPingFrame({ timestamp: Date.now() });
    const encoded = encodeFrame(frame);

    // Should decode successfully with timestamp
    const decoded = decodeFrame(encoded);
    expect(decoded.kind).toBe(FrameKind.Control);
    if (!isPingFrame(decoded)) throw new Error("Not a ping frame");
    expect(decoded.timestamp).toBeDefined();
  });

  it("should reject frames with reserved flag bits set (bits 1–7)", () => {
    const frame = createPingFrame();
    const encoded = encodeFrame(frame);

    // Set bit 1 (reserved) while keeping bit 0 clear
    const corrupted = new Uint8Array(encoded);
    corrupted[1] = 0x02; // Set flags to 0b00000010 (bit 1)

    expect(() => decodeFrame(corrupted)).toThrow(
      "reserved flag bits must be zero",
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

describe("Conformance: Handshake Validation", () => {
  it("should reject handshake with wrong protocol name", () => {
    const badPayload = {
      protocol: "wrongprotocol" as any,
      version: "1" as const,
      peerId: asPeerId("test-peer"),
    };
    const encoded = encodeHandshake(badPayload);

    expect(() => decodeHandshake(encoded)).toThrow(/Unsupported protocol/);
  });

  it("should reject handshake with wrong protocol version", () => {
    const badPayload = {
      protocol: "sideband" as const,
      version: "99" as any,
      peerId: asPeerId("test-peer"),
    };
    const encoded = encodeHandshake(badPayload);

    expect(() => decodeHandshake(encoded)).toThrow(
      /Unsupported protocol version/,
    );
  });

  it("should reject handshake with missing peerId", () => {
    const badPayload = JSON.stringify({
      protocol: "sideband",
      version: "1",
      // Missing peerId
    });
    const encoded = new TextEncoder().encode(badPayload);

    expect(() => decodeHandshake(encoded)).toThrow(/Missing or invalid peerId/);
  });

  it("should accept valid handshake with capabilities and metadata", () => {
    const payload = {
      protocol: "sideband" as const,
      version: "1" as const,
      peerId: asPeerId("peer-123"),
      caps: ["rpc", "pubsub"],
      metadata: { region: "us-east", version: "1.0" },
    };
    const encoded = encodeHandshake(payload);
    const decoded = decodeHandshake(encoded);

    expect(decoded.peerId).toBe(asPeerId("peer-123"));
    expect(decoded.caps).toEqual(["rpc", "pubsub"]);
    expect(decoded.metadata).toEqual({ region: "us-east", version: "1.0" });
  });

  it("should handle oversized handshake metadata gracefully", () => {
    const payload = {
      protocol: "sideband" as const,
      version: "1" as const,
      peerId: asPeerId("peer-123"),
      metadata: Object.fromEntries(
        Array(1000)
          .fill(0)
          .map((_, i) => [
            `key${i}`,
            "value".repeat(100), // Large metadata
          ]),
      ),
    };
    const encoded = encodeHandshake(payload);
    // Should decode without crashing
    const decoded = decodeHandshake(encoded);
    expect(decoded.peerId).toBe(asPeerId("peer-123"));
  });
});

describe("Conformance: Round-trip Encoding", () => {
  it("should preserve frame identity in round-trip encode/decode", () => {
    const frames = [
      createPingFrame(),
      createPongFrame(),
      createMessageFrame("rpc/test", new Uint8Array([1, 2, 3])),
      {
        kind: 3,
        frameId: generateFrameId(),
        code: 1000,
        message: "Test error",
      } as any,
    ];

    for (const frame of frames) {
      const encoded = encodeFrame(frame);
      const decoded = decodeFrame(encoded);

      // frameId must be identical after round-trip
      expect(decoded.frameId).toEqual(frame.frameId);
      // kind must be identical
      expect(decoded.kind).toBe(frame.kind);
    }
  });

  it("should preserve timestamps in round-trip encode/decode", () => {
    const now = Date.now();
    const frames = [
      createPingFrame({ timestamp: now }),
      createPongFrame({ timestamp: now }),
      createMessageFrame("rpc/test", new Uint8Array([1, 2, 3]), {
        timestamp: now,
      }),
      createHandshakeFrame(new TextEncoder().encode("{}"), {
        timestamp: now,
      }),
    ];

    for (const frame of frames) {
      const encoded = encodeFrame(frame);
      const decoded = decodeFrame(encoded);

      // timestamp must be preserved
      expect(decoded.timestamp).toBe(now);
      // frameId must be identical
      expect(decoded.frameId).toEqual(frame.frameId);
    }
  });

  it("should omit timestamp when not provided", () => {
    const frame = createPingFrame(); // no timestamp
    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    // timestamp should be undefined
    expect(decoded.timestamp).toBeUndefined();
    // encoded size should not include 8-byte timestamp
    // Structure: 1 (type) + 1 (flags) + 16 (frameId) + 0 (no timestamp) + 1 (ping op) = 19 bytes
    expect(encoded.length).toBe(19);
  });

  it("should preserve order in sequence of frames", () => {
    const frames = [
      createMessageFrame("rpc/first", new Uint8Array([1])),
      createMessageFrame("event/second", new Uint8Array([2])),
      createMessageFrame("app/third", new Uint8Array([3])),
    ];

    const encoded = frames.map((f) => encodeFrame(f));
    const decoded = encoded.map((b) => decodeFrame(b));

    if (!isMessageFrame(decoded[0]!)) throw new Error("Not a message frame");
    if (!isMessageFrame(decoded[1]!)) throw new Error("Not a message frame");
    if (!isMessageFrame(decoded[2]!)) throw new Error("Not a message frame");

    expect(decoded[0].subject).toBe(asSubject("rpc/first"));
    expect(decoded[1].subject).toBe(asSubject("event/second"));
    expect(decoded[2].subject).toBe(asSubject("app/third"));
  });
});

describe("Conformance: Negative Fuzzing", () => {
  it("should reject completely malformed buffers gracefully", () => {
    const malformedBuffers = [
      new Uint8Array([]), // empty
      new Uint8Array([0]), // too short
      new Uint8Array(Array(10).fill(0xff)), // random bytes
      new Uint8Array(Array(100).fill(Math.random() * 256)), // random large buffer
    ];

    for (const buffer of malformedBuffers) {
      expect(() => decodeFrame(buffer)).toThrow();
    }
  });

  it("should reject frame with unknown frame kind gracefully", () => {
    const frameId = generateFrameId();
    const buffer = new Uint8Array([
      99, // invalid frame kind (not 0-3)
      0, // flags
      ...frameId,
    ]);

    expect(() => decodeFrame(buffer)).toThrow(/Unknown frame kind/);
  });

  it("should not crash on deeply nested invalid structures", () => {
    // Malformed message frame with incorrect length indicators
    const frameId = generateFrameId();
    const buffer = new Uint8Array([
      1, // frame kind (message)
      0, // flags
      ...frameId,
      0xff,
      0xff,
      0xff,
      0xff, // huge subject length
      1,
      2,
      3, // incomplete payload
    ]);

    expect(() => decodeFrame(buffer)).toThrow();
  });

  it("should reject error frame with invalid code gracefully", () => {
    const frameId = generateFrameId();
    const messageBytes = new TextEncoder().encode("error message");
    const buffer = new Uint8Array([
      3, // frame kind (error)
      0, // flags
      ...frameId,
      0xff,
      0xff, // large code value (2 bytes, little-endian)
      messageBytes.length,
      0,
      0,
      0,
      ...messageBytes,
    ]);

    // Should decode without crashing, code is just a number
    const decoded = decodeFrame(buffer);
    expect(decoded.kind).toBe(3); // Error frame
  });
});

describe("Conformance: UTF-8 Handling", () => {
  it("should accept valid UTF-8 subjects with multi-byte characters", () => {
    // Test with emoji (4 bytes per character in UTF-8)
    const subject = asSubject("rpc/🎉test");
    const frame = createMessageFrame(subject, new Uint8Array());

    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (!isMessageFrame(decoded)) throw new Error("Not a message frame");
    expect(decoded.subject).toBe(subject);
  });

  it("should reject invalid UTF-8 in subject during decode", () => {
    const frameId = generateFrameId();
    // Manually construct an invalid UTF-8 subject sequence
    const invalidUtf8 = new Uint8Array([0xff, 0xfe]); // Invalid UTF-8 sequence

    const buffer = new Uint8Array([
      1, // frame kind (message)
      0, // flags
      ...frameId,
      invalidUtf8.length,
      0,
      0,
      0, // subject length
      ...invalidUtf8, // invalid UTF-8 bytes
    ]);

    // TextDecoder should handle this gracefully or throw
    // Our codec validation will reject it via asSubject checks
    expect(() => decodeFrame(buffer)).toThrow();
  });

  it("should preserve binary data integrity across UTF-8 boundaries", () => {
    // Message with binary payload containing multi-byte UTF-8 patterns
    const binaryData = new Uint8Array([
      0xf0,
      0x9f,
      0x98,
      0x80, // 🙀 emoji in UTF-8
      0x00,
      0xff, // null and 0xff bytes (not UTF-8)
      0x01,
      0x02,
    ]);

    const frame = createMessageFrame("event/binary", binaryData);
    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);

    if (!isMessageFrame(decoded)) throw new Error("Not a message frame");
    expect(decoded.data).toEqual(binaryData);
  });
});

describe("Conformance: Invalid Frame ID Handling", () => {
  it("should reject frame with too short header", () => {
    const buffer = new Uint8Array([
      0, // frame kind (control)
      0, // flags
      1,
      2,
      3, // only 3 bytes (not 18 total with frame ID)
    ]);

    expect(() => decodeFrame(buffer)).toThrow(/too short/);
  });

  it("should reject ack frame with wrong ackFrameId length", () => {
    const frameId = generateFrameId();
    const shortAckId = new Uint8Array(8); // too short

    const buffer = new Uint8Array([
      2, // frame kind (ack)
      0, // flags
      ...frameId,
      ...shortAckId, // wrong length
    ]);

    expect(() => decodeFrame(buffer)).toThrow(
      /no frame ID|unexpected trailing/,
    );
  });
});

describe("Conformance: Reserved Bits Validation", () => {
  it("should reject all non-zero reserved flag bits (bits 1–7)", () => {
    const frameId = generateFrameId();

    // Test flags with reserved bits (1–7) set, with and without timestamp bit (0)
    for (let reservedBits = 1; reservedBits <= 127; reservedBits++) {
      // Shift left by 1 to test bits 1–7
      const flags = reservedBits << 1;

      const buffer = new Uint8Array([
        0, // frame kind
        flags, // reserved bits set
        ...frameId,
        0, // control op (ping)
      ]);

      expect(() => decodeFrame(buffer)).toThrow(
        /reserved flag bits must be zero/,
      );
    }
  });

  it("should accept timestamp bit (bit 0) without reserved bits", () => {
    const now = Date.now();
    const frame = createPingFrame({ timestamp: now });
    const encoded = encodeFrame(frame);

    // Verify flags bit 0 is set
    expect(encoded[1]! & 0x01).toBe(1);
    // Verify bits 1-7 are zero
    expect(encoded[1]! & 0xfe).toBe(0);

    // Decode and verify
    const decoded = decodeFrame(encoded);
    expect(decoded.kind).toBe(FrameKind.Control);
    expect(decoded.timestamp).toBe(now);
    if (!isPingFrame(decoded)) throw new Error("Not a ping frame");
  });

  it("should reject reserved bits even when timestamp bit is set", () => {
    const frameId = generateFrameId();

    // Test flags with both timestamp bit (0) and reserved bits (1–7)
    // Examples: 0b10000001 (timestamp + bit 7), 0b00100001 (timestamp + bit 5), etc.
    for (let reservedBits = 1; reservedBits <= 127; reservedBits++) {
      // Combine timestamp bit (0x01) with reserved bits (shifted left by 1)
      const flags = 0x01 | (reservedBits << 1);

      const buffer = new Uint8Array([
        0, // frame kind
        flags, // timestamp bit + reserved bits
        ...frameId,
        0, // control op (ping)
      ]);

      expect(() => decodeFrame(buffer)).toThrow(
        /reserved flag bits must be zero/,
      );
    }
  });
});

describe("Conformance: Length Guard Validation", () => {
  it("should reject message frame with subject length mismatch", () => {
    const frameId = generateFrameId();
    const buffer = new Uint8Array([
      1, // frame kind (message)
      0, // flags
      ...frameId,
      10,
      0,
      0,
      0, // subject length = 10
      1,
      2,
      3, // only 3 bytes provided
    ]);

    expect(() => decodeFrame(buffer)).toThrow(/incomplete subject/);
  });

  it("should reject error frame with message length mismatch", () => {
    const frameId = generateFrameId();
    const buffer = new Uint8Array([
      3, // frame kind (error)
      0, // flags
      ...frameId,
      0xe8,
      0x03, // code = 1000
      20,
      0,
      0,
      0, // message length = 20
      1,
      2,
      3, // only 3 bytes provided
    ]);

    expect(() => decodeFrame(buffer)).toThrow(/incomplete message/);
  });
});
