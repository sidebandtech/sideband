// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "./bin.js";
import { resolveDaemonName } from "./commands/start.js";

const binPath = join(import.meta.dirname, "bin.ts");

describe("direct-run guard", () => {
  it("runs main() and prints version when invoked directly", () => {
    const result = Bun.spawnSync([
      process.execPath,
      "run",
      binPath,
      "--version",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("runs main() via symlink", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sideband-cli-test-"));
    const link = join(tmp, "sideband");
    try {
      symlinkSync(binPath, link);
      const result = Bun.spawnSync([
        process.execPath,
        "run",
        link,
        "--version",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toMatch(/^\d+\.\d+\.\d+$/);
    } finally {
      try {
        unlinkSync(link);
        rmdirSync(tmp);
      } catch {
        // best-effort cleanup
      }
    }
  });

  it("does not throw when imported (guard skipped)", () => {
    // If the guard threw on import, this entire test file would fail to load
    expect(parseArgs(["node", "bin", "--help"])).toEqual({ command: "help" });
  });
});

describe("parseArgs", () => {
  const node = "node";
  const bin = "sideband";
  const argv = (...args: string[]) => [node, bin, ...args];

  describe("start command (default)", () => {
    it("parses --api-key flag", () => {
      expect(parseArgs(argv("--api-key", "sbnd_dak_abc"))).toEqual({
        command: "start",
        apiKey: "sbnd_dak_abc",
        name: undefined,
        json: false,
      });
    });

    it("parses --api-key=<value> form", () => {
      expect(parseArgs(argv("--api-key=sbnd_dak_abc"))).toEqual({
        command: "start",
        apiKey: "sbnd_dak_abc",
        name: undefined,
        json: false,
      });
    });

    it("parses --json flag", () => {
      expect(parseArgs(argv("--json"))).toEqual({
        command: "start",
        apiKey: undefined,
        name: undefined,
        json: true,
      });
    });

    it("parses --json + --api-key together", () => {
      expect(parseArgs(argv("--json", "--api-key=key123"))).toEqual({
        command: "start",
        apiKey: "key123",
        name: undefined,
        json: true,
      });
    });

    it("returns undefined apiKey when flag absent", () => {
      expect(parseArgs(argv())).toEqual({
        command: "start",
        apiKey: undefined,
        name: undefined,
        json: false,
      });
    });

    it("throws on unknown flag", () => {
      expect(() => parseArgs(argv("--unknown"))).toThrow("Unknown argument");
    });

    it("throws with helpful message when init in wrong position", () => {
      expect(() => parseArgs(argv("--json", "init"))).toThrow(
        `subcommand "init" must be the first argument`,
      );
    });

    it("throws when --api-key has no value", () => {
      expect(() => parseArgs(argv("--api-key"))).toThrow(
        "--api-key requires a value",
      );
    });

    it("throws when --api-key is followed by another flag (not a value)", () => {
      expect(() => parseArgs(argv("--api-key", "--json"))).toThrow(
        "--api-key requires a value",
      );
    });

    it('parses --name "My Dev"', () => {
      expect(parseArgs(argv("--name", "My Dev"))).toMatchObject({
        command: "start",
        name: "My Dev",
      });
    });

    it("parses --name=MyDev", () => {
      expect(parseArgs(argv("--name=MyDev"))).toMatchObject({
        command: "start",
        name: "MyDev",
      });
    });

    it("throws when --name has no value", () => {
      expect(() => parseArgs(argv("--name"))).toThrow(
        "--name requires a value",
      );
    });

    it("throws when --name is followed by another flag (not a value)", () => {
      expect(() => parseArgs(argv("--name", "--json"))).toThrow(
        "--name requires a value",
      );
    });

    it('parseArgs preserves --name "" as empty string (fallback handled by resolveDaemonName)', () => {
      expect(parseArgs(argv("--name", ""))).toMatchObject({
        command: "start",
        name: "",
      });
    });

    it('parseArgs preserves --name "  " as whitespace string', () => {
      expect(parseArgs(argv("--name", "  "))).toMatchObject({
        command: "start",
        name: "  ",
      });
    });

    it("parses --name= (equals form with empty value) as empty string", () => {
      expect(parseArgs(argv("--name="))).toMatchObject({
        command: "start",
        name: "",
      });
    });
  });

  describe("resolveDaemonName", () => {
    it("returns provided name as-is", () => {
      expect(resolveDaemonName("My Dev")).toBe("My Dev");
    });

    it("falls back to hostname for blank string", () => {
      expect(resolveDaemonName("")).toBe(hostname());
    });

    it("falls back to hostname for whitespace-only string", () => {
      expect(resolveDaemonName("   ")).toBe(hostname());
    });

    it("falls back to hostname when undefined", () => {
      expect(resolveDaemonName(undefined)).toBe(hostname());
    });
  });

  describe("--help / -h flag", () => {
    it("returns help command for --help", () => {
      expect(parseArgs(argv("--help"))).toEqual({ command: "help" });
    });

    it("returns help command for -h", () => {
      expect(parseArgs(argv("-h"))).toEqual({ command: "help" });
    });

    it("--help takes precedence over other flags", () => {
      expect(parseArgs(argv("--json", "--help"))).toEqual({ command: "help" });
    });

    it("--help takes precedence over subcommand", () => {
      expect(parseArgs(argv("init", "--help"))).toEqual({ command: "help" });
    });
  });

  describe("--version / -V flag", () => {
    it("returns version command for --version", () => {
      expect(parseArgs(argv("--version"))).toEqual({ command: "version" });
    });

    it("returns version command for -V", () => {
      expect(parseArgs(argv("-V"))).toEqual({ command: "version" });
    });

    it("--version takes precedence over other flags", () => {
      expect(parseArgs(argv("--json", "--version"))).toEqual({
        command: "version",
      });
    });

    it("--version takes precedence over subcommand", () => {
      expect(parseArgs(argv("init", "--version"))).toEqual({
        command: "version",
      });
    });
  });

  describe("init subcommand", () => {
    it("parses init with --api-key", () => {
      expect(parseArgs(argv("init", "--api-key", "sbnd_dak_abc"))).toEqual({
        command: "init",
        apiKey: "sbnd_dak_abc",
      });
    });

    it("parses init with --api-key= form", () => {
      expect(parseArgs(argv("init", "--api-key=sbnd_dak_abc"))).toEqual({
        command: "init",
        apiKey: "sbnd_dak_abc",
      });
    });

    it("parses init without api key (key checked later in main)", () => {
      expect(parseArgs(argv("init"))).toEqual({
        command: "init",
        apiKey: undefined,
      });
    });

    it("throws on unknown flag in init", () => {
      expect(() => parseArgs(argv("init", "--json"))).toThrow(
        "Unknown argument",
      );
    });
  });
});
