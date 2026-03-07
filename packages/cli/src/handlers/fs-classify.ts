// SPDX-License-Identifier: Apache-2.0

import { extname } from "node:path";

// Semantic text — specific MIME types useful to parsers/renderers
const SEMANTIC_TEXT: Record<string, string> = {
  ".json": "application/json",
  ".jsonc": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".scss": "text/css",
  ".less": "text/css",
  ".svg": "image/svg+xml",
  ".xml": "text/xml",
};

// Plain text/code extensions — UI uses filename for syntax highlighting
const TEXT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".md",
  ".mdx",
  ".txt",
  ".log",
  ".yaml",
  ".yml",
  ".toml",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".graphql",
  ".gql",
  ".prisma",
  ".conf",
  ".ini",
  ".lock",
  ".sql",
  ".vue",
  ".svelte",
]);

// Extensionless and dotfile-named files (ALL LOWERCASE — invariant).
// Note: path.extname(".env") === "" — dotfile names belong here, not TEXT_EXTS.
const TEXT_NAMES = new Set([
  // Common extensionless project files
  "dockerfile",
  "makefile",
  "license",
  "licence",
  "readme",
  "caddyfile",
  "procfile",
  "gemfile",
  "rakefile",
  "brewfile",
  // Dotfile configs (accessible only when --allow-dotfiles is set)
  ".env",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".nvmrc",
  ".node-version",
  ".eslintrc",
  ".prettierrc",
  ".npmrc",
  ".babelrc",
  ".yarnrc",
]);

// Images — base64 transport, browser-renderable MIME types
const IMAGE_EXTS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
};

/**
 * Classifies a file by basename to determine transport encoding and MIME type.
 *
 * - encoding "utf8": text/code, returned as a UTF-8 string
 * - encoding "base64": binary/image, returned as base64
 * - mediaType: MIME type for rendering; null means "unknown binary"
 *
 * Receives a filename (basename) — not a full path. Classification uses only
 * extname and basename, so passing the full path is unnecessary coupling.
 */
export function classifyFile(name: string): {
  encoding: "utf8" | "base64";
  mediaType: string | null;
} {
  const ext = extname(name).toLowerCase();
  const lower = name.toLowerCase();
  if (ext) {
    if (SEMANTIC_TEXT[ext])
      return { encoding: "utf8", mediaType: SEMANTIC_TEXT[ext]! };
    if (TEXT_EXTS.has(ext))
      return { encoding: "utf8", mediaType: "text/plain" };
    if (IMAGE_EXTS[ext])
      return { encoding: "base64", mediaType: IMAGE_EXTS[ext]! };
  } else {
    // Extensionless: covers ".env", ".gitignore", "Dockerfile", etc.
    if (TEXT_NAMES.has(lower))
      return { encoding: "utf8", mediaType: "text/plain" };
  }
  return { encoding: "base64", mediaType: null };
}
