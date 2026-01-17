// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "bun:test";
import { asRpcSubject, SUBJECT_CHANNELS, SUBJECT_PREFIXES } from "./subject.js";
import { ProtocolError } from "@sideband/protocol";

describe("RPC Subject Validation", () => {
  describe("asRpcSubject", () => {
    it("brands valid channel subjects", () => {
      const subject = asRpcSubject("rpc");
      // Type system confirms the brand, so we just verify the string value
      expect(subject).toBe("rpc" as typeof subject);
    });

    it("brands valid app/ prefix subjects", () => {
      const subject = asRpcSubject("app/custom");
      expect(subject).toBe("app/custom" as typeof subject);
    });

    it("throws ProtocolError on invalid subject", () => {
      expect(() => asRpcSubject("invalid/subject")).toThrow(ProtocolError);
      expect(() => asRpcSubject("")).toThrow(ProtocolError);
    });

    it("includes helpful error message", () => {
      try {
        asRpcSubject("badprefix/test");
        expect.unreachable();
      } catch (err) {
        const message = (err as ProtocolError).message;
        expect(message).toContain("rpc");
        expect(message).toContain("app/");
      }
    });
  });

  describe("SUBJECT_CHANNELS", () => {
    it("exports all channel subjects", () => {
      expect(SUBJECT_CHANNELS.RPC).toBe("rpc");
      expect(SUBJECT_CHANNELS.EVENT).toBe("event");
      expect(SUBJECT_CHANNELS.STREAM).toBe("stream");
    });
  });

  describe("SUBJECT_PREFIXES", () => {
    it("exports app/ prefix", () => {
      expect(SUBJECT_PREFIXES.APP).toBe("app/");
    });
  });
});
