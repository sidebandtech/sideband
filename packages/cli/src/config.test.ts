// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  loadIdentityKeyPair,
  resolveApiKey,
  saveConfig,
} from "./config.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "sideband-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── resolveApiKey (resolution order) ────────────────────────────────────────

describe("resolveApiKey", () => {
  const origEnv = process.env["SIDEBAND_API_KEY"];

  afterEach(() => {
    if (origEnv === undefined) delete process.env["SIDEBAND_API_KEY"];
    else process.env["SIDEBAND_API_KEY"] = origEnv;
  });

  it("flag beats env and config", async () => {
    process.env["SIDEBAND_API_KEY"] = "env_key";
    await saveConfig(tmpDir, { apiKey: "config_key" });
    expect(await resolveApiKey("flag_key", tmpDir)).toBe("flag_key");
  });

  it("env beats config when no flag", async () => {
    process.env["SIDEBAND_API_KEY"] = "env_key";
    await saveConfig(tmpDir, { apiKey: "config_key" });
    expect(await resolveApiKey(undefined, tmpDir)).toBe("env_key");
  });

  it("config used when no flag or env", async () => {
    delete process.env["SIDEBAND_API_KEY"];
    await saveConfig(tmpDir, { apiKey: "config_key" });
    expect(await resolveApiKey(undefined, tmpDir)).toBe("config_key");
  });

  it("returns undefined when all sources missing", async () => {
    delete process.env["SIDEBAND_API_KEY"];
    expect(await resolveApiKey(undefined, tmpDir)).toBeUndefined();
  });
});

// ─── loadConfig ───────────────────────────────────────────────────────────────

describe("loadConfig", () => {
  it("returns null when config.json does not exist", async () => {
    expect(await loadConfig(tmpDir)).toBeNull();
  });

  it("returns parsed config when file exists", async () => {
    await saveConfig(tmpDir, { apiKey: "sbnd_dak_test" });
    const config = await loadConfig(tmpDir);
    expect(config?.apiKey).toBe("sbnd_dak_test");
  });

  it("throws a friendly error on malformed JSON", async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, "config.json"), "not-json");
    await expect(loadConfig(tmpDir)).rejects.toThrow("invalid JSON");
  });

  it("throws a friendly error on non-object JSON", async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, "config.json"), '"a string"');
    await expect(loadConfig(tmpDir)).rejects.toThrow("invalid format");
  });

  it("throws a friendly error when apiKey is not a string", async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      join(tmpDir, "config.json"),
      JSON.stringify({ apiKey: 42 }),
    );
    await expect(loadConfig(tmpDir)).rejects.toThrow("apiKey must be a string");
  });
});

// ─── loadIdentityKeyPair ─────────────────────────────────────────────────────

describe("loadIdentityKeyPair", () => {
  it("generates and persists identity on first run", async () => {
    const kp = await loadIdentityKeyPair(tmpDir);
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.privateKey).toBeInstanceOf(Uint8Array);

    // Reload: must return same public key
    const kp2 = await loadIdentityKeyPair(tmpDir);
    expect(kp2.publicKey).toEqual(kp.publicKey);
  });

  it("throws on unsupported key type", async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      join(tmpDir, "identity.json"),
      JSON.stringify({ type: "rsa", publicKey: "aabb", privateKey: "ccdd" }),
    );
    await expect(loadIdentityKeyPair(tmpDir)).rejects.toThrow(
      "unsupported key type",
    );
  });

  it("throws on invalid hex encoding", async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      join(tmpDir, "identity.json"),
      JSON.stringify({
        type: "ed25519",
        publicKey: "nothex!",
        privateKey: "ccdd",
      }),
    );
    await expect(loadIdentityKeyPair(tmpDir)).rejects.toThrow(
      "delete the file to regenerate",
    );
  });

  it("throws a friendly error on malformed JSON", async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, "identity.json"), "not-json");
    await expect(loadIdentityKeyPair(tmpDir)).rejects.toThrow("invalid JSON");
  });
});
