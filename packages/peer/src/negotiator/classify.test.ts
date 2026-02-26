// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { SbrpError, SbrpErrorCode } from "@sideband/secure-relay";
import { classifySbrpError } from "./classify.js";

describe("classifySbrpError", () => {
  it("classifies fatal codes as fatal", () => {
    const fatalCodes: SbrpErrorCode[] = [
      // Crypto/identity failures
      SbrpErrorCode.IdentityKeyChanged,
      SbrpErrorCode.HandshakeFailed,
      SbrpErrorCode.DecryptFailed,
      SbrpErrorCode.SequenceError,
      // Relay terminal: retrying won't help
      SbrpErrorCode.Unauthorized,
      SbrpErrorCode.Forbidden,
      SbrpErrorCode.DaemonNotFound,
      SbrpErrorCode.SessionNotFound,
      SbrpErrorCode.SessionExpired,
      SbrpErrorCode.MalformedFrame,
      SbrpErrorCode.PayloadTooLarge,
      SbrpErrorCode.InvalidFrameType,
      SbrpErrorCode.InvalidSessionId,
      SbrpErrorCode.DisallowedSender,
    ];
    for (const code of fatalCodes) {
      expect(classifySbrpError(new SbrpError(code, "test"))).toBe("fatal");
    }
  });

  it("classifies retryable codes as retryable", () => {
    const retryableCodes: SbrpErrorCode[] = [
      // Transient relay conditions — reconnect is valid
      SbrpErrorCode.DaemonOffline,
      SbrpErrorCode.RateLimited,
      SbrpErrorCode.Backpressure, // Terminal but transient: slow consumer closed, reconnect is valid
      SbrpErrorCode.InternalError, // Relay-side failure; not a client error, a healthy relay may succeed
      SbrpErrorCode.HandshakeTimeout,
      // Session state notifications
      SbrpErrorCode.SessionPaused,
      SbrpErrorCode.SessionResumed,
      SbrpErrorCode.SessionEnded,
      SbrpErrorCode.SessionPending,
    ];
    for (const code of retryableCodes) {
      expect(classifySbrpError(new SbrpError(code, "test"))).toBe("retryable");
    }
  });

  it("classifies non-SbrpError as retryable", () => {
    expect(classifySbrpError(new Error("network error"))).toBe("retryable");
    expect(classifySbrpError(new TypeError("unexpected"))).toBe("retryable");
  });
});
