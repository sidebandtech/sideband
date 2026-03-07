// SPDX-License-Identifier: Apache-2.0

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type FsEntry, registerFsHandlers } from "./fs.js";
import { makeStubPeer } from "./test-utils.js";

/** Cast callHandler result to a Promise so tests can await and assert. */
function call<T>(fn: unknown): Promise<T> {
  return Promise.resolve(fn) as Promise<T>;
}

// ─── Test fixtures setup ──────────────────────────────────────────────────────

let tmpRoot: string;
let tmpOutside: string;

beforeAll(async () => {
  tmpRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "sideband-fs-test-root-"),
  );
  tmpOutside = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "sideband-fs-test-outside-"),
  );

  // hello.txt — small text file
  await fs.promises.writeFile(path.join(tmpRoot, "hello.txt"), "Hello, world!");
  // data.json — semantic text
  await fs.promises.writeFile(path.join(tmpRoot, "data.json"), '{"ok":true}');
  // image.png — small binary (≤ MAX_BYTES)
  await fs.promises.writeFile(
    path.join(tmpRoot, "image.png"),
    Buffer.alloc(100),
  );
  // large.bin — binary > MAX_BYTES
  await fs.promises.writeFile(
    path.join(tmpRoot, "large.bin"),
    Buffer.alloc(512 * 1024 + 1),
  );
  // large.txt — text > MAX_BYTES
  await fs.promises.writeFile(
    path.join(tmpRoot, "large.txt"),
    Buffer.alloc(512 * 1024 + 1, 65),
  ); // "A" * 512KiB+1
  // exact.txt — text exactly 512 KB (not truncated)
  await fs.promises.writeFile(
    path.join(tmpRoot, "exact.txt"),
    Buffer.alloc(512 * 1024, 66),
  ); // "B" * 512KiB
  // .env — dotfile
  await fs.promises.writeFile(path.join(tmpRoot, ".env"), "SECRET=foo");
  // subdir/ with a nested file
  await fs.promises.mkdir(path.join(tmpRoot, "subdir"));
  await fs.promises.writeFile(
    path.join(tmpRoot, "subdir", "nested.ts"),
    "export {};",
  );
  // subdir2/ (another directory for sort testing)
  await fs.promises.mkdir(path.join(tmpRoot, "subdir2"));
  // outside target
  await fs.promises.writeFile(path.join(tmpOutside, "secret.txt"), "secret");
  // symlink inside root pointing outside
  await fs.promises.symlink(tmpOutside, path.join(tmpRoot, "escape-link"));
  // broken symlink
  await fs.promises.symlink(
    path.join(tmpRoot, "nonexistent"),
    path.join(tmpRoot, "broken-link"),
  );
});

afterAll(async () => {
  await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  await fs.promises.rm(tmpOutside, { recursive: true, force: true });
});

// ─── Helper: register handlers once per test group ────────────────────────────

function makeHandlers(allowDotfiles = false) {
  const stub = makeStubPeer();
  // registerFsHandlers is async; tests must await the setup
  const ready = registerFsHandlers(stub.peer, tmpRoot, allowDotfiles);
  return {
    ready,
    callHandler: stub.callHandler.bind(stub),
    stub,
  };
}

// ─── resolveSafePath — traversal protection ───────────────────────────────────

describe("resolveSafePath — traversal protection", () => {
  let callHandler: ReturnType<typeof makeHandlers>["callHandler"];

  beforeAll(async () => {
    const h = makeHandlers(false);
    await h.ready;
    callHandler = h.callHandler;
  });

  it("rejects absolute POSIX path before any I/O", async () => {
    await expect(
      call(callHandler("$sideband/fs.list", { path: "/etc/passwd" })),
    ).rejects.toThrow("Path outside root directory");
  });

  it("rejects absolute Windows path before any I/O", async () => {
    await expect(
      call(callHandler("$sideband/fs.list", { path: "C:\\Windows" })),
    ).rejects.toThrow("Path outside root directory");
  });

  it("rejects backslash traversal (normalised to ../../etc on Linux)", async () => {
    await expect(
      call(callHandler("$sideband/fs.list", { path: "foo\\..\\..\\etc" })),
    ).rejects.toThrow("Path outside root directory");
  });

  it("rejects ../../../etc traversal", async () => {
    await expect(
      call(callHandler("$sideband/fs.list", { path: "../../../etc" })),
    ).rejects.toThrow("Path outside root directory");
  });

  it("rejects symlink inside root pointing outside → OUTSIDE_ROOT", async () => {
    await expect(
      call(callHandler("$sideband/fs.list", { path: "escape-link" })),
    ).rejects.toThrow("Path outside root directory");
  });

  it("rejects symlink with non-dot name pointing to a dotfile target", async () => {
    // Create a symlink "envlink -> .env" inside root
    const linkPath = path.join(tmpRoot, "envlink");
    try {
      await fs.promises.symlink(path.join(tmpRoot, ".env"), linkPath);
    } catch {
      // may already exist
    }
    await expect(
      call(callHandler("$sideband/fs.read", { path: "envlink" })),
    ).rejects.toThrow("Access denied");
    await fs.promises.unlink(linkPath).catch(() => {});
  });

  it("error messages do not contain the canonicalRoot path", async () => {
    const err = await call(
      callHandler("$sideband/fs.list", { path: "/etc/passwd" }),
    ).catch((e: Error) => e);
    expect((err as Error).message).not.toContain(tmpRoot);
  });
});

// ─── Dotfile gate ─────────────────────────────────────────────────────────────

describe("dotfile gate", () => {
  let noDotsCall: ReturnType<typeof makeHandlers>["callHandler"];
  let withDotsCall: ReturnType<typeof makeHandlers>["callHandler"];

  beforeAll(async () => {
    const h1 = makeHandlers(false);
    await h1.ready;
    noDotsCall = h1.callHandler;

    const h2 = makeHandlers(true);
    await h2.ready;
    withDotsCall = h2.callHandler;
  });

  it('fs.list({ path: "." }) succeeds — "." is never a dotfile', async () => {
    const result = await call<{ entries: FsEntry[] }>(
      noDotsCall("$sideband/fs.list", { path: "." }),
    );
    expect(result.entries).toBeDefined();
  });

  it("fs.list hides .env by default", async () => {
    const result = await call<{ entries: FsEntry[] }>(
      noDotsCall("$sideband/fs.list", { path: "." }),
    );
    expect(result.entries.map((e) => e.name)).not.toContain(".env");
  });

  it("fs.list shows .env with allowDotfiles", async () => {
    const result = await call<{ entries: FsEntry[] }>(
      withDotsCall("$sideband/fs.list", { path: "." }),
    );
    expect(result.entries.map((e) => e.name)).toContain(".env");
  });

  it("fs.read .env fails without allowDotfiles → DOTFILE code", async () => {
    const err = await call(
      noDotsCall("$sideband/fs.read", { path: ".env" }),
    ).catch((e: NodeJS.ErrnoException) => e);
    expect((err as NodeJS.ErrnoException).code).toBe("DOTFILE");
  });

  it("fs.read .env succeeds with allowDotfiles", async () => {
    const result = await call<{ content: string; encoding: string }>(
      withDotsCall("$sideband/fs.read", { path: ".env" }),
    );
    expect(result.encoding).toBe("utf8");
    expect(result.content).toBe("SECRET=foo");
  });

  it('filename starting with ".." is not rejected as outside-root (containment fix)', async () => {
    // "..readme" starts with "." so it is a dotfile — only accessible with allowDotfiles.
    // This test verifies the containment check uses rel === ".." || rel.startsWith("../")
    // and NOT rel.startsWith(".."), which would wrongly reject "..readme".
    const dotDotFile = path.join(tmpRoot, "..readme");
    await fs.promises.writeFile(dotDotFile, "contents");
    try {
      // The file is accessible (not rejected as OUTSIDE_ROOT).
      // "..readme" has no known extension → base64 encoded, so just check it returns.
      const result = await call<{ content: string; size: number }>(
        withDotsCall("$sideband/fs.read", { path: "..readme" }),
      );
      expect(result.size).toBe(8); // "contents" is 8 bytes
    } finally {
      await fs.promises.unlink(dotDotFile).catch(() => {});
    }
  });

  it("fs.read .gitignore classifies as utf8/text-plain when accessible", async () => {
    await fs.promises.writeFile(
      path.join(tmpRoot, ".gitignore"),
      "node_modules",
    );
    const result = await call<{ encoding: string; mediaType: string }>(
      withDotsCall("$sideband/fs.read", { path: ".gitignore" }),
    );
    expect(result.encoding).toBe("utf8");
    expect(result.mediaType).toBe("text/plain");
  });

  it("nested dotfile dir blocked without allowDotfiles", async () => {
    await fs.promises.mkdir(path.join(tmpRoot, ".git"), { recursive: true });
    await fs.promises.writeFile(path.join(tmpRoot, ".git", "config"), "[core]");
    await expect(
      call(noDotsCall("$sideband/fs.read", { path: ".git/config" })),
    ).rejects.toThrow();
  });
});

// ─── fs.list ─────────────────────────────────────────────────────────────────

describe("$sideband/fs.list", () => {
  let callHandler: ReturnType<typeof makeHandlers>["callHandler"];

  beforeAll(async () => {
    const h = makeHandlers(false);
    await h.ready;
    callHandler = h.callHandler;
  });

  it("returns FsEntry array with correct shape", async () => {
    const result = await call<{ entries: FsEntry[]; hasMore: boolean }>(
      callHandler("$sideband/fs.list", { path: "." }),
    );
    expect(Array.isArray(result.entries)).toBe(true);
    expect(typeof result.hasMore).toBe("boolean");
    const first = result.entries[0]!;
    expect(typeof first.name).toBe("string");
    expect(["file", "directory"]).toContain(first.type);
    expect(typeof first.modified).toBe("string");
  });

  it("sorts directories before files (non-symlink entries)", async () => {
    // Symlinks to directories sort among files in the pre-stat phase — documented
    // invariant (accepted O(N) stat trade-off). Test in a clean dir without symlinks.
    const cleanDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "sideband-fs-sortclean-"),
    );
    try {
      await fs.promises.mkdir(path.join(cleanDir, "adir"));
      await fs.promises.writeFile(path.join(cleanDir, "afile.txt"), "");
      await fs.promises.mkdir(path.join(cleanDir, "bdir"));
      await fs.promises.writeFile(path.join(cleanDir, "bfile.txt"), "");
      const cleanStub = makeStubPeer();
      await registerFsHandlers(cleanStub.peer, cleanDir, false);
      const result = await call<{ entries: FsEntry[] }>(
        cleanStub.callHandler("$sideband/fs.list", { path: "." }),
      );
      const types = result.entries.map((e) => e.type);
      const firstFile = types.indexOf("file");
      const lastDir = types.lastIndexOf("directory");
      expect(lastDir).toBeLessThan(firstFile);
    } finally {
      await fs.promises.rm(cleanDir, { recursive: true, force: true });
    }
  });

  it("FsEntry.size is null for directories, number for files", async () => {
    const result = await call<{ entries: FsEntry[] }>(
      callHandler("$sideband/fs.list", { path: "." }),
    );
    for (const entry of result.entries) {
      if (entry.type === "directory") {
        expect(entry.size).toBeNull();
      } else {
        expect(typeof entry.size).toBe("number");
      }
    }
  });

  it("FsEntry.name never contains path separators", async () => {
    const result = await call<{ entries: FsEntry[] }>(
      callHandler("$sideband/fs.list", { path: "." }),
    );
    for (const entry of result.entries) {
      expect(entry.name).not.toContain("/");
      expect(entry.name).not.toContain("\\");
    }
  });

  it("lists subdirectory contents", async () => {
    const result = await call<{ entries: FsEntry[] }>(
      callHandler("$sideband/fs.list", { path: "subdir" }),
    );
    expect(result.entries.some((e) => e.name === "nested.ts")).toBe(true);
  });

  it("broken symlink is skipped silently — listing succeeds", async () => {
    const result = await call<{ entries: FsEntry[] }>(
      callHandler("$sideband/fs.list", { path: "." }),
    );
    // broken-link is present as a dirent but skipped after stat failure
    const names = result.entries.map((e) => e.name);
    expect(names).not.toContain("broken-link");
    // Other entries are still returned — the listing does not fail
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("symlink to outside root is hidden in listing", async () => {
    // escape-link → tmpOutside. Navigation is blocked by resolveSafePath (separate test).
    // The entry should also be hidden in the listing to avoid UX confusion.
    const result = await call<{ entries: FsEntry[] }>(
      callHandler("$sideband/fs.list", { path: "." }),
    );
    expect(result.entries.map((e) => e.name)).not.toContain("escape-link");
  });

  it("symlink with non-dot name pointing to in-root dotfile is hidden without allowDotfiles", async () => {
    // "envlink → .env" is inside root (containment passes) but resolves to a dotfile.
    // It must be hidden from the listing when allowDotfiles=false.
    const linkPath = path.join(tmpRoot, "envlink");
    await fs.promises
      .symlink(path.join(tmpRoot, ".env"), linkPath)
      .catch(() => {});
    try {
      const result = await call<{ entries: FsEntry[] }>(
        callHandler("$sideband/fs.list", { path: "." }),
      );
      expect(result.entries.map((e) => e.name)).not.toContain("envlink");
    } finally {
      await fs.promises.unlink(linkPath).catch(() => {});
    }
  });

  it("hasMore: false when directory has ≤ 1000 entries", async () => {
    const result = await call<{ hasMore: boolean }>(
      callHandler("$sideband/fs.list", { path: "." }),
    );
    expect(result.hasMore).toBe(false);
  });

  it("hasMore: true when filtered entry count exceeds 1000", async () => {
    // Create a separate dir with 1001 files
    const bigDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "sideband-fs-big-"),
    );
    try {
      await Promise.all(
        Array.from({ length: 1001 }, (_, i) =>
          fs.promises.writeFile(path.join(bigDir, `file${i}.txt`), ""),
        ),
      );
      const bigStub = makeStubPeer();
      await registerFsHandlers(bigStub.peer, bigDir, false);
      const result = await call<{ hasMore: boolean }>(
        bigStub.callHandler("$sideband/fs.list", { path: "." }),
      );
      expect(result.hasMore).toBe(true);
    } finally {
      await fs.promises.rm(bigDir, { recursive: true, force: true });
    }
  });

  it("fs.list on a file path → ENOTDIR error", async () => {
    await expect(
      call(callHandler("$sideband/fs.list", { path: "hello.txt" })),
    ).rejects.toThrow("Not a directory");
  });

  it("sort is locale-free: deterministic tiebreak for same-lowercase names", async () => {
    // "README.md" vs "readme.md" — same lowercase; original name is tiebreak
    const mixedDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "sideband-fs-sort-"),
    );
    try {
      await fs.promises.writeFile(path.join(mixedDir, "readme.md"), "");
      await fs.promises.writeFile(path.join(mixedDir, "README.md"), "");
      const sortStub = makeStubPeer();
      await registerFsHandlers(sortStub.peer, mixedDir, false);
      const r1 = await call<{ entries: FsEntry[] }>(
        sortStub.callHandler("$sideband/fs.list", { path: "." }),
      );
      const r2 = await call<{ entries: FsEntry[] }>(
        sortStub.callHandler("$sideband/fs.list", { path: "." }),
      );
      // Same order across calls
      expect(r1.entries.map((e) => e.name)).toEqual(
        r2.entries.map((e) => e.name),
      );
    } finally {
      await fs.promises.rm(mixedDir, { recursive: true, force: true });
    }
  });
});

// ─── fs.read ──────────────────────────────────────────────────────────────────

describe("$sideband/fs.read", () => {
  let callHandler: ReturnType<typeof makeHandlers>["callHandler"];

  beforeAll(async () => {
    const h = makeHandlers(true); // allowDotfiles for full read coverage
    await h.ready;
    callHandler = h.callHandler;
  });

  it("text file → encoding: utf8, correct mediaType", async () => {
    const result = await call<{
      content: string;
      encoding: string;
      mediaType: string;
      size: number;
      truncated: boolean;
    }>(callHandler("$sideband/fs.read", { path: "hello.txt" }));
    expect(result.encoding).toBe("utf8");
    expect(result.mediaType).toBe("text/plain");
    expect(result.content).toBe("Hello, world!");
    expect(result.truncated).toBe(false);
    expect(result.size).toBe(13);
  });

  it("json file → encoding: utf8, mediaType: application/json", async () => {
    const result = await call<{ encoding: string; mediaType: string }>(
      callHandler("$sideband/fs.read", { path: "data.json" }),
    );
    expect(result.encoding).toBe("utf8");
    expect(result.mediaType).toBe("application/json");
  });

  it("image file ≤ MAX_BYTES → encoding: base64, content non-empty", async () => {
    const result = await call<{
      content: string;
      encoding: string;
      mediaType: string;
      truncated: boolean;
    }>(callHandler("$sideband/fs.read", { path: "image.png" }));
    expect(result.encoding).toBe("base64");
    expect(result.mediaType).toBe("image/png");
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it("binary file > MAX_BYTES → content: '', truncated: true (no corrupted data)", async () => {
    const result = await call<{
      content: string;
      encoding: string;
      truncated: boolean;
      size: number;
    }>(callHandler("$sideband/fs.read", { path: "large.bin" }));
    expect(result.encoding).toBe("base64");
    expect(result.content).toBe("");
    expect(result.truncated).toBe(true);
    expect(result.size).toBe(512 * 1024 + 1);
  });

  it("text file > MAX_BYTES → truncated: true, content is first 512KiB", async () => {
    const result = await call<{
      content: string;
      encoding: string;
      truncated: boolean;
      size: number;
    }>(callHandler("$sideband/fs.read", { path: "large.txt" }));
    expect(result.encoding).toBe("utf8");
    expect(result.truncated).toBe(true);
    expect(result.size).toBe(512 * 1024 + 1);
    // Content is bounded to ≤ MAX_BYTES
    expect(Buffer.byteLength(result.content, "utf8")).toBeLessThanOrEqual(
      512 * 1024,
    );
  });

  it("size always equals stat.size regardless of truncation", async () => {
    const result = await call<{ size: number; truncated: boolean }>(
      callHandler("$sideband/fs.read", { path: "large.txt" }),
    );
    expect(result.size).toBe(512 * 1024 + 1);
    expect(result.truncated).toBe(true);
  });

  it("file of exactly 512 KiB → truncated: false", async () => {
    const result = await call<{ truncated: boolean; size: number }>(
      callHandler("$sideband/fs.read", { path: "exact.txt" }),
    );
    expect(result.truncated).toBe(false);
    expect(result.size).toBe(512 * 1024);
  });

  it("directory path → EISDIR error", async () => {
    await expect(
      call(callHandler("$sideband/fs.read", { path: "subdir" })),
    ).rejects.toThrow("Cannot read a directory");
  });

  it("non-existent path → ENOENT error", async () => {
    await expect(
      call(callHandler("$sideband/fs.read", { path: "nonexistent.txt" })),
    ).rejects.toThrow("No such file or directory");
  });

  it("missing path parameter → error", async () => {
    await expect(call(callHandler("$sideband/fs.read", {}))).rejects.toThrow(
      "Missing required parameter",
    );
  });

  it("symlink loop → ELOOP error", async () => {
    // Create a → b → a circular symlinks
    const loopA = path.join(tmpRoot, "loop-a");
    const loopB = path.join(tmpRoot, "loop-b");
    try {
      await fs.promises.symlink(loopB, loopA);
      await fs.promises.symlink(loopA, loopB);
      await expect(
        call(callHandler("$sideband/fs.read", { path: "loop-a" })),
      ).rejects.toThrow("Too many symbolic links");
    } finally {
      await fs.promises.unlink(loopA).catch(() => {});
      await fs.promises.unlink(loopB).catch(() => {});
    }
  });
});

// ─── Capability descriptor ────────────────────────────────────────────────────

describe("registerFsHandlers return value", () => {
  it("returns { fs: { name: fsDisplayName(root), write: false } }", async () => {
    const stub = makeStubPeer();
    const cap = await registerFsHandlers(stub.peer, tmpRoot, false);
    expect(cap).toEqual({ fs: { name: path.basename(tmpRoot), write: false } });
  });

  it("name is the directory basename without path separators (typical case)", async () => {
    const stub = makeStubPeer();
    const cap = await registerFsHandlers(stub.peer, tmpRoot, false);
    expect(cap.fs.name).not.toContain("/");
  });

  it("name falls back to '/' when basename is empty (--dir / edge case)", async () => {
    // path.basename("/") === "" on POSIX; fsDisplayName falls back to the full path.
    // This is acceptable: "/" doesn't reveal machine-specific layout.
    const stub = makeStubPeer();
    const cap = await registerFsHandlers(stub.peer, "/", false);
    expect(cap.fs.name).toBe("/");
  });
});

// ─── Integration: rpc.list reflects fs handlers ───────────────────────────────

describe("integration — rpc method registration", () => {
  it("both $sideband/fs.list and $sideband/fs.read are registered", async () => {
    const stub = makeStubPeer();
    await registerFsHandlers(stub.peer, tmpRoot, false);
    const methods = stub.peer.rpc.listMethods();
    expect(methods).toContain("$sideband/fs.list");
    expect(methods).toContain("$sideband/fs.read");
  });

  it("fs handlers absent when registerFsHandlers is not called", () => {
    const stub = makeStubPeer();
    const methods = stub.peer.rpc.listMethods();
    expect(methods).not.toContain("$sideband/fs.list");
    expect(methods).not.toContain("$sideband/fs.read");
  });
});
