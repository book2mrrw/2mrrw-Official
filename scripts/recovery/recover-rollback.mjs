#!/usr/bin/env node
/**
 * RUN_FRONTEND_SAFE_ROLLBACK — safe production rollback guidance + optional local anchor checkout.
 * npm run recover:rollback [-- --dry-run] [-- --local]
 */

import { loadAnchor, anchorCommit } from "./lib/anchor.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { git } from "./lib/run.mjs";

const flags = parseFlags(process.argv.slice(2));

function main() {
  const anchor = loadAnchor();
  const commit = anchorCommit(anchor);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  FRONTEND SAFE ROLLBACK");
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log("Recommended order (fastest first):\n");
  console.log("  1. Vercel Dashboard → Deployments → Promote previous GREEN deployment");
  console.log(`     Project URL: ${anchor.deploymentUrl}`);
  console.log("");
  console.log("  2. Redeploy from foundation anchor (after local verify):");
  console.log("     npm run recover:foundation");
  console.log("     npm run recover:deploy -- --deploy");
  console.log("");
  console.log("  3. Local tree only (no Vercel):");
  console.log(`     git checkout ${commit}`);
  console.log("     npm ci && npm run verify:foundation");
  console.log("");
  console.log("Never: git push --force to main or frontend-stable-foundation without approval.\n");

  if (flags.has("--local")) {
    if (flags.dryRun) {
      console.log(`[dry-run] git checkout ${commit}`);
      return;
    }
    console.log(`→ Checking out anchor locally: ${commit}\n`);
    git(["checkout", commit]);
    console.log("\n✓ Local checkout complete. Run: npm run verify:foundation\n");
  } else if (!flags.dryRun) {
    console.log("Tip: pass --local to checkout anchor commit in this repo only.\n");
  }
}

main();
