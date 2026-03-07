#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * Sideband CLI entry point.
 *
 * Usage:
 *   sideband [--api-key <key>] [--name <value>] [--json]   Start daemon
 *   sideband init --api-key <key>                          Save API key to config
 *
 * API key resolution (highest wins):
 *   1. --api-key flag
 *   2. SIDEBAND_API_KEY env var
 *   3. ~/.sideband/config.json
 *
 * Unknown flags exit with code 2; --help/--version exit with code 0.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInit } from "./commands/init.js";
import {
  getCliVersion,
  resolveDaemonName,
  runStart,
} from "./commands/start.js";
import { getConfigDir, resolveApiKey } from "./config.js";
import { printFatal } from "./output.js";

const USAGE = `
  Usage:
    sideband [--api-key <key>] [--name <value>] [--dir <path>] [--json]
    sideband init --api-key <key>

  Options:
    --api-key <key>   Override API key from env/config
    --name <value>    Daemon name (default: hostname)
    --dir <path>      Enable file browser, scoped to this directory
    --allow-dotfiles  Include dotfiles in listing and allow reading them (requires --dir)
    --json            NDJSON output (for scripting/CI)
    --version, -V     Print version and exit
    --help            Show this help

  Environment:
    SIDEBAND_API_KEY  API key
    SIDEBAND_HOME     Config directory (default: ~/.sideband)
`;

/** Thrown by parsers to signal usage errors (exit code 2). Caught by main().catch(). */
class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export type ParsedArgs =
  | {
      command: "start";
      apiKey: string | undefined;
      name: string | undefined;
      json: boolean;
      dir: string | undefined;
      allowDotfiles: boolean;
    }
  | { command: "init"; apiKey: string | undefined }
  | { command: "version" }
  | { command: "help" };

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // drop node + script

  // Global flags that short-circuit subcommand dispatch, regardless of position.
  if (args.includes("--version") || args.includes("-V"))
    return { command: "version" };
  if (args.includes("--help") || args.includes("-h"))
    return { command: "help" };

  // Subcommand must be the first argument; flags before subcommand are not allowed.
  if (args[0] === "init") {
    return { command: "init", apiKey: parseInitFlags(args, 1) };
  }
  return { command: "start", ...parseStartFlags(args, USAGE) };
}

/**
 * Consume a named flag `--<name> <value>` or `--<name>=<value>` at index i.
 * Returns the value and the index of the next unconsumed argument, or undefined if no match.
 */
function consumeFlag(
  flag: string,
  args: string[],
  i: number,
): { value: string; next: number } | undefined {
  const arg = args[i]!;
  const prefix = `--${flag}=`;
  if (arg.startsWith(prefix))
    return { value: arg.slice(prefix.length), next: i + 1 };
  if (arg === `--${flag}`) {
    const next = args[i + 1];
    if (next === undefined || next.startsWith("-"))
      throw new CliUsageError(`--${flag} requires a value`);
    return { value: next, next: i + 2 };
  }
  return undefined;
}

function parseStartFlags(
  args: string[],
  usage: string,
): {
  apiKey: string | undefined;
  name: string | undefined;
  json: boolean;
  dir: string | undefined;
  allowDotfiles: boolean;
} {
  let apiKey: string | undefined;
  let name: string | undefined;
  let json = false;
  let dir: string | undefined;
  let allowDotfiles = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--allow-dotfiles") {
      allowDotfiles = true;
      continue;
    }
    const apiKv = consumeFlag("api-key", args, i);
    if (apiKv !== undefined) {
      apiKey = apiKv.value;
      i = apiKv.next - 1;
      continue;
    }
    const nameKv = consumeFlag("name", args, i);
    if (nameKv !== undefined) {
      name = nameKv.value;
      i = nameKv.next - 1;
      continue;
    }
    const dirKv = consumeFlag("dir", args, i);
    if (dirKv !== undefined) {
      if (!dirKv.value) throw new CliUsageError("--dir requires a value");
      dir = dirKv.value;
      i = dirKv.next - 1;
      continue;
    }
    if (arg === "init") {
      throw new CliUsageError(
        `subcommand "init" must be the first argument.\n  Try: sideband init --api-key <key>`,
      );
    }
    throw new CliUsageError(`Unknown argument: ${arg}\n${usage}`);
  }
  if (allowDotfiles && !dir) {
    throw new CliUsageError("--allow-dotfiles requires --dir");
  }
  return { apiKey, name, json, dir, allowDotfiles };
}

function parseInitFlags(args: string[], start: number): string | undefined {
  let apiKey: string | undefined;
  for (let i = start; i < args.length; i++) {
    const arg = args[i]!;
    const kv = consumeFlag("api-key", args, i);
    if (kv !== undefined) {
      apiKey = kv.value;
      i = kv.next - 1;
      continue;
    }
    throw new CliUsageError(`Unknown argument: ${arg}\n${USAGE}`);
  }
  return apiKey;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  const configDir = getConfigDir();

  if (parsed.command === "version") {
    process.stdout.write(getCliVersion() + "\n");
    return;
  }
  if (parsed.command === "help") {
    process.stdout.write(USAGE + "\n");
    return;
  }

  if (parsed.command === "init") {
    if (!parsed.apiKey) {
      printFatal(
        "sideband init requires --api-key.\n\n  Example: sideband init --api-key sbnd_dak_...",
      );
      process.exit(1);
    }
    await runInit({ apiKey: parsed.apiKey, configDir });
    return;
  }

  // Start command: resolve API key (flag > SIDEBAND_API_KEY env > config file)
  const apiKey = await resolveApiKey(parsed.apiKey, configDir);

  if (!apiKey) {
    printFatal(
      "No API key found. Get one from https://sideband.cloud, then run:\n\n    sideband init --api-key sbnd_dak_...",
    );
    process.exit(1);
  }

  await runStart({
    apiKey,
    configDir,
    json: parsed.json,
    name: resolveDaemonName(parsed.name),
    dir: parsed.dir,
    allowDotfiles: parsed.allowDotfiles,
  });
}

// Only execute when run directly, not when imported by tests.
// realpathSync resolves npm bin symlinks so the guard works with `npx sideband`.
// try/catch: argv[1] may not exist on disk (e.g. during tests or embedded runtimes).
let isDirectRun = false;
try {
  isDirectRun =
    realpathSync(process.argv[1]!) ===
    realpathSync(fileURLToPath(import.meta.url));
} catch {
  // expected when argv[1] doesn't resolve to a real path
}
if (isDirectRun) {
  main().catch((err) => {
    if (err instanceof CliUsageError) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(2);
    }
    printFatal(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
