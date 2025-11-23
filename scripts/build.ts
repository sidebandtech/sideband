// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync } from "fs";
import { join } from "path";

const packagesDir = join(import.meta.dir, "../packages");
const packages = readdirSync(packagesDir);

const entrypoints: string[] = [];

// Find all packages with src/index.ts
for (const pkg of packages) {
  const srcDir = join(packagesDir, pkg, "src");
  const indexPath = join(srcDir, "index.ts");
  try {
    const stat = await Bun.file(indexPath).exists();
    if (stat) {
      entrypoints.push(join(srcDir, "index.ts"));
    }
  } catch {
    // File doesn't exist, skip
  }
}

if (entrypoints.length === 0) {
  console.log("No entry points found");
  process.exit(0);
}

console.log(`Building ${entrypoints.length} package(s)...`);

// Build each entry point individually to get correct output paths
let totalOutputs = 0;

for (const entrypoint of entrypoints) {
  const pkgName = entrypoint.split("/").slice(-3, -1).join("/"); // Get package/src
  const pkgDir = entrypoint.replace("/src/index.ts", "");
  const outDir = join(pkgDir, "dist");

  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: outDir,
    target: "bun",
    sourcemap: "external",
    minify: false,
  });

  if (!result.success) {
    console.error(`Build failed for ${entrypoint}:`);
    result.logs.forEach((log) => console.error(log));
    process.exit(1);
  }

  totalOutputs += result.outputs.length;
}

console.log("Build successful");
console.log(
  `Generated ${totalOutputs} file(s) across ${entrypoints.length} package(s)`,
);
