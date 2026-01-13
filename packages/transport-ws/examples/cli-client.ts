// SPDX-License-Identifier: Apache-2.0

/**
 * CLI client connecting to a local daemon.
 *
 * This example shows how a CLI tool connects to a local WebSocket server
 * without authentication (localhost connections are trusted).
 *
 * Run: bun run examples/cli-client.ts
 */

import { TransportError } from "@sideband/transport";
import { wsEndpoint, wsTransport } from "../src/index.js";

async function main() {
  const transport = wsTransport();
  const daemonUrl = process.env.DAEMON_URL ?? "ws://localhost:9000";

  console.log(`Connecting to daemon at ${daemonUrl}...`);

  try {
    const conn = await transport.connect(wsEndpoint(daemonUrl), {
      timeoutMs: 5_000,
    });

    console.log("Connected to daemon");

    // Send a command
    const command = {
      type: "status",
      id: crypto.randomUUID(),
    };
    await conn.send(new TextEncoder().encode(JSON.stringify(command)));
    console.log("Sent:", command.type);

    // Wait for response (with timeout)
    const timeout = setTimeout(() => {
      console.error("Response timeout");
      conn.close({ closeCode: 1000, reason: "timeout" });
    }, 5_000);

    for await (const data of conn.inbound) {
      clearTimeout(timeout);
      const response = JSON.parse(new TextDecoder().decode(data));
      console.log("Response:", JSON.stringify(response, null, 2));
      await conn.close();
      break;
    }
  } catch (err) {
    if (err instanceof TransportError) {
      switch (err.kind) {
        case "connection_refused":
          console.error("Daemon not running. Start it with: bun run daemon");
          process.exit(1);
        case "timeout":
          console.error("Connection timed out.");
          process.exit(1);
        default:
          console.error(`Error: ${err.kind} - ${err.message}`);
          process.exit(1);
      }
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
