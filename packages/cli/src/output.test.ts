// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import {
  emitConnected,
  emitDisconnected,
  emitQcRenewed,
  emitReady,
  emitRpc,
} from "./output.js";

/** Capture one stdout write, run fn, restore. */
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
      }),
    );
    // First line must be parseable JSON — critical for scripting consumers
    expect(() => JSON.parse(out.split("\n")[0]!)).not.toThrow();
  });
});
