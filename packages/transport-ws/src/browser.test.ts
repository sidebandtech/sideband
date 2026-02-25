// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { wsTransport } from "./browser.js";

// Guard: browser.ts is the browser-condition entrypoint for @sideband/transport-ws.
// This test ensures wsTransport is exported from it so browser bundlers (e.g. those
// resolving @sideband/peer) can import the unified factory without a missing-export error.
describe("browser entrypoint", () => {
  test("exports wsTransport as a callable factory returning a transport", () => {
    expect(typeof wsTransport).toBe("function");
    const transport = wsTransport();
    expect(typeof transport.connect).toBe("function");
  });
});
