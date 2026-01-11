// SPDX-License-Identifier: Apache-2.0

import {
  asPeerId,
  createHandshakeFrame,
  encodeFrame,
  encodeHandshake,
  ErrorCode,
  ProtocolError,
} from "@sideband/protocol";
import { describe, expect, it, mock } from "bun:test";
import type { TransportConnection } from "../session/types.js";
import { SbpNegotiator } from "./sbp.js";

describe("SbpNegotiator", () => {
  const localPeerId = asPeerId("local-peer");
  const remotePeerId = asPeerId("remote-peer");

  function createMockConnection(responses: Uint8Array[]): TransportConnection {
    let responseIdx = 0;
    return {
      id: "test-conn",
      endpoint: "ws://localhost:8080",
      send: mock(async () => {}),
      close: mock(async () => {}),
      inbound: {
        [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
          return {
            async next() {
              if (responseIdx < responses.length) {
                return { value: responses[responseIdx++]!, done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      },
    };
  }

  function createHandshakeResponse(peerId: string): Uint8Array {
    const payload = encodeHandshake({
      protocol: "sideband",
      version: "1",
      peerId: asPeerId(peerId),
      caps: ["rpc"],
    });
    return encodeFrame(createHandshakeFrame(payload));
  }

  describe("negotiate", () => {
    it("exchanges handshake and returns result", async () => {
      const negotiator = new SbpNegotiator({ peerId: localPeerId });
      const conn = createMockConnection([
        createHandshakeResponse("remote-peer"),
      ]);

      const result = await negotiator.negotiate(conn);

      expect(result.peerId).toBe(remotePeerId);
      expect(result.capabilities).toContain("rpc");
      expect(conn.send).toHaveBeenCalled();
    });

    it("includes capabilities in handshake", async () => {
      const negotiator = new SbpNegotiator({
        peerId: localPeerId,
        capabilities: ["rpc", "stream"],
      });
      const conn = createMockConnection([
        createHandshakeResponse("remote-peer"),
      ]);

      await negotiator.negotiate(conn);
      expect(conn.send).toHaveBeenCalled();
    });

    it("times out if no response", async () => {
      const negotiator = new SbpNegotiator({
        peerId: localPeerId,
        handshakeTimeoutMs: 50, // Short timeout for test
      });
      // Create a connection that never yields any data (simulates network stall)
      const conn: TransportConnection = {
        id: "test-conn",
        endpoint: "ws://localhost:8080",
        send: mock(async () => {}),
        close: mock(async () => {}),
        inbound: {
          async *[Symbol.asyncIterator]() {
            // Never yield, never return - simulates pending read
            await new Promise(() => {});
          },
        },
      };

      await expect(negotiator.negotiate(conn)).rejects.toThrow(
        "Handshake timeout",
      );
    });
  });

  describe("terminate", () => {
    it("sends close frame", async () => {
      const negotiator = new SbpNegotiator({ peerId: localPeerId });
      const conn = createMockConnection([]);

      await negotiator.terminate(conn, "test close");
      expect(conn.send).toHaveBeenCalled();
    });

    it("is idempotent (no error on closed connection)", async () => {
      const negotiator = new SbpNegotiator({ peerId: localPeerId });
      const conn: TransportConnection = {
        id: "test",
        endpoint: "ws://localhost",
        send: mock(async () => {
          throw new Error("closed");
        }),
        close: mock(async () => {}),
        inbound: {
          async *[Symbol.asyncIterator]() {},
        },
      };

      // Should not throw
      await negotiator.terminate(conn);
    });
  });

  describe("classifyError", () => {
    it("classifies ProtocolViolation as fatal", () => {
      const negotiator = new SbpNegotiator({ peerId: localPeerId });
      const error = new ProtocolError("violation", ErrorCode.ProtocolViolation);
      expect(negotiator.classifyError(error)).toBe("fatal");
    });

    it("classifies UnsupportedVersion as fatal", () => {
      const negotiator = new SbpNegotiator({ peerId: localPeerId });
      const error = new ProtocolError("version", ErrorCode.UnsupportedVersion);
      expect(negotiator.classifyError(error)).toBe("fatal");
    });

    it("classifies other errors as retryable", () => {
      const negotiator = new SbpNegotiator({ peerId: localPeerId });
      expect(negotiator.classifyError(new Error("network"))).toBe("retryable");
    });

    it("classifies InvalidFrame as retryable", () => {
      const negotiator = new SbpNegotiator({ peerId: localPeerId });
      const error = new ProtocolError("bad frame", ErrorCode.InvalidFrame);
      expect(negotiator.classifyError(error)).toBe("retryable");
    });
  });
});
