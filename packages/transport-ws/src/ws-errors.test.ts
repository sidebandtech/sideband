// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { deriveCloseKind, errorKindFromWsCloseCode } from "./ws-errors.js";

describe("errorKindFromWsCloseCode", () => {
  it("returns null for clean close (1000)", () => {
    expect(errorKindFromWsCloseCode(1000)).toBeNull();
  });

  it("maps standard close codes correctly", () => {
    expect(errorKindFromWsCloseCode(1001)).toBe("abnormal_close");
    expect(errorKindFromWsCloseCode(1002)).toBe("transport_failure");
    expect(errorKindFromWsCloseCode(1003)).toBe("transport_failure");
    expect(errorKindFromWsCloseCode(1006)).toBe("abnormal_close");
    expect(errorKindFromWsCloseCode(1008)).toBe("policy_violation");
    expect(errorKindFromWsCloseCode(1009)).toBe("message_too_large");
    expect(errorKindFromWsCloseCode(1010)).toBe("subprotocol_mismatch");
    expect(errorKindFromWsCloseCode(1011)).toBe("buffer_overflow");
    expect(errorKindFromWsCloseCode(1012)).toBe("abnormal_close");
    expect(errorKindFromWsCloseCode(1013)).toBe("abnormal_close");
    expect(errorKindFromWsCloseCode(1015)).toBe("tls_failure");
  });

  it("maps private use codes to transport_failure", () => {
    expect(errorKindFromWsCloseCode(4000)).toBe("transport_failure");
    expect(errorKindFromWsCloseCode(4500)).toBe("transport_failure");
    expect(errorKindFromWsCloseCode(4999)).toBe("transport_failure");
  });
});

describe("deriveCloseKind", () => {
  it("returns connection_refused for 1006 with no traffic", () => {
    expect(deriveCloseKind(1006, { ioBytes: { sent: 0, received: 0 } })).toBe(
      "connection_refused",
    );
  });

  it("returns abnormal_close for 1006 with sent traffic", () => {
    expect(deriveCloseKind(1006, { ioBytes: { sent: 100, received: 0 } })).toBe(
      "abnormal_close",
    );
  });

  it("returns abnormal_close for 1006 with received traffic", () => {
    expect(deriveCloseKind(1006, { ioBytes: { sent: 0, received: 50 } })).toBe(
      "abnormal_close",
    );
  });

  it("returns abnormal_close for 1006 with bidirectional traffic", () => {
    expect(
      deriveCloseKind(1006, { ioBytes: { sent: 100, received: 50 } }),
    ).toBe("abnormal_close");
  });

  it("delegates to errorKindFromWsCloseCode for other codes", () => {
    const diagnostics = { ioBytes: { sent: 100, received: 50 } };
    expect(deriveCloseKind(1001, diagnostics)).toBe("abnormal_close");
    expect(deriveCloseKind(1008, diagnostics)).toBe("policy_violation");
    expect(deriveCloseKind(1009, diagnostics)).toBe("message_too_large");
    expect(deriveCloseKind(1011, diagnostics)).toBe("buffer_overflow");
  });

  it("returns abnormal_close for clean close code (1000)", () => {
    // Clean close (1000) returns null from errorKindFromWsCloseCode,
    // so deriveCloseKind falls back to abnormal_close
    expect(deriveCloseKind(1000, { ioBytes: { sent: 0, received: 0 } })).toBe(
      "abnormal_close",
    );
  });
});
