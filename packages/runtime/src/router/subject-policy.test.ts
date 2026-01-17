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
    it("accepts rpc channel (exact match)", () => {
      const result = validateSubject("rpc");
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("rpc");
    });

    it("accepts event channel (exact match)", () => {
      const result = validateSubject("event");
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("event");
    });

    it("accepts app/ prefix subjects", () => {
      const result = validateSubject("app/custom.data");
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("custom");
    });

    it("rejects stream channel as reserved (code 1003)", () => {
      const result = validateSubject("stream");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(1003);
      expect(result.errorMessage).toContain("stream");
    });

    it("rejects unknown subject (code 1002)", () => {
      const result = validateSubject("unknown/path");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(1002);
      expect(result.errorMessage).toBe("Invalid subject namespace");
    });

    it("rejects old prefix-style subjects", () => {
      const result = validateSubject("rpc/getUser");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(1002);
    });

    it("rejects empty subject", () => {
      const result = validateSubject("");
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(1002);
    });
  });

  describe("with custom policy", () => {
    const customPolicy: SubjectPolicy = {
      allowedChannels: ["rpc", "debug"],
      reservedChannels: ["admin"],
      allowedPrefixes: ["app/", "custom/"],
    };

    it("accepts custom allowed channels", () => {
      const result = validateSubject("debug", customPolicy);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("custom");
    });

    it("accepts custom allowed prefixes", () => {
      const result = validateSubject("custom/trace", customPolicy);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("custom");
    });

    it("rejects reserved channel", () => {
      const result = validateSubject("admin", customPolicy);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(1003);
    });

    it("accepts non-reserved channels", () => {
      const result = validateSubject("rpc", customPolicy);
      expect(result.valid).toBe(true);
    });
  });

  describe("with custom classifier", () => {
    const policyWithClassifier: SubjectPolicy = {
      allowedChannels: ["rpc", "event"],
      reservedChannels: [],
      allowedPrefixes: ["app/"],
      classify: (subject) => {
        if (subject.startsWith("app/rpc.")) return "rpc";
        return "custom";
      },
    };

    it("uses custom classifier for prefixed subjects", () => {
      const result = validateSubject("app/rpc.special", policyWithClassifier);
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
  it("has correct allowed channels", () => {
    expect(defaultSubjectPolicy.allowedChannels).toContain("rpc");
    expect(defaultSubjectPolicy.allowedChannels).toContain("event");
  });

  it("has stream as reserved channel", () => {
    expect(defaultSubjectPolicy.reservedChannels).toContain("stream");
  });

  it("has app/ as allowed prefix", () => {
    expect(defaultSubjectPolicy.allowedPrefixes).toContain("app/");
  });
});
