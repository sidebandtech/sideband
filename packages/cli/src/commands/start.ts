// SPDX-License-Identifier: Apache-2.0

import type { AcceptedPeer, CloudPeerServer } from "@sideband/cloud";
import { listen } from "@sideband/cloud";
import { readFileSync } from "node:fs";
import { loadIdentityKeyPair } from "../config.js";
import type { QuickConnectInfo } from "../output.js";
import * as out from "../output.js";

export function getCliVersion(): string {
  try {
    return (
      JSON.parse(
        readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
      ) as { version: string }
    ).version;
  } catch {
    return "0.0.0";
  }
}

export interface StartArgs {
  apiKey: string;
  configDir: string;
  json: boolean;
}

export async function runStart(args: StartArgs): Promise<void> {
  const { apiKey, configDir, json } = args;
  const cliVersion = getCliVersion();
  const identityKeyPair = await loadIdentityKeyPair(configDir);

  // server is assigned before onConnection is ever called (listen() resolves first)
  let server!: CloudPeerServer;

  server = await listen({
    apiKey,
    identityKeyPair,
    onConnection(peer: AcceptedPeer) {
      const peerId = peer.peerId;

      if (json) out.emitConnected(peerId);
      else out.printConnected(peerId);

      peer.rpc.handle("$sideband/echo", (data: unknown) => {
        if (json) out.emitRpc(peerId, "$sideband/echo");
        else out.printRpc("$sideband/echo");
        return data;
      });

      peer.rpc.handle("$sideband/info", () => {
        if (json) out.emitRpc(peerId, "$sideband/info");
        else out.printRpc("$sideband/info");
        return {
          daemonId: server.daemonId,
          version: cliVersion,
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          uptime: process.uptime(),
        };
      });

      peer.on("disconnected", () => {
        if (json) out.emitDisconnected(peerId);
        else out.printDisconnected(peerId);
      });
    },
    onUnhandledError(err) {
      if (json) out.emitError(err.message);
      else out.printError(err.message);
    },
  });

  // Startup sequence after listen(): close server on any failure to avoid a
  // half-open relay connection when process.exit is called by the global catch.
  try {
    const qc = await server.createQuickConnect({ ttlSeconds: 300 });

    if (json) {
      out.emitReady({
        daemonId: server.daemonId,
        cliVersion,
        configDir,
        relayUrl: server.relayUrl,
        quickConnectCode: qc.code,
        quickConnectUrl: qc.url,
      });
    } else {
      out.printReady({
        daemonId: server.daemonId,
        cliVersion,
        configDir,
        relayUrl: server.relayUrl,
        quickConnectCode: qc.code,
        quickConnectUrl: qc.url,
      });
    }

    scheduleQcRenewal(server, parseExpiryMs(qc.expiresAt), json);
  } catch (err) {
    await server.close().catch(() => {});
    throw err;
  }

  const shutdown = async () => {
    if (!json) out.printShutdown();
    await server.close();
    process.exit(0);
  };
  const handleSignal = () => {
    shutdown().catch((err) => {
      out.printError(
        `Shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    });
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
}

/** Throws on malformed ISO 8601 timestamps to prevent NaN → immediate setTimeout loop. */
export function parseExpiryMs(expiresAt: string): number {
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid Quick Connect expiry timestamp: ${expiresAt}`);
  }
  return ms;
}

export function scheduleQcRenewal(
  server: CloudPeerServer,
  expiryMs: number,
  json: boolean,
): void {
  // Renew 30s before expiry; clamp to at least 1s to guard against clock skew.
  const delayMs = Math.max(1000, expiryMs - Date.now() - 30_000);
  const timer = setTimeout(
    () => void renewQc(server, expiryMs, json, 0, false),
    delayMs,
  );
  // Unref so the renewal timer doesn't keep the process alive alone.
  timer.unref?.();
}

export async function renewQc(
  server: CloudPeerServer,
  prevExpiryMs: number,
  json: boolean,
  attempt: number,
  expiredAnnounced: boolean,
): Promise<void> {
  try {
    const qc = await server.createQuickConnect({ ttlSeconds: 300 });
    const expiryMs = parseExpiryMs(qc.expiresAt);
    const info: QuickConnectInfo = {
      code: qc.code,
      url: qc.url,
      expiresAt: qc.expiresAt,
    };
    if (json) out.emitQcRenewed(info);
    else out.printQcRenewed(info);
    // Successful renewal: reset attempt counter and expiredAnnounced state.
    scheduleQcRenewal(server, expiryMs, json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const nowExpired = Date.now() >= prevExpiryMs;

    if (nowExpired && !expiredAnnounced) {
      // Announce expiry exactly once; subsequent retries are silent.
      if (json) out.emitError("Quick Connect code expired. Retrying...");
      else out.printQcExpired();
    } else if (!nowExpired) {
      if (json) out.emitError(`Quick Connect renewal failed: ${msg}`);
      else out.printError(`Quick Connect renewal failed: ${msg}`);
    }

    // Exponential backoff: 1s, 2s, 4s … capped at 30s
    const backoffMs = Math.min(1000 * 2 ** attempt, 30_000);
    const timer = setTimeout(
      // Cap attempt at 5: backoff maxes out at 2^5s = 32s > 30s cap anyway.
      () =>
        void renewQc(
          server,
          prevExpiryMs,
          json,
          Math.min(attempt + 1, 5),
          expiredAnnounced || nowExpired,
        ),
      backoffMs,
    );
    timer.unref?.();
  }
}
