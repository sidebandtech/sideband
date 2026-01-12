// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { errorKindFromWsCloseCode } from "./ws-errors.js";

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
    expect(errorKindFromWsCloseCode(1011)).toBe("transport_failure");
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
