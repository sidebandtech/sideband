// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "bun:test";
import { MemoryTransport } from "../src/index.js";
import { asTransportEndpoint } from "../src/index.js";

describe("MemoryTransport", () => {
  it("should connect and exchange data", async () => {
    const transport = new MemoryTransport();
    const endpoint = asTransportEndpoint("memory://test");

    // Start listener
    const receivedMessages: Uint8Array[] = [];
    const listener = await transport.listen(endpoint, async (conn) => {
      for await (const data of conn.inbound) {
        receivedMessages.push(data);
      }
    });

    // Connect client
    const client = await transport.connect(endpoint);

    // Send message from client
    const message = new Uint8Array([1, 2, 3, 4, 5]);
    await client.send(message);

    // Wait for message to arrive
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]).toEqual(message);

    // Cleanup
    await client.close();
    await listener.close();
  });

  it("should reject connection to non-existent endpoint", async () => {
    const transport = new MemoryTransport();
    const endpoint = asTransportEndpoint("memory://nonexistent");

    expect(transport.connect(endpoint)).rejects.toThrow();
  });

  it("should reject duplicate listen on same endpoint", async () => {
    const transport = new MemoryTransport();
    const endpoint = asTransportEndpoint("memory://duplicate");

    const listener1 = await transport.listen(endpoint, async () => {});

    expect(transport.listen(endpoint, async () => {})).rejects.toThrow();

    await listener1.close();
  });
});
