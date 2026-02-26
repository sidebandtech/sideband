// SPDX-License-Identifier: Apache-2.0

import * as ws from "@sideband/transport-ws";
import { describe, expect, test } from "bun:test";

describe("@sideband/transport-ws exports", () => {
  test("exports wsTransport factory", () => {
    expect(ws.wsTransport).toBeDefined();
    expect(typeof ws.wsTransport).toBe("function");
  });

  test("exports platform-specific factories", () => {
    expect(ws.nodeWsTransport).toBeDefined();
    expect(typeof ws.nodeWsTransport).toBe("function");
    expect(ws.browserWsTransport).toBeDefined();
    expect(typeof ws.browserWsTransport).toBe("function");
  });

  test("exports wsEndpoint utilities", () => {
    expect(ws.wsEndpoint).toBeDefined();
    expect(typeof ws.wsEndpoint).toBe("function");
    expect(ws.wsEndpointFromHttp).toBeDefined();
    expect(typeof ws.wsEndpointFromHttp).toBe("function");
  });

  test("wsTransport() returns a transport", () => {
    const transport = ws.wsTransport();
    expect(transport).toBeDefined();
    expect(transport.kind).toBe("bun:ws"); // Since we're running in Bun
    expect(typeof transport.connect).toBe("function");
  });

  test("wsTransport({ platform: 'browser' }) returns browser transport", () => {
    const transport = ws.wsTransport({ platform: "browser" });
    expect(transport).toBeDefined();
    expect(transport.kind).toBe("browser:ws");
  });

  test("wsTransport({ platform: 'node' }) returns node transport", () => {
    const transport = ws.wsTransport({ platform: "node" });
    expect(transport).toBeDefined();
    // In Bun, nodeWsTransport() returns kind "bun:ws"
    expect(transport.kind).toBe("bun:ws");
  });
});

describe("@sideband/transport-ws/node exports", () => {
  test("exports nodeWsTransport", async () => {
    const node = await import("@sideband/transport-ws/node");
    expect(node.nodeWsTransport).toBeDefined();
    expect(typeof node.nodeWsTransport).toBe("function");
  });
});

describe("@sideband/transport-ws/browser exports", () => {
  test("exports browserWsTransport and wsTransport", async () => {
    const browser = await import("@sideband/transport-ws/browser");
    expect(browser.browserWsTransport).toBeDefined();
    expect(browser.wsTransport).toBeDefined();
    expect(typeof browser.browserWsTransport).toBe("function");
    expect(typeof browser.wsTransport).toBe("function");
  });
});
