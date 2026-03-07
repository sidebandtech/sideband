// SPDX-License-Identifier: Apache-2.0

import type { CloudServer, ConnectedPeer } from "@sideband/cloud";
import { listen } from "@sideband/cloud";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { loadIdentityKeyPair } from "../config.js";
import type { MethodMeta } from "../handlers/rpc-meta.js";
import { registerRpcMeta } from "../handlers/rpc-meta.js";
import { registerStatsHandlers, statsMeta } from "../handlers/stats.js";
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
  /** Human-readable daemon name shown in the connect page. Defaults to os.hostname(). */
  name: string;
}

const echoMeta: Record<string, MethodMeta> = {
  "$sideband/echo": {
    description: "Echo params back to the caller",
    input: "any",
    inputExample: "hello",
  },
};

const infoMeta: Record<string, MethodMeta> = {
  "$sideband/info": {
    description: "Daemon identity and capabilities",
    input: "none",
  },
};

export async function runStart(args: StartArgs): Promise<void> {
  const { apiKey, configDir, json, name } = args;
  const cliVersion = getCliVersion();
  const identityKeyPair = await loadIdentityKeyPair(configDir);

  const server = await listen({
    apiKey,
    identityKeyPair,
    onConnection(peer: ConnectedPeer) {
      const peerId = peer.peerId;

      if (json) out.emitConnected(peerId);
      else out.printConnected(peerId);

      // ── Built-in capabilities ──────────────────────────────────────────────
      const capabilities = {
        ...registerStatsHandlers(peer),
      };

      peer.rpc.handle("$sideband/echo", (data: unknown) => {
        if (json) out.emitEcho(peerId, data);
        else out.printEcho(data);
        return data;
      });

      peer.rpc.handle("$sideband/info", () => {
        if (json) out.emitRpc(peerId, "$sideband/info");
        else out.printRpc("$sideband/info");
        return {
          daemonId: server.daemonId,
          name,
          version: cliVersion,
          capabilities,
        };
      });

      // rpc.list and rpc.describe — registered last so they reflect all methods
      registerRpcMeta(peer, { ...statsMeta, ...echoMeta, ...infoMeta });

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

    const readyPayload = {
      daemonId: server.daemonId,
      cliVersion,
      configDir,
      relayUrl: server.relayUrl,
      quickConnectCode: qc.code,
      quickConnectUrl: qc.url,
    };
    if (json) out.emitReady(readyPayload);
    else out.printReady(readyPayload);

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
  server: CloudServer,
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
  server: CloudServer,
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

/** Resolve the daemon name: blank/whitespace falls back to os.hostname(). */
export function resolveDaemonName(name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed || hostname();
}
