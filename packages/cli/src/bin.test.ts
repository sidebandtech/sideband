// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "bun:test";
import { parseArgs } from "./bin.js";

describe("parseArgs", () => {
  const node = "node";
  const bin = "sideband";
  const argv = (...args: string[]) => [node, bin, ...args];

  describe("start command (default)", () => {
    it("parses --api-key flag", () => {
      expect(parseArgs(argv("--api-key", "sbnd_dak_abc"))).toEqual({
        command: "start",
        apiKey: "sbnd_dak_abc",
        json: false,
      });
    });

    it("parses --api-key=<value> form", () => {
      expect(parseArgs(argv("--api-key=sbnd_dak_abc"))).toEqual({
        command: "start",
        apiKey: "sbnd_dak_abc",
        json: false,
      });
    });

    it("parses --json flag", () => {
      expect(parseArgs(argv("--json"))).toEqual({
        command: "start",
        apiKey: undefined,
        json: true,
      });
    });

    it("parses --json + --api-key together", () => {
      expect(parseArgs(argv("--json", "--api-key=key123"))).toEqual({
        command: "start",
        apiKey: "key123",
        json: true,
      });
    });

    it("returns undefined apiKey when flag absent", () => {
      expect(parseArgs(argv())).toEqual({
        command: "start",
        apiKey: undefined,
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
