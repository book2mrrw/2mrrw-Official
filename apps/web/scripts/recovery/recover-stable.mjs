#!/usr/bin/env node
/**
 * RUN_FRONTEND_STABLE_RESTORE — point frontend-stable-foundation at anchor (non-destructive by default).
 * npm run recover:stable [-- --dry-run] [-- --force]
 */

import { execSync } from "node:child_process";
import { loadAnchor, anchorCommit, anchorBranch, ROOT } from "./lib/anchor.mjs";
import { parseFlags, warnForce } from "./lib/flags.mjs";
import { git } from "./lib/run.mjs";

const flags = parseFlags(process.argv.slice(2));

function main() {
  const anchor = loadAnchor();
  const commit = anchorCommit(anchor);
  const branch = anchorBranch(anchor);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  FRONTEND STABLE BRANCH RESTORE");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Branch:  ${branch}`);
  console.log(`  Commit:  ${commit}`);
  console.log(`  URL:     ${anchor.deploymentUrl}\n`);

  if (flags.dryRun) {
    console.log(`[dry-run] git branch -f ${branch} ${commit}`);
    console.log(`[dry-run] git checkout ${branch}`);
    console.log("\nDry run complete.\n");
    return;
  }

  const branchExists = (() => {
    try {
      execSync(`git rev-parse --verify refs/heads/${branch}`, {
        cwd: ROOT,
        stdio: "pipe",
      });
      return true;
    } catch {
      return false;
    }
  })();

  if (flags.force) {
    warnForce(`git branch -f ${branch} ${commit}`);
    git(["branch", "-f", branch, commit]);
  } else if (!branchExists) {
    console.log(`→ Creating branch ${branch} at anchor`);
    git(["branch", branch, commit]);
  } else {
    const current = execSync(`git rev-parse ${branch}`, {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    if (current !== commit) {
      console.warn(`WARN  ${branch} is at ${current.slice(0, 12)}, anchor is ${commit.slice(0, 12)}`);
      console.warn("      Re-run with --force to move branch pointer (local only, no push).");
    } else {
      console.log(`PASS  ${branch} already at anchor commit`);
    }
  }

  git(["checkout", branch]);
  console.log(`\n✓ Checked out ${branch}. Run npm run recover:foundation to reinstall and verify.\n`);
}

main();
