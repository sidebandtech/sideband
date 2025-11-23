// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "bun:test";
import {
  isValidRpcSubject,
  asRpcSubject,
  SUBJECT_PREFIXES,
  ProtocolViolation,
} from "./subject.js";
import { ProtocolError } from "@sideband/protocol";

describe("RPC Subject Validation", () => {
  describe("isValidRpcSubject", () => {
    it("accepts RPC subjects", () => {
      expect(isValidRpcSubject("rpc/getUser")).toBe(true);
      expect(isValidRpcSubject("rpc/create.item")).toBe(true);
      expect(isValidRpcSubject("rpc/")).toBe(true);
    });

    it("accepts event subjects", () => {
      expect(isValidRpcSubject("event/user.joined")).toBe(true);
      expect(isValidRpcSubject("event/data-changed")).toBe(true);
      expect(isValidRpcSubject("event/")).toBe(true);
    });

    it("accepts stream subjects", () => {
      expect(isValidRpcSubject("stream/abc123/chunk")).toBe(true);
      expect(isValidRpcSubject("stream/data")).toBe(true);
    });

    it("accepts app subjects", () => {
      expect(isValidRpcSubject("app/custom.namespace")).toBe(true);
      expect(isValidRpcSubject("app/org.example/mydata")).toBe(true);
      expect(isValidRpcSubject("app/")).toBe(true);
    });

    it("rejects invalid prefixes", () => {
      expect(isValidRpcSubject("invalid/subject")).toBe(false);
      expect(isValidRpcSubject("message/hello")).toBe(false);
      expect(isValidRpcSubject("getUser")).toBe(false);
    });

    it("rejects empty strings", () => {
      expect(isValidRpcSubject("")).toBe(false);
    });

    it("rejects strings exceeding 256 characters", () => {
      const tooLong = "rpc/" + "a".repeat(253);
      expect(isValidRpcSubject(tooLong)).toBe(false);
    });

    it("rejects strings with null bytes", () => {
      expect(isValidRpcSubject("rpc/test\0hack")).toBe(false);
    });

    it("accepts strings up to 256 characters", () => {
      const maxLength = "rpc/" + "a".repeat(252); // 4 + 252 = 256
      expect(isValidRpcSubject(maxLength)).toBe(true);
    });
  });

  describe("asRpcSubject", () => {
    it("brands valid subjects", () => {
      const subject = asRpcSubject("rpc/getUser");
      // Type system confirms the brand, so we just verify the string value
      expect(subject).toBe("rpc/getUser" as typeof subject);
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
        expect(message).toContain("rpc/");
        expect(message).toContain("event/");
      }
    });
  });

  describe("SUBJECT_PREFIXES", () => {
    it("exports all reserved prefixes", () => {
      expect(SUBJECT_PREFIXES.RPC).toBe("rpc/");
      expect(SUBJECT_PREFIXES.EVENT).toBe("event/");
      expect(SUBJECT_PREFIXES.STREAM).toBe("stream/");
      expect(SUBJECT_PREFIXES.APP).toBe("app/");
    });
  });
});
