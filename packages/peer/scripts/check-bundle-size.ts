// SPDX-License-Identifier: Apache-2.0

/**
 * Bundle size check for @sideband/peer.
 *
 * Bundles the main entry point (minified, tree-shaken), gzips, and verifies
 * the result is under the size budget. Workspace dependencies are included
 * (they ship with the package).
 *
 * Uses `target: "bun"` for workspace dependency resolution. The "ws" native
 * module is externalized so it doesn't inflate the count. `listen()` ships
 * separately under `@sideband/peer/server` and is not included here.
 */

const MAX_GZIP_KB = 15;

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  minify: true,
  target: "bun",
  external: ["ws"],
});

if (!result.success) {
  console.error("Build failed:");
  for (const msg of result.logs) {
    console.error(msg);
  }
  process.exit(1);
}

const raw = await result.outputs[0].arrayBuffer();
const gzipped = Bun.gzipSync(new Uint8Array(raw));
const gzipSizeKb = gzipped.length / 1024;

console.log(
  `@sideband/peer bundle: ${gzipSizeKb.toFixed(1)} KB gzipped (budget: ${MAX_GZIP_KB} KB)`,
);

if (gzipSizeKb > MAX_GZIP_KB) {
  console.error(`FAIL: bundle exceeds ${MAX_GZIP_KB} KB budget`);
  process.exit(1);
}

console.log("PASS");
