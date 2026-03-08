// SPDX-License-Identifier: Apache-2.0

/**
 * Output formatting for the Sideband CLI.
 *
 * Human mode (default): indented, readable text to stdout; errors to stderr.
 * JSON mode (--json): NDJSON to stdout (one JSON object per line); errors go
 * to stdout as `{ event: "error" }` AND to stderr as a human-readable mirror
 * — stdout is the authoritative stream for automation; stderr is best-effort.
 *
 * Activity lines use a consistent format: `  {sigil} {message} [{HH:MM:SS}]`
 * Sigils: + connected, - disconnected, → RPC call, ← echo reply, ⚠ warning.
 */

import encodeQR from "qr";

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
  /** Active capability names, e.g. ["stats", "fs (my-app)"]. */
  capabilities: string[];
}

export interface QuickConnectInfo {
  code: string;
  url: string;
  expiresAt: string;
}

// ─── Human mode ─────────────────────────────────────────────────────────────

export function printReady(info: ReadyInfo): void {
  const lines = [
    "",
    "  Sideband daemon running",
    `  Daemon ID: ${info.daemonId}`,
    `  Relay:     ${info.relayUrl}`,
  ];
  if (info.capabilities.length > 0) {
    lines.push(`  Capabilities: ${info.capabilities.join(", ")}`);
  }
  lines.push(
    "",
    `  Quick Connect: ${info.quickConnectUrl}`,
    `  Code:          ${info.quickConnectCode}`,
  );
  process.stdout.write(lines.join("\n") + "\n");
  printQr(info.quickConnectUrl);
  process.stdout.write("\n  Waiting for connections...\n\n");
}

/**
 * Print a QR code for the given URL to stdout.
 *
 * Skipped when the terminal is too narrow to fit the QR (matrix width + 2-char
 * left margin) or when `encodeQR` throws — startup must not fail due to QR rendering.
 *
 * Renders using Unicode half-block characters (▀▄█ ) to halve the height —
 * full-size QRs for URLs of this length are ~35 lines, too tall for most
 * terminal windows. Works on both light and dark terminal themes without ANSI
 * color codes (contrast comes from the block glyph shapes, not background color).
 */
export function printQr(url: string): void {
  try {
    const matrix = encodeQR(url, "raw");
    const w = matrix[0]?.length ?? 0;
    // Guard after computing w: actual rendered width is w + 2 (left margin).
    // A line-wrapped QR is unscannable, so skip rather than render partially.
    if ((process.stdout.columns ?? 0) < w + 2) return;
    const rows: string[] = ["\n  Scan to connect:"];
    for (let y = 0; y < matrix.length; y += 2) {
      let row = "  ";
      for (let x = 0; x < w; x++) {
        const top = matrix[y]?.[x] ?? false;
        const bot = matrix[y + 1]?.[x] ?? false;
        row += top && bot ? "█" : top ? "▀" : bot ? "▄" : " ";
      }
      rows.push(row);
    }
    process.stdout.write(rows.join("\n") + "\n");
  } catch {
    // Never let QR rendering abort startup
  }
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
    capabilities: info.capabilities,
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
