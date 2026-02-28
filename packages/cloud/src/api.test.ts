// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { CloudApiError, extractDaemonIdFromToken } from "./api.js";

/** Build a minimal unsigned JWT with the given payload claims. */
function makeToken(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  return `${enc({ alg: "EdDSA" })}.${enc(payload)}.signature`;
}

describe("extractDaemonIdFromToken", () => {
  it("extracts did from a valid presence token", () => {
    const token = makeToken({ did: "d_abc123", role: "daemon" });
    expect(extractDaemonIdFromToken(token)).toBe("d_abc123");
  });

  it("throws CloudApiError for a non-JWT string", () => {
    expect(() => extractDaemonIdFromToken("notajwt")).toThrow(CloudApiError);
    expect(() => extractDaemonIdFromToken("notajwt")).toThrow("not a JWT");
  });

  it("throws CloudApiError for a two-segment string", () => {
    expect(() => extractDaemonIdFromToken("a.b")).toThrow(CloudApiError);
  });

  it("throws CloudApiError when did claim is absent", () => {
    const token = makeToken({ role: "daemon" });
    expect(() => extractDaemonIdFromToken(token)).toThrow(CloudApiError);
    expect(() => extractDaemonIdFromToken(token)).toThrow(
      "missing or empty did claim",
    );
  });

  it("throws CloudApiError when did claim is empty string", () => {
    const token = makeToken({ did: "", role: "daemon" });
    expect(() => extractDaemonIdFromToken(token)).toThrow(CloudApiError);
  });

  it("throws CloudApiError when payload is not valid JSON", () => {
    const badPayload = btoa("not-json")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    expect(() => extractDaemonIdFromToken(`header.${badPayload}.sig`)).toThrow(
      CloudApiError,
    );
  });

  it("throws with status 400 for all failure cases", () => {
    const cases = [
      "notajwt",
      makeToken({ role: "daemon" }),
      makeToken({ did: "" }),
    ];
    for (const token of cases) {
      let thrown: CloudApiError | undefined;
      try {
        extractDaemonIdFromToken(token);
      } catch (err) {
        thrown = err as CloudApiError;
      }
      expect(thrown).toBeInstanceOf(CloudApiError);
      expect(thrown!.status).toBe(400);
    }
  });
});
