// SPDX-License-Identifier: Apache-2.0

/**
 * Output formatting for the Sideband CLI.
 *
 * Human mode (default): indented, readable text to stdout; errors to stderr.
 * JSON mode (--json): NDJSON to stdout (one JSON object per line); errors to stderr.
 *
 * Activity lines use a consistent format: `  {sigil} {message} [{HH:MM:SS}]`
 * Sigils: + connected, - disconnected, → RPC call, ← echo reply, ⚠ warning.
 */

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8); // HH:MM:SS
}

/** Shorten peer ID to first 8 chars for readability. */
function shortId(peerId: string): string {
  return peerId.slice(0, 8);
}

export interface ReadyInfo {
  daemonId: string;
  cliVersion: string;
  configDir: string;
  relayUrl: string;
  quickConnectCode: string;
  quickConnectUrl: string;
}

export interface QuickConnectInfo {
  code: string;
  url: string;
  expiresAt: string;
}

// ─── Human mode ─────────────────────────────────────────────────────────────

export function printReady(info: ReadyInfo): void {
  process.stdout.write(
    [
      "",
      "  Sideband daemon running",
      `  Daemon ID: ${info.daemonId}`,
      `  Relay:     ${info.relayUrl}`,
      "",
      `  Quick Connect: ${info.quickConnectUrl}`,
      `  Code:          ${info.quickConnectCode}`,
      "",
      "  Waiting for connections...",
      "",
    ].join("\n"),
  );
}

export function printConnected(peerId: string): void {
  process.stdout.write(`  + Connected (${shortId(peerId)}) [${timestamp()}]\n`);
}

export function printDisconnected(peerId: string): void {
  process.stdout.write(
    `  - Disconnected (${shortId(peerId)}) [${timestamp()}]\n`,
  );
}

export function printRpc(method: string): void {
  process.stdout.write(`  → ${method} [${timestamp()}]\n`);
}

export function printEcho(data: unknown): void {
  let text: string;
  try {
    text = typeof data === "string" ? data : JSON.stringify(data);
  } catch {
    text = String(data);
  }
  process.stdout.write(`  ← echo: ${text} [${timestamp()}]\n`);
}

export function printQcRenewed(info: QuickConnectInfo): void {
  process.stdout.write(
    `  Quick Connect renewed [${timestamp()}]\n` +
      `  Code: ${info.code}\n` +
      `  URL:  ${info.url}\n`,
  );
}

export function printQcExpired(): void {
  process.stdout.write(
    `  ⚠ Quick Connect expired, retrying... [${timestamp()}]\n`,
  );
}

export function printError(message: string): void {
  process.stderr.write(`  Error: ${message}\n`);
}

export function printFatal(message: string): void {
  process.stderr.write(`  Error: ${message}\n`);
}

export function printShutdown(): void {
  process.stdout.write("  Shutting down...\n");
}

// ─── JSON (NDJSON) mode ──────────────────────────────────────────────────────

function emit(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

export function emitReady(info: ReadyInfo): void {
  emit({
    event: "ready",
    daemonId: info.daemonId,
    cliVersion: info.cliVersion,
    configDir: info.configDir,
    relayUrl: info.relayUrl,
    quickConnectCode: info.quickConnectCode,
    quickConnectUrl: info.quickConnectUrl,
  });
}

export function emitConnected(peerId: string): void {
  emit({ event: "connected", peerId });
}

export function emitDisconnected(peerId: string): void {
  emit({ event: "disconnected", peerId });
}

export function emitRpc(peerId: string, method: string): void {
  emit({ event: "rpc", peerId, method });
}

export function emitEcho(peerId: string, data: unknown): void {
  // Normalize to a JSON-safe value so the `data` field is always present.
  let safe: unknown;
  try {
    JSON.stringify(data);
    safe = data;
  } catch {
    safe = String(data);
  }
  if (safe === undefined) safe = null;
  emit({ event: "rpc", peerId, method: "$sideband/echo", data: safe });
}

export function emitQcRenewed(info: QuickConnectInfo): void {
  emit({
    event: "quick_connect",
    code: info.code,
    url: info.url,
    expiresAt: info.expiresAt,
  });
}

export function emitError(message: string): void {
  emit({ event: "error", message });
  process.stderr.write(`Error: ${message}\n`);
}
