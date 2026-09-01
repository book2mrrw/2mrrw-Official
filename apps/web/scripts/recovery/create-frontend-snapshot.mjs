#!/usr/bin/env node
/**
 * Create a local zip snapshot of foundation recovery artifacts.
 * npm run snapshot:foundation
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { ROOT } from "./lib/anchor.mjs";
import { loadAnchor } from "./lib/anchor.mjs";

const OUT_DIR = join(ROOT, "storage/frontend-recovery-snapshots");

const PATHS = [
  "package.json",
  "package-lock.json",
  "docs/foundation",
  "scripts/recovery",
  ".cursor/rules/frontend-foundation.mdc",
  ".env.example",
];

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function main() {
  const anchor = loadAnchor();
  mkdirSync(OUT_DIR, { recursive: true });

  const name = `foundation-snapshot-${anchor.commitShort || anchor.commit.slice(0, 8)}-${timestamp()}`;
  const archivePath = join(OUT_DIR, `${name}.tar.gz`);

  const listFile = join(OUT_DIR, `.filelist-${Date.now()}.txt`);
  const existing = PATHS.filter((p) => existsSync(join(ROOT, p)));
  const { writeFileSync, unlinkSync } = await import("node:fs");
  writeFileSync(listFile, existing.join("\n"));

  console.log("Creating foundation snapshot…");
  console.log(`  Output: ${archivePath}`);
  console.log(`  Paths:  ${existing.join(", ")}\n`);

  try {
    execSync(
      `tar -czf "${archivePath}" -C "${ROOT}" -T "${listFile}"`,
      { stdio: "inherit" }
    );
  } finally {
    unlinkSync(listFile);
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    anchorCommit: anchor.commit,
    archive: archivePath.replace(ROOT + "/", ""),
    paths: existing,
    restoreHint: "Extract to repo root; run npm run recover:foundation",
  };
  const manifestPath = join(OUT_DIR, `${name}.manifest.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`\n✓ Snapshot written:`);
  console.log(`  ${archivePath}`);
  console.log(`  ${manifestPath}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
