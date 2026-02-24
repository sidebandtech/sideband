// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { PeerError, PeerErrorCode } from "./errors.js";
import { isValidEventName, matchPattern, validatePattern } from "./pattern.js";

describe("isValidEventName", () => {
  it("accepts single-segment names", () => {
    expect(isValidEventName("user")).toBe(true);
    expect(isValidEventName("hello")).toBe(true);
    expect(isValidEventName("a")).toBe(true);
  });

  it("accepts multi-segment names", () => {
    expect(isValidEventName("user.created")).toBe(true);
    expect(isValidEventName("user.profile.updated")).toBe(true);
  });

  it("accepts allowed characters: ALPHA, DIGIT, hyphen, underscore", () => {
    expect(isValidEventName("user-123_abc")).toBe(true);
    expect(isValidEventName("foo.bar-baz")).toBe(true);
  });

  it("rejects wildcards in event names", () => {
    expect(isValidEventName("user.*")).toBe(false);
    expect(isValidEventName("user.>")).toBe(false);
    expect(isValidEventName("*")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidEventName("")).toBe(false);
  });

  it("rejects empty segments", () => {
    expect(isValidEventName("user..created")).toBe(false);
    expect(isValidEventName(".user")).toBe(false);
    expect(isValidEventName("user.")).toBe(false);
  });

  it("rejects ** (glob syntax)", () => {
    expect(isValidEventName("user.**")).toBe(false);
  });

  it("rejects invalid characters", () => {
    expect(isValidEventName("user/created")).toBe(false);
    expect(isValidEventName("user created")).toBe(false);
    expect(isValidEventName("user#tag")).toBe(false);
  });
});

describe("validatePattern", () => {
  it("accepts valid exact patterns", () => {
    expect(() => validatePattern("user.created")).not.toThrow();
    expect(() => validatePattern("ping")).not.toThrow();
  });

  it("accepts * wildcard", () => {
    expect(() => validatePattern("user.*")).not.toThrow();
    expect(() => validatePattern("*.created")).not.toThrow();
  });

  it("accepts > as final segment", () => {
    expect(() => validatePattern("user.>")).not.toThrow();
    expect(() => validatePattern(">")).not.toThrow();
  });

  it("rejects > in non-final position", () => {
    expect(() => validatePattern(">.user")).toThrow(PeerError);
    expect(() => validatePattern("user.>.created")).toThrow(PeerError);
    try {
      validatePattern("user.>.created");
    } catch (e) {
      expect(e instanceof PeerError).toBe(true);
      expect((e as PeerError).code).toBe(PeerErrorCode.InvalidPattern);
    }
  });

  it("rejects ** with helpful error", () => {
    expect(() => validatePattern("user.**")).toThrow(PeerError);
    try {
      validatePattern("user.**");
    } catch (e) {
      expect((e as PeerError).message).toContain(">");
    }
  });

  it("rejects empty string", () => {
    expect(() => validatePattern("")).toThrow(PeerError);
  });

  it("rejects patterns exceeding 255 bytes", () => {
    const long = "a".repeat(256);
    expect(() => validatePattern(long)).toThrow(PeerError);
  });

  it("rejects empty segments", () => {
    expect(() => validatePattern("user..created")).toThrow(PeerError);
  });
});

describe("matchPattern", () => {
  it("exact match", () => {
    expect(matchPattern("user.created", "user.created")).toBe(true);
    expect(matchPattern("user.created", "user.deleted")).toBe(false);
  });

  it("* matches exactly one segment", () => {
    expect(matchPattern("user.*", "user.created")).toBe(true);
    expect(matchPattern("user.*", "user.deleted")).toBe(true);
    expect(matchPattern("user.*", "user.profile.updated")).toBe(false);
    expect(matchPattern("*.created", "user.created")).toBe(true);
    expect(matchPattern("*.created", "order.created")).toBe(true);
    expect(matchPattern("*.created", "created")).toBe(false);
  });

  it("> matches one or more trailing segments", () => {
    expect(matchPattern("user.>", "user.created")).toBe(true);
    expect(matchPattern("user.>", "user.profile.updated")).toBe(true);
    expect(matchPattern("user.>", "user")).toBe(false);
    expect(matchPattern(">", "user.created")).toBe(true);
    expect(matchPattern(">", "a.b.c.d")).toBe(true);
  });

  it("mixed wildcards", () => {
    expect(matchPattern("*.order.>", "customer.order.placed")).toBe(true);
    expect(matchPattern("*.order.>", "customer.order.item.added")).toBe(true);
    expect(matchPattern("*.order.>", "customer.cart.placed")).toBe(false);
  });

  it("no match when pattern has more segments", () => {
    expect(matchPattern("a.b.c", "a.b")).toBe(false);
  });
});
