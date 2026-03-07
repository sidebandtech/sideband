// SPDX-License-Identifier: Apache-2.0

import type { ConnectedPeer } from "@sideband/cloud";
import * as fs from "node:fs";
import * as path from "node:path";
import { classifyFile } from "./fs-classify.js";
import type { MethodMeta } from "./rpc-meta.js";

/** Maximum bytes to read for any single file (512 KiB). */
const MAX_BYTES = 512 * 1024;

export interface FsEntry {
  name: string;
  type: "file" | "directory";
  size: number | null; // null for directories
  modified: string; // ISO 8601
}

/**
 * Normalises filesystem errors to safe messages without absolute paths.
 * All filesystem calls in both handlers pass through this — no native error
 * (which embeds the absolute path) escapes to the client.
 *
 * Custom codes OUTSIDE_ROOT and DOTFILE are passed through as-is — they were
 * constructed by resolveSafePath and already contain safe messages.
 * Note: custom codes do NOT survive RPC serialisation; integration tests must
 * assert on message text, not on .code values.
 */
function mapFsError(err: unknown, relativePath: string): Error {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT")
    return Object.assign(
      new Error(`No such file or directory: ${relativePath}`),
      { code },
    );
  if (code === "ENOTDIR")
    return Object.assign(new Error(`Not a directory: ${relativePath}`), {
      code,
    });
  if (code === "EACCES" || code === "EPERM")
    return Object.assign(new Error(`Permission denied: ${relativePath}`), {
      code,
    });
  if (code === "EISDIR")
    return Object.assign(
      new Error(`Cannot read a directory: ${relativePath}`),
      { code },
    );
  if (code === "ELOOP")
    return Object.assign(
      new Error(`Too many symbolic links: ${relativePath}`),
      { code },
    );
  if (code === "OUTSIDE_ROOT" || code === "DOTFILE") return err as Error;
  return Object.assign(new Error(`File system error: ${relativePath}`), {
    code,
  });
}

/** Read at most maxBytes from a file using a bounded stream. */
function readBounded(filePath: string, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = fs.createReadStream(filePath, { end: maxBytes - 1 });
    stream.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      total += buf.length;
    });
    stream.on("end", () => resolve(Buffer.concat(chunks, total)));
    stream.on("error", reject);
  });
}

/** Display name for a canonical root — basename, or the full path when basename is empty (e.g. "/"). */
export function fsDisplayName(canonicalRoot: string): string {
  return path.basename(canonicalRoot) || canonicalRoot;
}

/**
 * Registers $sideband/fs.list and $sideband/fs.read handlers for the given peer.
 * Both handlers are scoped to the provided root directory.
 *
 * canonicalRoot is resolved once at registration time (not per request) to avoid
 * race conditions with symlink changes to the root itself.
 *
 * Returns the capability descriptor to be merged into $sideband/info capabilities.
 */
export async function registerFsHandlers(
  peer: ConnectedPeer,
  root: string,
  allowDotfiles: boolean,
): Promise<{ fs: { name: string; write: false } }> {
  const canonicalRoot = await fs.promises.realpath(root);

  async function resolveSafePath(relative: string): Promise<string> {
    // 1. Normalize network-received path to POSIX (client may use backslashes).
    //    On Linux, path.normalize("foo\\..\\bar") treats "\" as a filename char,
    //    leaving ".." undetected in segments. POSIX normalization is required.
    const posixPath = relative.replace(/\\/g, "/");

    // 2. Reject absolute paths (check both POSIX and Windows formats).
    //    path.resolve ignores canonicalRoot if given an absolute path.
    if (path.posix.isAbsolute(posixPath) || path.win32.isAbsolute(posixPath)) {
      throw Object.assign(new Error("Path outside root directory"), {
        code: "OUTSIDE_ROOT",
      });
    }

    // 3. Normalize and split into segments.
    const normalized = path.posix.normalize(posixPath);
    const segments = normalized.split("/").filter(Boolean);

    // 4. Reject ".." traversal (never valid in a file browser).
    if (segments.includes("..")) {
      throw Object.assign(new Error("Path outside root directory"), {
        code: "OUTSIDE_ROOT",
      });
    }

    // 5. Dotfile gate ("." is current directory, not a dotfile).
    if (
      !allowDotfiles &&
      segments.some((s) => s !== "." && s.startsWith("."))
    ) {
      throw Object.assign(new Error("Access denied"), { code: "DOTFILE" });
    }

    // 6. Resolve symlinks. Use normalized path so validation and resolution
    //    operate on the same logical path (original "relative" may differ on Linux).
    const joined = path.resolve(canonicalRoot, normalized);
    let canonical: string;
    try {
      canonical = await fs.promises.realpath(joined);
    } catch (err) {
      throw mapFsError(err, normalized);
    }

    // 7. Containment check — platform-safe; handles case-insensitive FS (macOS HFS+).
    //    path.startsWith is insufficient on case-insensitive filesystems.
    //    Use rel === ".." || rel.startsWith(".." + sep) — NOT startsWith("..") alone,
    //    which would falsely reject valid filenames like "..foo".
    const rel = path.relative(canonicalRoot, canonical);
    if (
      rel === ".." ||
      rel.startsWith(".." + path.sep) ||
      path.isAbsolute(rel)
    ) {
      throw Object.assign(new Error("Path outside root directory"), {
        code: "OUTSIDE_ROOT",
      });
    }

    // 8. Post-resolution dotfile gate — catches symlinks like "envlink → .env".
    //    The pre-realpath check (step 5) only sees input segments; a symlink with a
    //    non-dot name can resolve to a dotfile target. Check resolved segments too.
    if (!allowDotfiles) {
      const relSegments = rel.split(path.sep).filter(Boolean);
      if (relSegments.some((s) => s.startsWith("."))) {
        throw Object.assign(new Error("Access denied"), { code: "DOTFILE" });
      }
    }

    return canonical;
  }

  peer.rpc.handle("$sideband/fs.list", async (params: unknown) => {
    const p = (params as { path?: unknown } | null | undefined)?.path;
    const relative = typeof p === "string" ? p : ".";
    const canonicalDir = await resolveSafePath(relative);

    let dirents: fs.Dirent[];
    try {
      dirents = await fs.promises.readdir(canonicalDir, {
        withFileTypes: true,
      });
    } catch (err) {
      throw mapFsError(err, relative);
    }

    // Filter dotfiles when not allowed (entries starting with ".")
    const filtered = allowDotfiles
      ? dirents
      : dirents.filter((d) => !d.name.startsWith("."));

    // Sort: dirs first, then by lowercase name (locale-free ASCII), then by
    // original name as tiebreak — deterministic across all platforms.
    filtered.sort((a, b) => {
      const dirDiff = Number(b.isDirectory()) - Number(a.isDirectory());
      if (dirDiff !== 0) return dirDiff;
      const aLow = a.name.toLowerCase();
      const bLow = b.name.toLowerCase();
      if (aLow < bLow) return -1;
      if (aLow > bLow) return 1;
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    });

    // hasMore is based on the pre-stat filtered count. Race-condition deletions
    // may reduce the returned count below 1000 even when hasMore is true.
    const hasMore = filtered.length > 1000;
    const candidates = filtered.slice(0, 1000);

    // Stat all candidates — Dirent lacks size and mtime.
    // 1000 concurrent local stats complete in single-digit ms.
    // For symlink entries, also verify the resolved target is inside canonicalRoot.
    // Regular dir entries are always contained; only symlinks can escape.
    const results = await Promise.all(
      candidates.map(async (d) => {
        try {
          const entryPath = path.join(canonicalDir, d.name);
          const st = await fs.promises.stat(entryPath);
          if (d.isSymbolicLink()) {
            const targetCanonical = await fs.promises.realpath(entryPath);
            const rel = path.relative(canonicalRoot, targetCanonical);
            // Same containment check as resolveSafePath — "..foo" is a valid filename.
            if (
              rel === ".." ||
              rel.startsWith(".." + path.sep) ||
              path.isAbsolute(rel)
            ) {
              return null;
            }
            // Mirror resolveSafePath step 8: hide symlinks whose resolved target
            // path contains dotfile segments (e.g. "envlink → .env").
            if (!allowDotfiles) {
              const relSegments = rel.split(path.sep).filter(Boolean);
              if (relSegments.some((s) => s.startsWith("."))) return null;
            }
          }
          return { d, st };
        } catch (err: unknown) {
          // Skip race-condition deletions, broken symlinks, and permission errors.
          // Propagate resource errors (EMFILE, ENOMEM) via mapFsError to preserve
          // the failure-semantics while still normalizing any absolute paths in the message.
          const code = (err as NodeJS.ErrnoException).code;
          if (code && ["ENOENT", "ELOOP", "EACCES", "EPERM"].includes(code))
            return null;
          throw mapFsError(err, d.name);
        }
      }),
    );

    const entries: FsEntry[] = results
      .filter((r): r is { d: fs.Dirent; st: fs.Stats } => r !== null)
      .map(({ d, st }) => ({
        name: d.name,
        type: st.isDirectory() ? "directory" : "file",
        size: st.isDirectory() ? null : st.size,
        modified: st.mtime.toISOString(),
      }));

    return { entries, hasMore };
  });

  peer.rpc.handle("$sideband/fs.read", async (params: unknown) => {
    const p = (params as { path?: unknown } | null | undefined)?.path;
    if (typeof p !== "string" || !p) {
      throw Object.assign(new Error("Missing required parameter: path"), {
        code: "EINVAL",
      });
    }

    const canonical = await resolveSafePath(p);

    let st: fs.Stats;
    try {
      st = await fs.promises.stat(canonical);
    } catch (err) {
      throw mapFsError(err, p);
    }

    if (st.isDirectory()) {
      throw Object.assign(new Error(`Cannot read a directory: ${p}`), {
        code: "EISDIR",
      });
    }
    if (!st.isFile()) {
      throw new Error(`Unsupported file type: ${p}`);
    }

    const { encoding, mediaType } = classifyFile(path.basename(canonical));
    const truncated = st.size > MAX_BYTES;

    if (truncated && encoding === "base64") {
      // Truncating a binary/image at an arbitrary byte boundary produces corrupted data.
      // Return empty string — UI can render a "too large to preview" placeholder.
      return {
        content: "",
        encoding,
        mediaType,
        size: st.size,
        truncated: true,
      };
    }

    let content: string;
    try {
      if (truncated) {
        // utf8: read first MAX_BYTES bytes using a bounded stream.
        // TextDecoder replaces trailing incomplete multibyte sequences with U+FFFD.
        const buf = await readBounded(canonical, MAX_BYTES);
        content = new TextDecoder("utf-8").decode(buf);
      } else {
        const buf = await fs.promises.readFile(canonical);
        content =
          encoding === "utf8"
            ? new TextDecoder("utf-8").decode(buf)
            : buf.toString("base64");
      }
    } catch (err) {
      // Race condition (e.g. file deleted between stat and read): surface safely
      // without leaking the absolute canonical path from the native error message.
      throw mapFsError(err, p);
    }

    return { content, encoding, mediaType, size: st.size, truncated };
  });

  return { fs: { name: fsDisplayName(canonicalRoot), write: false } };
}

export const fsMeta: Record<string, MethodMeta> = {
  "$sideband/fs.list": {
    description:
      "List directory contents. Sorted: directories first, then files by name.",
    input: "{ path?: string }",
    inputExample: { path: "." },
  },
  "$sideband/fs.read": {
    description:
      "Read file contents. Text returned as UTF-8; images/binaries as base64.",
    input: "{ path: string }",
    inputExample: { path: "README.md" },
  },
};
