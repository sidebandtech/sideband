// SPDX-License-Identifier: Apache-2.0

/**
 * Browser client connecting to a cloud relay.
 *
 * This example shows how a browser application connects to a WebSocket relay
 * server with token authentication via query parameter.
 *
 * Run: Include in a browser bundle (Vite, esbuild, etc.)
 */

import { TransportError } from "@sideband/transport";
import { wsEndpoint, wsTransport } from "../src/index.js";

async function main() {
  const transport = wsTransport();

  // Get token from your auth system
  const sessionToken = getSessionToken();

  try {
    // Connect to relay with query-based auth (required for browsers)
    const conn = await transport.connect(
      wsEndpoint("wss://relay.example.com/ws"),
      {
        auth: {
          token: sessionToken,
          mode: "query", // Required in browser (headers not supported)
        },
        timeoutMs: 10_000,
      },
    );

    console.log("Connected:", conn.id);
    console.log("Subprotocol:", conn.subprotocol ?? "(none)");

    // Send a message
    const message = new TextEncoder().encode(JSON.stringify({ type: "ping" }));
    await conn.send(message);

    // Receive messages
    for await (const data of conn.inbound) {
      const text = new TextDecoder().decode(data);
      console.log("Received:", text);

      // Example: close after receiving a response
      const parsed = JSON.parse(text);
      if (parsed.type === "pong") {
        await conn.close();
        break;
      }
    }

    // Check close reason
    const closeInfo = await conn.closed;
    console.log("Closed:", closeInfo.graceful ? "gracefully" : "with error");
  } catch (err) {
    if (err instanceof TransportError) {
      switch (err.kind) {
        case "connection_refused":
          console.error("Server not available. Try again later.");
          break;
        case "timeout":
          console.error("Connection timed out. Check your network.");
          break;
        case "aborted":
          console.log("Connection cancelled.");
          break;
        default:
          console.error("Transport error:", err.kind, err.message);
      }
    } else {
      throw err;
    }
  }
}

function getSessionToken(): string {
  // Replace with your auth logic
  return localStorage.getItem("session_token") ?? "";
}

main().catch(console.error);
