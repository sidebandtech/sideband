// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import {
  FRAME_HEADER_SIZE,
  HANDSHAKE_ACCEPT_PAYLOAD_SIZE,
  HANDSHAKE_INIT_PAYLOAD_SIZE,
  MAX_PAYLOAD_SIZE,
  MAX_PING_PAYLOAD_SIZE,
  SIGNAL_PAYLOAD_SIZE,
} from "./constants.js";
import {
  decodeControl,
  decodeData,
  decodeFrame,
  decodeHandshakeAccept,
  decodeHandshakeInit,
  decodeSignal,
  encodeControl,
  encodeData,
  encodeFrame,
  encodeHandshakeAccept,
  encodeHandshakeInit,
  encodePing,
  encodePong,
  encodeSignal,
  FrameDecoder,
  FrameType,
  fromWireControlCode,
  isTerminalCode,
  readFrameHeader,
  toWireControlCode,
  WireControlCode,
} from "./frame.js";
import type {
  EncryptedMessage,
  HandshakeAccept,
  HandshakeInit,
} from "./types.js";
import { SbrpError, SbrpErrorCode, SignalCode, SignalReason } from "./types.js";

describe("frame codec", () => {
  describe("encodeFrame / decodeFrame", () => {
    it("roundtrips empty payload (connection-scoped)", () => {
      const encoded = encodeFrame(FrameType.Ping, 0n, new Uint8Array(0));
      expect(encoded.length).toBe(FRAME_HEADER_SIZE);

      const decoded = decodeFrame(encoded);
      expect(decoded.type).toBe(FrameType.Ping);
      expect(decoded.sessionId).toBe(0n);
      expect(decoded.length).toBe(0);
      expect(decoded.payload.length).toBe(0);
    });

    it("roundtrips payload with data", () => {
      const payload = new Uint8Array([1, 2, 3, 4, 5]);
      const encoded = encodeFrame(FrameType.Data, 0xdeadbeefn, payload);
      expect(encoded.length).toBe(FRAME_HEADER_SIZE + 5);

      const decoded = decodeFrame(encoded);
      expect(decoded.type).toBe(FrameType.Data);
      expect(decoded.sessionId).toBe(0xdeadbeefn);
      expect(decoded.payload).toEqual(payload);
    });

    it("handles max uint64 sessionId (session-bound)", () => {
      const maxSessionId = 0xffff_ffff_ffff_ffffn;
      const encoded = encodeFrame(
        FrameType.Data,
        maxSessionId,
        new Uint8Array(28),
      );
      const decoded = decodeFrame(encoded);
      expect(decoded.sessionId).toBe(maxSessionId);
    });

    it("rejects payload exceeding MAX_PAYLOAD_SIZE", () => {
      const bigPayload = new Uint8Array(MAX_PAYLOAD_SIZE + 1);
      expect(() => encodeFrame(FrameType.Data, 1n, bigPayload)).toThrow(
        SbrpError,
      );
    });
  });

  describe("readFrameHeader", () => {
    it("reads header without full payload", () => {
      const payload = new Uint8Array(100);
      const encoded = encodeFrame(FrameType.Data, 42n, payload);
      // Only pass header
      const headerOnly = encoded.subarray(0, FRAME_HEADER_SIZE);

      const header = readFrameHeader(headerOnly);
      expect(header.type).toBe(FrameType.Data);
      expect(header.sessionId).toBe(42n);
      expect(header.length).toBe(100);
    });

    it("rejects buffer shorter than header", () => {
      const short = new Uint8Array(FRAME_HEADER_SIZE - 1);
      expect(() => readFrameHeader(short)).toThrow(SbrpError);
    });

    it("rejects unknown frame type", () => {
      const frame = new Uint8Array(FRAME_HEADER_SIZE);
      frame[0] = 0x99; // Unknown type
      expect(() => readFrameHeader(frame)).toThrow(SbrpError);
      expect(() => readFrameHeader(frame)).toThrow(/Unknown frame type/);
    });

    it("rejects invalid payload length in header", () => {
      const frame = new Uint8Array(FRAME_HEADER_SIZE);
      frame[0] = FrameType.Data;
      // Set length to MAX_PAYLOAD_SIZE + 1
      new DataView(frame.buffer).setUint32(1, MAX_PAYLOAD_SIZE + 1, false);
      expect(() => readFrameHeader(frame)).toThrow(SbrpError);
    });

    it("rejects zero sessionId for session-bound frames", () => {
      const frame = new Uint8Array(FRAME_HEADER_SIZE);
      frame[0] = FrameType.HandshakeInit;
      new DataView(frame.buffer).setUint32(1, 32, false);
      // sessionId left as 0

      expect(() => readFrameHeader(frame)).toThrow(SbrpError);
      expect(() => readFrameHeader(frame)).toThrow(/non-zero sessionId/);
    });

    it("allows zero sessionId for connection-scoped frames", () => {
      const frame = new Uint8Array(FRAME_HEADER_SIZE);
      frame[0] = FrameType.Ping;
      // sessionId = 0, length = 0

      const header = readFrameHeader(frame);
      expect(header.sessionId).toBe(0n);
      expect(header.type).toBe(FrameType.Ping);
    });

    it("rejects non-zero sessionId for connection-scoped frames", () => {
      const frame = new Uint8Array(FRAME_HEADER_SIZE);
      frame[0] = FrameType.Ping;
      new DataView(frame.buffer).setBigUint64(5, 123n, false);

      expect(() => readFrameHeader(frame)).toThrow(SbrpError);
      expect(() => readFrameHeader(frame)).toThrow(/sessionId = 0/);
    });
  });

  describe("decodeFrame validation", () => {
    it("rejects truncated frame", () => {
      const payload = new Uint8Array(50);
      const encoded = encodeFrame(FrameType.Data, 1n, payload);
      // Truncate payload
      const truncated = encoded.subarray(0, FRAME_HEADER_SIZE + 10);
      expect(() => decodeFrame(truncated)).toThrow(SbrpError);
    });

    it("rejects trailing bytes", () => {
      const frame1 = encodePing();
      const frame2 = encodePong();
      const combined = new Uint8Array(frame1.length + frame2.length);
      combined.set(frame1, 0);
      combined.set(frame2, frame1.length);

      // decodeFrame should reject the combined buffer
      expect(() => decodeFrame(combined)).toThrow(SbrpError);
      expect(() => decodeFrame(combined)).toThrow(/trailing bytes/);
    });
  });

  describe("sessionId validation", () => {
    it("rejects zero sessionId for session-bound frames", () => {
      const payload = new Uint8Array(32);
      expect(() => encodeFrame(FrameType.HandshakeInit, 0n, payload)).toThrow(
        SbrpError,
      );
      expect(() => encodeFrame(FrameType.HandshakeInit, 0n, payload)).toThrow(
        /non-zero sessionId/,
      );

      expect(() =>
        encodeFrame(FrameType.HandshakeAccept, 0n, new Uint8Array(96)),
      ).toThrow(SbrpError);
      expect(() => encodeFrame(FrameType.Data, 0n, new Uint8Array(28))).toThrow(
        SbrpError,
      );
      expect(() =>
        encodeFrame(FrameType.Signal, 0n, new Uint8Array(2)),
      ).toThrow(SbrpError);
    });

    it("requires zero sessionId for connection-scoped frames", () => {
      expect(() => encodePing()).not.toThrow();
      expect(() => encodePong()).not.toThrow();
      // Control frame can have any sessionId (0 for errors, non-zero for session events)
      expect(() =>
        encodeControl(0n, WireControlCode.RateLimited),
      ).not.toThrow();
      expect(() =>
        encodeControl(1n, WireControlCode.SessionPaused),
      ).not.toThrow();
    });

    it("rejects negative sessionId", () => {
      expect(() => encodeFrame(FrameType.Ping, -1n, new Uint8Array(0))).toThrow(
        SbrpError,
      );
      expect(() => encodeFrame(FrameType.Ping, -1n, new Uint8Array(0))).toThrow(
        /out of uint64 range/,
      );
    });

    it("rejects sessionId exceeding uint64", () => {
      const tooBig = 0x1_0000_0000_0000_0000n; // 2^64
      expect(() =>
        encodeFrame(FrameType.Ping, tooBig, new Uint8Array(0)),
      ).toThrow(SbrpError);
    });
  });

  describe("payload size validation", () => {
    it("rejects wrong initPublicKey size", () => {
      const wrongSize: HandshakeInit = {
        type: "handshake.init",
        initPublicKey: new Uint8Array(16), // should be 32
      };
      expect(() => encodeHandshakeInit(1n, wrongSize)).toThrow(SbrpError);
      expect(() => encodeHandshakeInit(1n, wrongSize)).toThrow(
        /must be 32 bytes/,
      );
    });

    it("rejects wrong identityPublicKey size", () => {
      const wrongSize: HandshakeAccept = {
        type: "handshake.accept",
        identityPublicKey: new Uint8Array(16), // should be 32
        acceptPublicKey: new Uint8Array(32),
        signature: new Uint8Array(64),
      };
      expect(() => encodeHandshakeAccept(1n, wrongSize)).toThrow(SbrpError);
      expect(() => encodeHandshakeAccept(1n, wrongSize)).toThrow(
        /identityPublicKey must be 32 bytes/,
      );
    });

    it("rejects wrong acceptPublicKey size", () => {
      const wrongSize: HandshakeAccept = {
        type: "handshake.accept",
        identityPublicKey: new Uint8Array(32),
        acceptPublicKey: new Uint8Array(16), // should be 32
        signature: new Uint8Array(64),
      };
      expect(() => encodeHandshakeAccept(1n, wrongSize)).toThrow(SbrpError);
    });

    it("rejects wrong signature size", () => {
      const wrongSize: HandshakeAccept = {
        type: "handshake.accept",
        identityPublicKey: new Uint8Array(32),
        acceptPublicKey: new Uint8Array(32),
        signature: new Uint8Array(32), // should be 64
      };
      expect(() => encodeHandshakeAccept(1n, wrongSize)).toThrow(SbrpError);
      expect(() => encodeHandshakeAccept(1n, wrongSize)).toThrow(
        /signature must be 64 bytes/,
      );
    });

    it("rejects Data payload too short", () => {
      const tooShort: EncryptedMessage = {
        type: "encrypted",
        seq: 0n,
        data: new Uint8Array(20), // must be >= 28
      };
      expect(() => encodeData(1n, tooShort)).toThrow(SbrpError);
      expect(() => encodeData(1n, tooShort)).toThrow(/at least 28 bytes/);
    });

    it("rejects Ping payload too large", () => {
      const tooLarge = new Uint8Array(MAX_PING_PAYLOAD_SIZE + 1);
      expect(() => encodePing(tooLarge)).toThrow(SbrpError);
      expect(() => encodePing(tooLarge)).toThrow(/0-8 bytes/);
    });
  });

  describe("HandshakeInit", () => {
    it("encodes and decodes correctly", () => {
      const initPublicKey = new Uint8Array(32).fill(0xab);
      const init: HandshakeInit = {
        type: "handshake.init",
        initPublicKey,
      };

      const encoded = encodeHandshakeInit(1n, init);
      expect(encoded.length).toBe(
        FRAME_HEADER_SIZE + HANDSHAKE_INIT_PAYLOAD_SIZE,
      );

      const frame = decodeFrame(encoded);
      expect(frame.type).toBe(FrameType.HandshakeInit);

      const decoded = decodeHandshakeInit(frame);
      expect(decoded.type).toBe("handshake.init");
      expect(decoded.initPublicKey).toEqual(initPublicKey);
    });

    it("rejects wrong payload size", () => {
      // Create frame with wrong payload size
      const wrongPayload = new Uint8Array(16);
      const encoded = encodeFrame(FrameType.HandshakeInit, 1n, wrongPayload);
      const frame = decodeFrame(encoded);
      expect(() => decodeHandshakeInit(frame)).toThrow(SbrpError);
    });

    it("rejects wrong frame type", () => {
      const payload = new Uint8Array(32);
      const encoded = encodeFrame(FrameType.Data, 1n, payload);
      const frame = decodeFrame(encoded);
      expect(() => decodeHandshakeInit(frame)).toThrow(SbrpError);
    });

    it("rejects zero sessionId on decode", () => {
      // Manually construct frame with sessionId=0 (bypassing encode validation)
      const payload = new Uint8Array(32);
      const frame = new Uint8Array(FRAME_HEADER_SIZE + 32);
      frame[0] = FrameType.HandshakeInit;
      new DataView(frame.buffer).setUint32(1, 32, false);
      // sessionId left as 0
      frame.set(payload, FRAME_HEADER_SIZE);

      // Validation now happens at decodeFrame level (via readFrameHeader)
      expect(() => decodeFrame(frame)).toThrow(SbrpError);
      expect(() => decodeFrame(frame)).toThrow(/non-zero sessionId/);
    });
  });

  describe("HandshakeAccept", () => {
    it("encodes and decodes correctly", () => {
      const identityPublicKey = new Uint8Array(32).fill(0xab);
      const acceptPublicKey = new Uint8Array(32).fill(0xcd);
      const signature = new Uint8Array(64).fill(0xef);
      const accept: HandshakeAccept = {
        type: "handshake.accept",
        identityPublicKey,
        acceptPublicKey,
        signature,
      };

      const encoded = encodeHandshakeAccept(2n, accept);
      expect(encoded.length).toBe(
        FRAME_HEADER_SIZE + HANDSHAKE_ACCEPT_PAYLOAD_SIZE,
      );

      const frame = decodeFrame(encoded);
      expect(frame.type).toBe(FrameType.HandshakeAccept);

      const decoded = decodeHandshakeAccept(frame);
      expect(decoded.type).toBe("handshake.accept");
      expect(decoded.identityPublicKey).toEqual(identityPublicKey);
      expect(decoded.acceptPublicKey).toEqual(acceptPublicKey);
      expect(decoded.signature).toEqual(signature);
    });

    it("rejects wrong payload size", () => {
      const wrongPayload = new Uint8Array(50);
      const encoded = encodeFrame(FrameType.HandshakeAccept, 1n, wrongPayload);
      const frame = decodeFrame(encoded);
      expect(() => decodeHandshakeAccept(frame)).toThrow(SbrpError);
    });

    it("rejects zero sessionId on decode", () => {
      const payload = new Uint8Array(128);
      const frame = new Uint8Array(FRAME_HEADER_SIZE + 128);
      frame[0] = FrameType.HandshakeAccept;
      new DataView(frame.buffer).setUint32(1, 128, false);
      frame.set(payload, FRAME_HEADER_SIZE);

      // Validation happens at decodeFrame level (via readFrameHeader)
      expect(() => decodeFrame(frame)).toThrow(/non-zero sessionId/);
    });
  });

  describe("Data (encrypted)", () => {
    it("encodes and decodes correctly", () => {
      // Minimum: nonce (12) + authTag (16) = 28 bytes
      const data = new Uint8Array(28 + 10); // 10 bytes ciphertext
      // Set nonce with sequence number 42 (bytes 4-11)
      new DataView(data.buffer).setBigUint64(4, 42n, false);

      const message: EncryptedMessage = {
        type: "encrypted",
        seq: 42n,
        data,
      };

      const encoded = encodeData(3n, message);
      const frame = decodeFrame(encoded);
      expect(frame.type).toBe(FrameType.Data);

      const decoded = decodeData(frame);
      expect(decoded.type).toBe("encrypted");
      expect(decoded.seq).toBe(42n);
      expect(decoded.data).toEqual(data);
    });

    it("rejects payload too short for nonce+tag", () => {
      const shortPayload = new Uint8Array(20);
      const encoded = encodeFrame(FrameType.Data, 1n, shortPayload);
      const frame = decodeFrame(encoded);
      expect(() => decodeData(frame)).toThrow(SbrpError);
    });

    it("rejects zero sessionId on decode", () => {
      const payload = new Uint8Array(28);
      const frame = new Uint8Array(FRAME_HEADER_SIZE + 28);
      frame[0] = FrameType.Data;
      new DataView(frame.buffer).setUint32(1, 28, false);
      frame.set(payload, FRAME_HEADER_SIZE);

      // Validation happens at decodeFrame level (via readFrameHeader)
      expect(() => decodeFrame(frame)).toThrow(/non-zero sessionId/);
    });
  });

  describe("Ping / Pong", () => {
    it("encodes Ping with zero sessionId (connection-scoped)", () => {
      const ping = encodePing();
      const frame = decodeFrame(ping);
      expect(frame.type).toBe(FrameType.Ping);
      expect(frame.sessionId).toBe(0n);
      expect(frame.payload.length).toBe(0);
    });

    it("encodes Pong with zero sessionId", () => {
      const pong = encodePong();
      const frame = decodeFrame(pong);
      expect(frame.type).toBe(FrameType.Pong);
      expect(frame.sessionId).toBe(0n);
    });

    it("roundtrips payload for RTT measurement", () => {
      const rttNonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const ping = encodePing(rttNonce);
      const frame = decodeFrame(ping);
      expect(frame.payload).toEqual(rttNonce);

      // Pong should echo the same payload
      const pong = encodePong(rttNonce);
      const pongFrame = decodeFrame(pong);
      expect(pongFrame.payload).toEqual(rttNonce);
    });
  });

  describe("Signal", () => {
    it("encodes and decodes ready signal", () => {
      const encoded = encodeSignal(5n, SignalCode.Ready);
      const frame = decodeFrame(encoded);
      expect(frame.type).toBe(FrameType.Signal);
      expect(frame.sessionId).toBe(5n);

      const signal = decodeSignal(frame);
      expect(signal.signal).toBe(SignalCode.Ready);
      expect(signal.reason).toBe(SignalReason.None);
    });

    it("encodes and decodes close signal with reason", () => {
      const encoded = encodeSignal(
        5n,
        SignalCode.Close,
        SignalReason.StateLost,
      );
      const frame = decodeFrame(encoded);

      const signal = decodeSignal(frame);
      expect(signal.signal).toBe(SignalCode.Close);
      expect(signal.reason).toBe(SignalReason.StateLost);
    });

    it("supports all reason codes", () => {
      for (const reason of [
        SignalReason.None,
        SignalReason.StateLost,
        SignalReason.Shutdown,
        SignalReason.Policy,
        SignalReason.Error,
      ]) {
        const encoded = encodeSignal(1n, SignalCode.Close, reason);
        const frame = decodeFrame(encoded);
        const signal = decodeSignal(frame);
        expect(signal.reason).toBe(reason);
      }
    });

    it("uses None as default reason for ready signal", () => {
      const encoded = encodeSignal(5n, SignalCode.Ready);
      const frame = decodeFrame(encoded);
      const signal = decodeSignal(frame);
      expect(signal.reason).toBe(SignalReason.None);
    });

    it("rejects unknown signal code", () => {
      const payload = new Uint8Array([0xff, 0x00]); // Unknown signal, valid reason
      const encoded = encodeFrame(FrameType.Signal, 1n, payload);
      const frame = decodeFrame(encoded);
      expect(() => decodeSignal(frame)).toThrow(SbrpError);
      expect(() => decodeSignal(frame)).toThrow(/Unknown signal code/);
    });

    it("rejects unknown signal reason", () => {
      const payload = new Uint8Array([0x01, 0xff]); // Valid signal (Close), unknown reason
      const encoded = encodeFrame(FrameType.Signal, 1n, payload);
      const frame = decodeFrame(encoded);
      expect(() => decodeSignal(frame)).toThrow(SbrpError);
      expect(() => decodeSignal(frame)).toThrow(/Unknown signal reason/);
    });

    it("rejects wrong payload size", () => {
      const wrongPayload = new Uint8Array(3);
      const encoded = encodeFrame(FrameType.Signal, 1n, wrongPayload);
      const frame = decodeFrame(encoded);
      expect(() => decodeSignal(frame)).toThrow(SbrpError);
      expect(() => decodeSignal(frame)).toThrow(
        new RegExp(`${SIGNAL_PAYLOAD_SIZE} bytes`),
      );
    });
  });

  describe("Control", () => {
    it("encodes and decodes with message", () => {
      const encoded = encodeControl(
        0n,
        WireControlCode.Unauthorized,
        "Access denied",
      );
      const frame = decodeFrame(encoded);
      expect(frame.type).toBe(FrameType.Control);

      const control = decodeControl(frame);
      expect(control.code).toBe(WireControlCode.Unauthorized);
      expect(control.message).toBe("Access denied");
    });

    it("encodes and decodes without message", () => {
      const encoded = encodeControl(0n, WireControlCode.RateLimited);
      const frame = decodeFrame(encoded);
      const control = decodeControl(frame);
      expect(control.code).toBe(WireControlCode.RateLimited);
      expect(control.message).toBe("");
    });

    it("encodes session state notifications", () => {
      const encoded = encodeControl(5n, WireControlCode.SessionPaused);
      const frame = decodeFrame(encoded);
      expect(frame.sessionId).toBe(5n);

      const control = decodeControl(frame);
      expect(control.code).toBe(WireControlCode.SessionPaused);
    });

    it("handles invalid UTF-8 by replacing", () => {
      // Create control frame with invalid UTF-8 in message
      const payload = new Uint8Array([0x01, 0x01, 0xff, 0xfe]); // code 0x0101 + invalid UTF-8
      const encoded = encodeFrame(FrameType.Control, 0n, payload);
      const frame = decodeFrame(encoded);
      const control = decodeControl(frame);
      // Invalid bytes should be replaced with U+FFFD
      expect(control.message).toContain("\ufffd");
    });

    it("rejects payload too short", () => {
      const shortPayload = new Uint8Array(1);
      const encoded = encodeFrame(FrameType.Control, 0n, shortPayload);
      const frame = decodeFrame(encoded);
      expect(() => decodeControl(frame)).toThrow(SbrpError);
    });

    it("rejects unknown control code", () => {
      const payload = new Uint8Array([0x99, 0x99]); // Unknown code 0x9999
      const encoded = encodeFrame(FrameType.Control, 0n, payload);
      const frame = decodeFrame(encoded);
      expect(() => decodeControl(frame)).toThrow(SbrpError);
      expect(() => decodeControl(frame)).toThrow(/Unknown control code/);
    });
  });

  describe("isTerminalCode", () => {
    it("returns true for terminal codes", () => {
      expect(isTerminalCode(WireControlCode.Unauthorized)).toBe(true);
      expect(isTerminalCode(WireControlCode.Forbidden)).toBe(true);
      expect(isTerminalCode(WireControlCode.DaemonNotFound)).toBe(true);
      expect(isTerminalCode(WireControlCode.SessionNotFound)).toBe(true);
      expect(isTerminalCode(WireControlCode.SessionExpired)).toBe(true);
      expect(isTerminalCode(WireControlCode.MalformedFrame)).toBe(true);
      expect(isTerminalCode(WireControlCode.PayloadTooLarge)).toBe(true);
      expect(isTerminalCode(WireControlCode.InvalidFrameType)).toBe(true);
      expect(isTerminalCode(WireControlCode.InvalidSessionId)).toBe(true);
      expect(isTerminalCode(WireControlCode.DisallowedSender)).toBe(true);
      expect(isTerminalCode(WireControlCode.InternalError)).toBe(true);
    });

    it("returns false for non-terminal codes", () => {
      expect(isTerminalCode(WireControlCode.DaemonOffline)).toBe(false);
      expect(isTerminalCode(WireControlCode.RateLimited)).toBe(false);
      expect(isTerminalCode(WireControlCode.SessionPaused)).toBe(false);
      expect(isTerminalCode(WireControlCode.SessionResumed)).toBe(false);
      expect(isTerminalCode(WireControlCode.SessionEnded)).toBe(false);
      expect(isTerminalCode(WireControlCode.SessionPending)).toBe(false);
    });
  });

  describe("wire code values (§14.1 compliance)", () => {
    it("uses correct hex values for wire codes", () => {
      // Authentication (0x01xx)
      expect(WireControlCode.Unauthorized).toBe(0x0101);
      expect(WireControlCode.Forbidden).toBe(0x0102);

      // Routing (0x02xx)
      expect(WireControlCode.DaemonNotFound).toBe(0x0201);
      expect(WireControlCode.DaemonOffline).toBe(0x0202);

      // Session (0x03xx)
      expect(WireControlCode.SessionNotFound).toBe(0x0301);
      expect(WireControlCode.SessionExpired).toBe(0x0302);

      // Wire Format (0x04xx)
      expect(WireControlCode.MalformedFrame).toBe(0x0401);
      expect(WireControlCode.PayloadTooLarge).toBe(0x0402);
      expect(WireControlCode.InvalidFrameType).toBe(0x0403);
      expect(WireControlCode.InvalidSessionId).toBe(0x0404);
      expect(WireControlCode.DisallowedSender).toBe(0x0405);

      // Internal (0x06xx)
      expect(WireControlCode.InternalError).toBe(0x0601);

      // Rate Limiting (0x09xx)
      expect(WireControlCode.RateLimited).toBe(0x0901);

      // Session State (0x10xx)
      expect(WireControlCode.SessionPaused).toBe(0x1001);
      expect(WireControlCode.SessionResumed).toBe(0x1002);
      expect(WireControlCode.SessionEnded).toBe(0x1003);
      expect(WireControlCode.SessionPending).toBe(0x1004);
    });

    it("encodes InvalidSessionId control frame correctly", () => {
      const encoded = encodeControl(
        0n,
        WireControlCode.InvalidSessionId,
        "test",
      );
      const frame = decodeFrame(encoded);
      const control = decodeControl(frame);
      expect(control.code).toBe(0x0404);
    });

    it("encodes InternalError control frame correctly", () => {
      const encoded = encodeControl(0n, WireControlCode.InternalError, "test");
      const frame = decodeFrame(encoded);
      const control = decodeControl(frame);
      expect(control.code).toBe(0x0601);
    });
  });

  describe("signal reason values (§13.4 compliance)", () => {
    it("uses correct hex values for signal reasons", () => {
      expect(SignalReason.None).toBe(0x00);
      expect(SignalReason.StateLost).toBe(0x01);
      expect(SignalReason.Shutdown).toBe(0x02);
      expect(SignalReason.Policy).toBe(0x03);
      expect(SignalReason.Error).toBe(0x04);
    });

    it("encodes signal with StateLost reason at 0x01", () => {
      const encoded = encodeSignal(
        1n,
        SignalCode.Close,
        SignalReason.StateLost,
      );
      const frame = decodeFrame(encoded);
      expect(frame.payload[1]).toBe(0x01);
    });

    it("encodes signal with Error reason at 0x04", () => {
      const encoded = encodeSignal(1n, SignalCode.Close, SignalReason.Error);
      const frame = decodeFrame(encoded);
      expect(frame.payload[1]).toBe(0x04);
    });
  });

  describe("control code conversion", () => {
    it("converts wire-transmittable SbrpErrorCodes to WireControlCode", () => {
      // Authentication
      expect(toWireControlCode(SbrpErrorCode.Unauthorized)).toBe(
        WireControlCode.Unauthorized,
      );
      expect(toWireControlCode(SbrpErrorCode.Forbidden)).toBe(
        WireControlCode.Forbidden,
      );

      // Routing
      expect(toWireControlCode(SbrpErrorCode.DaemonNotFound)).toBe(
        WireControlCode.DaemonNotFound,
      );
      expect(toWireControlCode(SbrpErrorCode.DaemonOffline)).toBe(
        WireControlCode.DaemonOffline,
      );

      // Session
      expect(toWireControlCode(SbrpErrorCode.SessionNotFound)).toBe(
        WireControlCode.SessionNotFound,
      );
      expect(toWireControlCode(SbrpErrorCode.SessionExpired)).toBe(
        WireControlCode.SessionExpired,
      );

      // Wire format
      expect(toWireControlCode(SbrpErrorCode.MalformedFrame)).toBe(
        WireControlCode.MalformedFrame,
      );
      expect(toWireControlCode(SbrpErrorCode.PayloadTooLarge)).toBe(
        WireControlCode.PayloadTooLarge,
      );
      expect(toWireControlCode(SbrpErrorCode.InvalidFrameType)).toBe(
        WireControlCode.InvalidFrameType,
      );
      expect(toWireControlCode(SbrpErrorCode.InvalidSessionId)).toBe(
        WireControlCode.InvalidSessionId,
      );
      expect(toWireControlCode(SbrpErrorCode.DisallowedSender)).toBe(
        WireControlCode.DisallowedSender,
      );

      // Internal
      expect(toWireControlCode(SbrpErrorCode.InternalError)).toBe(
        WireControlCode.InternalError,
      );

      // Rate limiting
      expect(toWireControlCode(SbrpErrorCode.RateLimited)).toBe(
        WireControlCode.RateLimited,
      );

      // Session state
      expect(toWireControlCode(SbrpErrorCode.SessionPaused)).toBe(
        WireControlCode.SessionPaused,
      );
      expect(toWireControlCode(SbrpErrorCode.SessionResumed)).toBe(
        WireControlCode.SessionResumed,
      );
      expect(toWireControlCode(SbrpErrorCode.SessionEnded)).toBe(
        WireControlCode.SessionEnded,
      );
      expect(toWireControlCode(SbrpErrorCode.SessionPending)).toBe(
        WireControlCode.SessionPending,
      );
    });

    it("converts all WireControlCode to SbrpErrorCode", () => {
      expect(fromWireControlCode(WireControlCode.Unauthorized)).toBe(
        SbrpErrorCode.Unauthorized,
      );
      expect(fromWireControlCode(WireControlCode.MalformedFrame)).toBe(
        SbrpErrorCode.MalformedFrame,
      );
      expect(fromWireControlCode(WireControlCode.InvalidSessionId)).toBe(
        SbrpErrorCode.InvalidSessionId,
      );
      expect(fromWireControlCode(WireControlCode.InternalError)).toBe(
        SbrpErrorCode.InternalError,
      );
      expect(fromWireControlCode(WireControlCode.SessionPaused)).toBe(
        SbrpErrorCode.SessionPaused,
      );
    });

    it("throws on endpoint-only codes (never transmitted on wire)", () => {
      expect(() =>
        toWireControlCode(SbrpErrorCode.IdentityKeyChanged),
      ).toThrow();
      expect(() => toWireControlCode(SbrpErrorCode.HandshakeFailed)).toThrow();
      expect(() => toWireControlCode(SbrpErrorCode.HandshakeTimeout)).toThrow();
      expect(() => toWireControlCode(SbrpErrorCode.DecryptFailed)).toThrow();
      expect(() => toWireControlCode(SbrpErrorCode.SequenceError)).toThrow();
    });

    it("throws on unknown wire codes", () => {
      expect(() => fromWireControlCode(0x9999 as WireControlCode)).toThrow();
    });
  });

  describe("FrameDecoder", () => {
    it("decodes single complete frame", () => {
      const decoder = new FrameDecoder();
      const frame = encodePing();
      const frames = [...decoder.push(frame)];
      expect(frames.length).toBe(1);
      expect(frames[0]!.type).toBe(FrameType.Ping);
      expect(frames[0]!.sessionId).toBe(0n);
    });

    it("decodes multiple frames in one push", () => {
      const decoder = new FrameDecoder();
      const frame1 = encodePing();
      const frame2 = encodePong();
      const combined = new Uint8Array(frame1.length + frame2.length);
      combined.set(frame1, 0);
      combined.set(frame2, frame1.length);

      const frames = [...decoder.push(combined)];
      expect(frames.length).toBe(2);
      expect(frames[0]!.type).toBe(FrameType.Ping);
      expect(frames[1]!.type).toBe(FrameType.Pong);
    });

    it("buffers incomplete frames", () => {
      const decoder = new FrameDecoder();
      const frame = encodeControl(0n, WireControlCode.RateLimited, "slow down");

      // Push header only
      let frames = [...decoder.push(frame.subarray(0, FRAME_HEADER_SIZE))];
      expect(frames.length).toBe(0);
      expect(decoder.bufferedBytes).toBe(FRAME_HEADER_SIZE);

      // Push rest
      frames = [...decoder.push(frame.subarray(FRAME_HEADER_SIZE))];
      expect(frames.length).toBe(1);
      expect(frames[0]!.type).toBe(FrameType.Control);
      expect(decoder.bufferedBytes).toBe(0);
    });

    it("handles byte-by-byte streaming", () => {
      const decoder = new FrameDecoder();
      const frame = encodePing();
      const allFrames: typeof frame extends Uint8Array
        ? ReturnType<typeof decodeFrame>[]
        : never = [];

      for (let i = 0; i < frame.length; i++) {
        const frames = [...decoder.push(frame.subarray(i, i + 1))];
        allFrames.push(...frames);
      }

      expect(allFrames.length).toBe(1);
      expect(allFrames[0]!.type).toBe(FrameType.Ping);
    });

    it("resets state correctly", () => {
      const decoder = new FrameDecoder();
      const frame = encodePing();
      // Must consume the generator to trigger buffering
      [...decoder.push(frame.subarray(0, 5))];
      expect(decoder.bufferedBytes).toBe(5);

      decoder.reset();
      expect(decoder.bufferedBytes).toBe(0);
    });

    it("rejects invalid frames with zero sessionId", () => {
      const decoder = new FrameDecoder();
      // Manually construct invalid HandshakeInit with sessionId=0
      const frame = new Uint8Array(FRAME_HEADER_SIZE + 32);
      frame[0] = FrameType.HandshakeInit;
      new DataView(frame.buffer).setUint32(1, 32, false);
      // sessionId left as 0
      frame.set(new Uint8Array(32), FRAME_HEADER_SIZE);

      expect(() => [...decoder.push(frame)]).toThrow(/non-zero sessionId/);
    });
  });
});
