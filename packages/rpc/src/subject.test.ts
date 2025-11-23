// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "bun:test";
import { asRpcSubject, SUBJECT_PREFIXES } from "./subject.js";
import { ProtocolError } from "@sideband/protocol";

describe("RPC Subject Validation", () => {
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
