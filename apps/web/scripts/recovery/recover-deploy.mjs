#!/usr/bin/env node
/**
 * RUN_FRONTEND_FOUNDATION_DEPLOY — deploy only with explicit --deploy flag.
 * npm run recover:deploy [-- --dry-run] [-- --deploy]
 */

import { loadAnchor } from "./lib/anchor.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { npmScript } from "./lib/run.mjs";

const flags = parseFlags(process.argv.slice(2));

function main() {
  const anchor = loadAnchor();

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  FRONTEND FOUNDATION DEPLOY");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Target: ${anchor.deploymentUrl}`);
  console.log(`  Anchor: ${anchor.commit}\n`);

  console.log("Pre-deploy gate (required):");
  console.log("  npm run verify:foundation\n");

  if (!flags.deploy) {
    console.log("Deploy NOT run — pass --deploy to execute production deploy.\n");
    console.log("  npm run recover:deploy -- --deploy\n");
    console.log("Equivalent: npm run deploy:prod\n");
    process.exit(0);
  }

  if (flags.dryRun) {
    console.log("[dry-run] npm run verify:foundation");
    console.log("[dry-run] npm run deploy:prod");
    console.log("\nDry run complete.\n");
    return;
  }

  npmScript("verify:foundation");
  console.log("\n→ Production deploy (--deploy)…\n");
  npmScript("deploy:prod");
  console.log("\n✓ Deploy invoked. Verify production URL in browser.\n");
}

main();
