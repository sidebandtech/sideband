// SPDX-License-Identifier: Apache-2.0

/**
 * Simple echo server for Node.js/Bun.
 *
 * Listens for WebSocket connections on localhost and echoes back any
 * messages received. Demonstrates server setup with origin validation.
 *
 * Run: bun run examples/node-echo-server.ts
 */

import { wsEndpoint, wsTransport } from "../src/index.js";

async function main() {
  const transport = wsTransport();
  const port = parseInt(process.env.PORT ?? "9000");

  const listener = await transport.listen!(
    wsEndpoint(`ws://localhost:${port}`),
    async (conn) => {
      console.log(`[${conn.id}] Client connected`);

      // Echo all messages back
      for await (const data of conn.inbound) {
        console.log(`[${conn.id}] Received ${data.byteLength} bytes`);
        await conn.send(data);
      }

      const closeInfo = await conn.closed;
      console.log(
        `[${conn.id}] Disconnected:`,
        closeInfo.graceful ? "clean" : `error (${closeInfo.closeCode})`,
      );
    },
    {
      // Only accept connections from localhost browsers (DNS rebinding protection)
      originPolicy: "localhost",
      limits: {
        maxMessageSize: 64 * 1024, // 64 KiB for this example
      },
    },
  );

  console.log(`Echo server listening on ${listener.address}`);
  console.log("Press Ctrl+C to stop");

  // Handle shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await listener.close();
    process.exit(0);
  });
}

main().catch(console.error);
