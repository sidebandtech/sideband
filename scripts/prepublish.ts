// SPDX-FileCopyrightText: 2025-present Sideband
// SPDX-License-Identifier: AGPL-3.0-or-later

// Update package.json exports to point types to dist/ before publishing.
// This script is run by prepublish hook; it reverses the types pointer
// from ./src/index.ts (dev) to ./dist/index.d.ts (publish).
// Also copies LICENSE to each package's dist/ for npm pack.

import { readdirSync } from "fs";
import { join } from "path";

const scriptsDir = import.meta.dir;
const rootDir = join(scriptsDir, "..");
const packagesDir = join(rootDir, "packages");
const licenseFile = join(rootDir, "LICENSE");

const packages = readdirSync(packagesDir).filter((name) => {
  try {
    const stat = Bun.file(join(packagesDir, name, "package.json")).size > 0;
    return stat;
  } catch {
    return false;
  }
});

for (const pkg of packages) {
  const pkgPath = join(packagesDir, pkg, "package.json");
  const distDir = join(packagesDir, pkg, "dist");
  const content = await Bun.file(pkgPath).text();
  const pkgJson = JSON.parse(content);

  let updated = false;

  // Update exports field
  if (pkgJson.exports?.["."]?.bun) {
    delete pkgJson.exports["."].bun;
    updated = true;
  }

  if (updated) {
    await Bun.write(pkgPath, JSON.stringify(pkgJson, null, 2) + "\n");
    console.log(`✓ Updated @sideband/${pkg}`);
  }

  // Copy LICENSE to dist/
  try {
    const license = await Bun.file(licenseFile).text();
    await Bun.write(join(distDir, "LICENSE"), license);
  } catch (e) {
    console.warn(`⚠ Failed to copy LICENSE for @sideband/${pkg}`);
  }
}

console.log(
  "\n✓ Prepublish complete: types now point to dist/; LICENSE copied",
);
