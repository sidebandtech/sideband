// SPDX-License-Identifier: Apache-2.0

/**
 * Config and identity persistence for the Sideband CLI.
 *
 * Config directory: $SIDEBAND_HOME or ~/.sideband/
 *   config.json   — { apiKey: string }
 *   identity.json — { type: "ed25519", publicKey: "<hex>", privateKey: "<hex>" }
 *
 * All file writes are atomic (write to .tmp, rename) with 0o600 permissions
 * so secrets are never world-readable, even on a partial write.
 */

import type { IdentityKeyPair } from "@sideband/secure-relay";
import { generateIdentityKeyPair } from "@sideband/secure-relay";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface Config {
  apiKey?: string;
}

/** Resolved config directory (SIDEBAND_HOME or ~/.sideband). */
export function getConfigDir(): string {
  return process.env["SIDEBAND_HOME"] ?? path.join(os.homedir(), ".sideband");
}

/**
 * Resolve API key with priority: flag > SIDEBAND_API_KEY env > config file.
 * Returns undefined if none found.
 */
export async function resolveApiKey(
  fromFlag: string | undefined,
  configDir: string,
): Promise<string | undefined> {
  const flag = fromFlag?.trim();
  if (flag) return flag;
  const env = process.env["SIDEBAND_API_KEY"]?.trim();
  if (env) return env;
  const config = await loadConfig(configDir);
  return config?.apiKey?.trim() || undefined;
}

/** Read config.json. Returns null if the file does not exist. */
export async function loadConfig(configDir: string): Promise<Config | null> {
  const filePath = path.join(configDir, "config.json");
  try {
    const raw = await readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${filePath}: invalid JSON — delete the file to fix`);
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(`${filePath}: invalid format — delete the file to fix`);
    }
    const { apiKey } = parsed as Record<string, unknown>;
    if (apiKey !== undefined && typeof apiKey !== "string") {
      throw new Error(
        `${filePath}: apiKey must be a string — delete the file to fix`,
      );
    }
    return parsed as Config;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

/** Write config.json atomically with 0o600 permissions. */
export async function saveConfig(
  configDir: string,
  config: Config,
): Promise<void> {
  await mkdir(configDir, { recursive: true });
  const filePath = path.join(configDir, "config.json");
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(tmpPath, filePath);
  // Best-effort: some platforms ignore chmod (e.g. FAT volumes on macOS).
  await chmod(filePath, 0o600).catch(() => {});
}

/** Load identity.json; generate and save if missing. */
export async function loadIdentityKeyPair(
  configDir: string,
): Promise<IdentityKeyPair> {
  const filePath = path.join(configDir, "identity.json");
  try {
    const raw = await readFile(filePath, "utf8");
    let parsed: { type?: unknown; publicKey?: unknown; privateKey?: unknown };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      throw new Error(
        `${filePath}: invalid JSON — delete the file to regenerate`,
      );
    }
    const { type, publicKey, privateKey } = parsed;
    if (type !== "ed25519") {
      throw new Error(
        `${filePath}: unsupported key type "${String(type)}" (expected "ed25519") — delete the file to regenerate`,
      );
    }
    if (typeof publicKey !== "string" || typeof privateKey !== "string") {
      throw new Error(
        `${filePath}: invalid format (expected hex publicKey and privateKey strings) — delete the file to regenerate`,
      );
    }
    return {
      publicKey: hexToBytes(publicKey, filePath),
      privateKey: hexToBytes(privateKey, filePath),
    };
  } catch (err) {
    if (!isNodeError(err) || err.code !== "ENOENT") throw err;
  }
  const keyPair = await generateIdentityKeyPair();
  await mkdir(configDir, { recursive: true });
  const tmpPath = filePath + ".tmp";
  await writeFile(
    tmpPath,
    JSON.stringify(
      {
        type: "ed25519",
        publicKey: bytesToHex(keyPair.publicKey),
        privateKey: bytesToHex(keyPair.privateKey),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await rename(tmpPath, filePath);
  await chmod(filePath, 0o600).catch(() => {});
  return keyPair;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string, source = "hex string"): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error(
      `${source}: invalid hex encoding — delete the file to regenerate`,
    );
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
