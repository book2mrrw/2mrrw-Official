#!/usr/bin/env node
/**
 * VERIFY_FRONTEND_FOUNDATION_STATE
 * npm run verify:foundation [-- --quick] [-- --skip-build]
 */

import { execSync } from "node:child_process";
import { loadAnchor, ROOT } from "./lib/anchor.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { checkEnv, checkControlSystemSync } from "./lib/env-check.mjs";
import { npmScript, run } from "./lib/run.mjs";

const flags = parseFlags(process.argv.slice(2));

async function main() {
  const anchor = loadAnchor();

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  VERIFY FRONTEND FOUNDATION STATE");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Anchor: ${anchor.commit}`);
  console.log(`  HEAD:   ${execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim()}\n`);

  npmScript("check:frontend-guardrails", { dryRun: flags.dryRun });
  npmScript("test:foundation", { dryRun: flags.dryRun });

  checkEnv({ dryRun: flags.dryRun });

  if (!flags.skipBuild && !flags.quick) {
    npmScript("lint", { dryRun: flags.dryRun });
    npmScript("build", { dryRun: flags.dryRun });
    if (!flags.dryRun) {
      run("git", ["diff", "--check"], { label: "git diff --check" });
    }
  } else {
    console.log("\nSKIP  lint/build (--quick or --skip-build)\n");
  }

  if (!flags.dryRun) {
    await checkControlSystemSync(anchor);
  }

  console.log("\n✓ Foundation verification complete.\n");
}

main().catch((err) => {
  console.error(`\n✗ Verification failed: ${err.message}\n`);
  process.exit(1);
});
