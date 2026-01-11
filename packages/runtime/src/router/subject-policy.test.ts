// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import {
  defaultSubjectPolicy,
  getDefaultMode,
  validateSubject,
  type SubjectPolicy,
} from "./subject-policy.js";

describe("validateSubject", () => {
  describe("with default policy", () => {
    it("accepts rpc/ subjects", () => {
      const result = validateSubject("rpc/getUser");
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("rpc");
    });

    it("accepts event/ subjects", () => {
      const result = validateSubject("event/user.joined");
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("event");
    });

    it("accepts app/ subjects", () => {
      const result = validateSubject("app/custom.data");
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("custom");
    });

    it("rejects stream/ as reserved (code 1003)", () => {
      const result = validateSubject("stream/data");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(1003);
      expect(result.errorMessage).toContain("stream/");
    });

    it("rejects unknown prefix (code 1002)", () => {
      const result = validateSubject("unknown/path");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(1002);
      expect(result.errorMessage).toBe("Invalid subject namespace");
    });

    it("rejects empty subject", () => {
      const result = validateSubject("");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(1002);
    });
  });

  describe("with custom policy", () => {
    const customPolicy: SubjectPolicy = {
      allowedPrefixes: ["rpc/", "debug/", "admin/"],
      reservedPrefixes: ["admin/dangerous/"],
    };

    it("accepts custom allowed prefixes", () => {
      const result = validateSubject("debug/trace", customPolicy);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("custom");
    });

    it("rejects reserved sub-prefix", () => {
      const result = validateSubject("admin/dangerous/nuke", customPolicy);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(1003);
    });

    it("accepts non-reserved admin prefix", () => {
      const result = validateSubject("admin/safe", customPolicy);
      expect(result.valid).toBe(true);
    });
  });

  describe("with custom classifier", () => {
    const policyWithClassifier: SubjectPolicy = {
      allowedPrefixes: ["rpc/", "event/", "custom/"],
      reservedPrefixes: [],
      classify: (subject) => {
        if (subject.startsWith("custom/rpc.")) return "rpc";
        return "custom";
      },
    };

    it("uses custom classifier", () => {
      const result = validateSubject(
        "custom/rpc.special",
        policyWithClassifier,
      );
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("rpc");
    });
  });
});

describe("getDefaultMode", () => {
  it("returns exclusive for rpc", () => {
    expect(getDefaultMode("rpc")).toBe("exclusive");
  });

  it("returns broadcast for event", () => {
    expect(getDefaultMode("event")).toBe("broadcast");
  });

  it("returns broadcast for custom", () => {
    expect(getDefaultMode("custom")).toBe("broadcast");
  });

  it("returns broadcast for reserved", () => {
    expect(getDefaultMode("reserved")).toBe("broadcast");
  });
});

describe("defaultSubjectPolicy", () => {
  it("has correct allowed prefixes", () => {
    expect(defaultSubjectPolicy.allowedPrefixes).toContain("rpc/");
    expect(defaultSubjectPolicy.allowedPrefixes).toContain("event/");
    expect(defaultSubjectPolicy.allowedPrefixes).toContain("app/");
    expect(defaultSubjectPolicy.allowedPrefixes).toContain("stream/");
  });

  it("has stream/ as reserved", () => {
    expect(defaultSubjectPolicy.reservedPrefixes).toContain("stream/");
  });
});
