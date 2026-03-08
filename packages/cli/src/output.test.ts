// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import {
  emitConnected,
  emitDisconnected,
  emitEcho,
  emitError,
  emitQcRenewed,
  emitReady,
  emitRpc,
  printQr,
} from "./output.js";

/** Capture stdout writes produced by fn. */
function captureStdout(fn: () => void): string {
  let captured = "";
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    captured +=
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return captured;
}

/** Capture stderr writes produced by fn. */
function captureStderr(fn: () => void): string {
  let captured = "";
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array) => {
    captured +=
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return captured;
}

/** Override process.stdout.columns for the duration of fn. */
function withColumns(cols: number, fn: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  Object.defineProperty(process.stdout, "columns", {
    value: cols,
    configurable: true,
    writable: true,
  });
  try {
    fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdout, "columns", descriptor);
    } else {
      // @ts-expect-error restoring to undefined
      process.stdout.columns = undefined;
    }
  }
}

/** Parse the first NDJSON line from captured output. */
function parseEvent(output: string): Record<string, unknown> {
  return JSON.parse(output.split("\n")[0]!) as Record<string, unknown>;
}

describe("NDJSON event contract", () => {
  it("emitReady produces correct schema", () => {
    const out = captureStdout(() =>
      emitReady({
        daemonId: "d_abc123",
        cliVersion: "0.1.0",
        configDir: "/home/user/.sideband",
        relayUrl: "wss://relay.sideband.cloud",
        quickConnectCode: "abcd-efgh-ijkl",
        quickConnectUrl: "https://sideband.cloud/connect#qc=abcd-efgh-ijkl",
        capabilities: ["stats"],
      }),
    );
    const ev = parseEvent(out);
    expect(ev["event"]).toBe("ready");
    expect(ev["daemonId"]).toBe("d_abc123");
    expect(ev["cliVersion"]).toBe("0.1.0");
    expect(ev["configDir"]).toBe("/home/user/.sideband");
    expect(ev["relayUrl"]).toBe("wss://relay.sideband.cloud");
    expect(ev["quickConnectCode"]).toBe("abcd-efgh-ijkl");
    expect(ev["quickConnectUrl"]).toBe(
      "https://sideband.cloud/connect#qc=abcd-efgh-ijkl",
    );
  });

  it("emitConnected produces correct schema", () => {
    const ev = parseEvent(captureStdout(() => emitConnected("peer_abc123")));
    expect(ev["event"]).toBe("connected");
    expect(ev["peerId"]).toBe("peer_abc123");
  });

  it("emitRpc produces correct schema", () => {
    const ev = parseEvent(
      captureStdout(() => emitRpc("peer_abc123", "$sideband/echo")),
    );
    expect(ev["event"]).toBe("rpc");
    expect(ev["peerId"]).toBe("peer_abc123");
    expect(ev["method"]).toBe("$sideband/echo");
  });

  it("emitEcho includes data payload", () => {
    const ev = parseEvent(
      captureStdout(() => emitEcho("peer_abc123", { msg: "hello" })),
    );
    expect(ev["event"]).toBe("rpc");
    expect(ev["method"]).toBe("$sideband/echo");
    expect(ev["data"]).toEqual({ msg: "hello" });
  });

  it("emitEcho does not throw on non-serializable data", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const ev = parseEvent(
      captureStdout(() => emitEcho("peer_abc123", circular)),
    );
    expect(ev["event"]).toBe("rpc");
    expect(ev["method"]).toBe("$sideband/echo");
    expect(typeof ev["data"]).toBe("string"); // fallback to String()
  });

  it("emitEcho normalizes undefined to null", () => {
    const ev = parseEvent(
      captureStdout(() => emitEcho("peer_abc123", undefined)),
    );
    expect(ev["data"]).toBeNull();
  });

  it("emitDisconnected produces correct schema", () => {
    const ev = parseEvent(captureStdout(() => emitDisconnected("peer_abc123")));
    expect(ev["event"]).toBe("disconnected");
    expect(ev["peerId"]).toBe("peer_abc123");
  });

  it("emitQcRenewed produces correct schema", () => {
    const expiresAt = "2026-03-05T12:44:05Z";
    const ev = parseEvent(
      captureStdout(() =>
        emitQcRenewed({
          code: "mnop-qrst-uvwx",
          url: "https://...",
          expiresAt,
        }),
      ),
    );
    expect(ev["event"]).toBe("quick_connect");
    expect(ev["code"]).toBe("mnop-qrst-uvwx");
    expect(ev["expiresAt"]).toBe(expiresAt);
  });

  it("emitReady output is valid JSON on first line", () => {
    const out = captureStdout(() =>
      emitReady({
        daemonId: "d_x",
        cliVersion: "0.0.0",
        configDir: "/tmp",
        relayUrl: "wss://relay",
        quickConnectCode: "code",
        quickConnectUrl: "https://url",
        capabilities: ["stats"],
      }),
    );
    // First line must be parseable JSON — critical for scripting consumers
    expect(() => JSON.parse(out.split("\n")[0]!)).not.toThrow();
  });

  it("emitError writes JSON to stdout and mirrors to stderr", () => {
    // Contract: stdout is authoritative for automation; stderr is a human mirror.
    // Both must fire on every error so piped consumers and operators both see it.
    let stdout = "";
    let stderr = "";
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk: string | Uint8Array) => {
      stdout +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    };
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderr +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    };
    try {
      emitError("something went wrong");
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    const ev = JSON.parse(stdout.split("\n")[0]!) as Record<string, unknown>;
    expect(ev["event"]).toBe("error");
    expect(ev["message"]).toBe("something went wrong");
    expect(stderr).toContain("something went wrong");
  });
});

describe("printQr width guard", () => {
  const url = "https://sideband.cloud/connect#qc=abcd-efgh-ijkl";

  it("skips rendering when terminal is too narrow", () => {
    // columns=10 is always narrower than any valid QR matrix width
    let out = "";
    withColumns(10, () => {
      out = captureStdout(() => printQr(url));
    });
    expect(out).toBe("");
  });

  it("renders when terminal is wide enough", () => {
    // columns=200 fits any reasonable QR at this URL length
    let out = "";
    withColumns(200, () => {
      out = captureStdout(() => printQr(url));
    });
    expect(out).toContain("Scan to connect:");
    // Half-block characters confirm the matrix was rendered
    expect(out).toMatch(/[▀▄█ ]/);
  });

  it("skips at exactly matrix-width + 1 columns (one short)", async () => {
    // Compute the actual matrix width so the guard boundary is tested precisely.
    // This directly validates the w + 2 formula (not a hardcoded constant).
    const { default: encodeQR } = await import("qr");
    const matrix = encodeQR(url, "raw");
    const w = matrix[0]?.length ?? 0;
    expect(w).toBeGreaterThan(0);

    let out = "";
    withColumns(w + 1, () => {
      out = captureStdout(() => printQr(url));
    });
    expect(out).toBe(""); // one column short of required w + 2
  });

  it("renders at exactly matrix-width + 2 columns (minimum required)", async () => {
    const { default: encodeQR } = await import("qr");
    const matrix = encodeQR(url, "raw");
    const w = matrix[0]?.length ?? 0;

    let out = "";
    withColumns(w + 2, () => {
      out = captureStdout(() => printQr(url));
    });
    expect(out).toContain("Scan to connect:");
  });
});
