// SPDX-License-Identifier: Apache-2.0
// cspell:ignore sbnd

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { connect } from "./connect.js";
import { listen } from "./listen.js";
import { generateIdentityKeyPair } from "@sideband/secure-relay";
import { createMemoryIdentityKeyStore } from "@sideband/peer/sbrp";
import {
  FrameType,
  encodeFrame,
  decodeFrame,
  encodeControl,
} from "@sideband/secure-relay";

/** Build a minimal unsigned JWT with the given payload claims. */
function makeToken(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  return `${enc({ alg: "EdDSA" })}.${enc(payload)}.signature`;
}

/** Wrap a tRPC mutation result in the plain tRPC envelope. */
function trpcOk<T>(data: T): Response {
  return Response.json({ result: { data } });
}

/** Poll `cond` every 50 ms until it returns true or `timeoutMs` elapses. */
async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() >= deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

type WsData = { payload: { role: string; did: string } };
type MockInit = { body: string; headers: Record<string, string> };

describe("Cloud SDK Integration", () => {
  let relayServer: Server<WsData>;
  let relayUrl: string;
  const daemons = new Map<string, ServerWebSocket<WsData>>();
  const clients = new Map<bigint, ServerWebSocket<WsData>>();

  const origFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    // 1. Mock the Cloud API
    fetchMock = mock(async (url: string, init: MockInit) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body).json;

      if (path.endsWith("daemon.renewToken")) {
        // Authorization: Bearer <apiKey>
        const apiKey = init.headers.Authorization.split(" ")[1];
        const did = apiKey.replace("sbnd_dak_", "d_");
        return trpcOk({ presenceToken: makeToken({ did, role: "daemon" }) });
      }

      if (path.endsWith("relay.createSession")) {
        // Authorization: Bearer <accessToken>
        const sid = 12345n;
        // BigUint64 is 8 bytes. Big-endian (network order).
        const buf = new Uint8Array(8);
        new DataView(buf.buffer).setBigUint64(0, sid, false);
        const sidB64 = btoa(String.fromCharCode(...buf))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=/g, "");

        return trpcOk({
          relayUrl,
          token: makeToken({ did: body.daemonId, sid: sidB64, role: "client" }),
        });
      }

      return new Response(null, { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // 2. Start Mock Relay Server
    relayServer = Bun.serve<WsData>({
      port: 0,
      fetch(req, server) {
        const url = new URL(req.url);
        const token = url.searchParams.get("token");
        if (!token) return new Response("Missing token", { status: 401 });

        const payload = JSON.parse(atob(token.split(".")[1]));
        if (server.upgrade(req, { data: { payload } })) return;
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          if (ws.data.payload.role === "daemon") {
            daemons.set(ws.data.payload.did, ws);
          }
        },
        message(ws, message) {
          const bytes = message as Uint8Array;
          let frame;
          try {
            frame = decodeFrame(bytes);
          } catch (e) {
            console.error("Relay: decodeFrame failed", e);
            return;
          }

          if (ws.data.payload.role === "daemon") {
            // Frame from daemon to client
            clients.get(frame.sessionId)?.send(bytes);
          } else {
            // Frame from client to daemon
            const daemonWs = daemons.get(ws.data.payload.did);
            if (daemonWs) {
              // Register client mapping on first frame (HandshakeInit)
              clients.set(frame.sessionId, ws);
              daemonWs.send(bytes);
            } else {
              // Daemon offline — send control error to client
              ws.send(
                encodeFrame(
                  FrameType.Control,
                  0n,
                  encodeControl(0n, 0x0202, "daemon_offline"),
                ),
              );
            }
          }
        },
        close(ws) {
          if (ws.data.payload.role === "daemon") {
            daemons.delete(ws.data.payload.did);
          }
        },
      },
    });

    relayUrl = `ws://localhost:${relayServer.port}`;
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    relayServer?.stop();
    daemons.clear();
    clients.clear();
  });

  it("performs a full connect/listen roundtrip through the relay", async () => {
    const daemonKeyPair = generateIdentityKeyPair();
    const daemonId = "d_test";
    const apiKey = "sbnd_dak_test";

    // 1. Start daemon (listen)
    let daemonReceivedPing = false;
    const server = await listen({
      apiKey,
      daemonId,
      identityKeyPair: daemonKeyPair,
      relayUrl,
      onConnection(peer) {
        peer.rpc.handle("ping", () => {
          daemonReceivedPing = true;
          return "pong";
        });
      },
    });

    expect(daemons.has(daemonId)).toBe(true);

    // 2. Connect client
    const clientStore = createMemoryIdentityKeyStore();
    const client = connect({
      daemonId,
      getAccessToken: () => "user_token",
      identityKeyStore: clientStore,
      apiUrl: "http://api.sideband.cloud",
      // relayUrl is already baked into the mock fetch response for relay.createSession
    });

    // 3. Perform RPC call
    await client.whenReady();
    const result = await client.rpc.call("ping");
    expect(result).toBe("pong");
    expect(daemonReceivedPing).toBe(true);

    // 4. Cleanup
    await client.disconnect();
    await server.close();
  });

  it("handles events across the relay", async () => {
    const daemonKeyPair = generateIdentityKeyPair();
    const daemonId = "d_events";
    const apiKey = "sbnd_dak_events";

    let receivedEvent: unknown = null;

    const server = await listen({
      apiKey,
      daemonId,
      identityKeyPair: daemonKeyPair,
      relayUrl,
      onConnection(peer) {
        peer.events.on("hello", (data) => {
          receivedEvent = data as Record<string, unknown>;
        });
      },
    });

    const clientStore = createMemoryIdentityKeyStore();
    const client = connect({
      daemonId,
      getAccessToken: () => "user_token",
      identityKeyStore: clientStore,
      apiUrl: "http://api.sideband.cloud",
    });

    await client.whenReady();
    client.events.emit("hello", { foo: "bar" });
    await waitFor(() => receivedEvent !== null);

    expect(receivedEvent).toEqual({ foo: "bar" });

    await client.disconnect();
    await server.close();
  });

  it("reconnects when the relay connection is dropped", async () => {
    const daemonKeyPair = generateIdentityKeyPair();
    const daemonId = "d_reconnect";
    const apiKey = "sbnd_dak_reconnect";

    const server = await listen({
      apiKey,
      daemonId,
      identityKeyPair: daemonKeyPair,
      relayUrl,
      onConnection() {},
    });

    expect(daemons.has(daemonId)).toBe(true);

    // Force close the relay connection from the server side to trigger reconnect
    daemons.get(daemonId)!.close();

    // Wait for daemon to re-register with the relay
    await waitFor(() => daemons.has(daemonId));

    // Reconnect must have renewed the token at least once more
    const renewCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("daemon.renewToken"),
    );
    expect(renewCalls.length).toBeGreaterThan(1);

    await server.close();
  });
});
