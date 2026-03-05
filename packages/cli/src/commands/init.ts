// SPDX-License-Identifier: Apache-2.0

import { extractDaemonIdFromToken, renewPresenceToken } from "@sideband/cloud";
import { loadConfig, loadIdentityKeyPair, saveConfig } from "../config.js";
import { printFatal } from "../output.js";

export interface InitArgs {
  apiKey: string;
  configDir: string;
}

export async function runInit(args: InitArgs): Promise<void> {
  const { apiKey, configDir } = args;

  let token: string;
  try {
    token = await renewPresenceToken(apiKey);
  } catch (err) {
    printFatal(
      `API key validation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const newDaemonId = extractDaemonIdFromToken(token);

  try {
    const existing = await loadConfig(configDir);
    if (existing?.apiKey) {
      try {
        const existingToken = await renewPresenceToken(existing.apiKey);
        const existingId = extractDaemonIdFromToken(existingToken);
        process.stdout.write(`  Existing daemon: ${existingId}\n`);
      } catch {
        // Existing key may be revoked — show nothing
      }
    }
  } catch (err) {
    if (err instanceof Error && "code" in err) throw err; // IO error (EACCES, etc.) — surface it
    // Config content is malformed — proceed to overwrite with new config
  }

  process.stdout.write(`  New daemon:      ${newDaemonId}\n`);

  await saveConfig(configDir, { apiKey });
  await loadIdentityKeyPair(configDir);

  process.stdout.write("\n  Config saved. Run `sideband` to start.\n\n");
}
