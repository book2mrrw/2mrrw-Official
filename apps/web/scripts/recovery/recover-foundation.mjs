#!/usr/bin/env node
/**
 * RUN_FRONTEND_FOUNDATION_RECOVERY — full foundation restore workflow.
 * npm run recover:foundation [-- --dry-run] [-- --force] [-- --deploy] [-- --skip-git]
 */

import { execSync } from "node:child_process";
import { loadAnchor, anchorCommit, anchorBranch, ROOT } from "./lib/anchor.mjs";
import { parseFlags, warnForce } from "./lib/flags.mjs";
import { checkEnv, checkControlSystemSync } from "./lib/env-check.mjs";
import { git, npmCi, npmScript, run } from "./lib/run.mjs";

const flags = parseFlags(process.argv.slice(2));

function log(step, message) {
  console.log(`\n[${step}] ${message}`);
}

function header() {
  const anchor = loadAnchor();
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  FRONTEND FOUNDATION RECOVERY");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Anchor commit:  ${anchorCommit(anchor)}`);
  console.log(`  Stable branch:  ${anchorBranch(anchor)}`);
  console.log(`  Production URL: ${anchor.deploymentUrl}`);
  if (flags.dryRun) console.log("  Mode:           DRY RUN (no mutations)");
  if (flags.force) console.log("  Mode:           FORCE (destructive git allowed)");
  console.log("═══════════════════════════════════════════════════════════\n");
  return anchor;
}

function stepGit(anchor) {
  if (flags.skipGit) {
    log("git", "Skipped (--skip-git)");
    return;
  }

  const commit = anchorCommit(anchor);
  const branch = anchorBranch(anchor);

  log("git", `Target: ${commit} (branch ${branch})`);

  if (flags.force) {
    warnForce("git reset --hard and branch -f may discard local changes");
    if (flags.dryRun) {
      console.log(`[dry-run] git checkout ${branch} || git checkout -b ${branch} ${commit}`);
      console.log(`[dry-run] git reset --hard ${commit}`);
    } else {
      try {
        git(["rev-parse", "--verify", branch], { label: "verify branch" });
        git(["checkout", branch]);
      } catch {
        git(["checkout", "-B", branch, commit]);
      }
      git(["reset", "--hard", commit]);
    }
  } else {
    if (flags.dryRun) {
      console.log(`[dry-run] git checkout ${commit}`);
      console.log(`[dry-run] (or) git checkout ${branch}`);
    } else {
      try {
        git(["checkout", branch]);
        console.log(`PASS  On branch ${branch}`);
      } catch {
        console.log(`      Branch ${branch} unavailable — checking out commit`);
        git(["checkout", commit]);
      }
    }
  }
}

function stepLockfiles(anchor) {
  if (!flags.restoreLockfiles) {
    log("lockfiles", "Skipped (--no-restore-lockfiles)");
    return;
  }
  const commit = anchorCommit(anchor);
  log("lockfiles", `Restore package.json + package-lock.json from ${commit.slice(0, 12)}`);

  if (flags.force && !flags.dryRun) {
    git(["checkout", commit, "--", "package.json", "package-lock.json"]);
  } else if (flags.dryRun) {
    console.log(`[dry-run] git checkout ${commit} -- package.json package-lock.json`);
  } else {
    console.log("      Non-destructive mode: using current tree lockfiles (pass --force to restore from anchor)");
  }
}

function stepInstall() {
  if (flags.skipInstall) {
    log("install", "Skipped (--skip-install)");
    return;
  }
  log("install", "npm ci (exact lockfile)");
  npmCi({ dryRun: flags.dryRun });
}

function stepEnv() {
  log("env", "Validate .env.local key names against .env.example");
  const result = checkEnv({ dryRun: flags.dryRun });
  if (!result.ok) {
    console.warn("WARN  Env incomplete — recovery continues (fix before local dev)");
  }
}

async function stepVerify(anchor) {
  log("verify", "Guardrails + foundation smoke");
  npmScript("check:frontend-guardrails", { dryRun: flags.dryRun });
  npmScript("test:foundation", { dryRun: flags.dryRun });

  if (!flags.skipBuild && !flags.quick) {
    log("build", "Production build");
    npmScript("build", { dryRun: flags.dryRun });
    if (!flags.dryRun) {
      run("git", ["diff", "--check"], { label: "git diff --check" });
    }
  }

  log("sync", "Optional control system health check");
  if (!flags.dryRun) {
    await checkControlSystemSync(anchor);
  } else {
    console.log("[dry-run] fetch control system /api/health if URL configured");
  }
}

function stepDeploy(anchor) {
  log("deploy", "Deploy preparation");
  console.log(`      Production: ${anchor.deploymentUrl}`);
  console.log("      Command:    npm run recover:deploy -- --deploy");
  console.log("      Or:         npm run deploy:prod  (requires Vercel auth)");

  if (flags.deploy) {
    if (flags.dryRun) {
      console.log("[dry-run] npm run deploy:prod");
    } else {
      console.log("\n→ Deploying (--deploy flag set)…\n");
      npmScript("deploy:prod");
    }
  } else {
    console.log("      Deploy skipped (pass --deploy to run vercel deploy --prod)");
  }
}

async function main() {
  const anchor = header();

  if (!flags.skipGit) {
    try {
      const dirty = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).trim();
      if (dirty && !flags.force) {
        log("preflight", "Uncommitted changes detected");
        console.warn("WARN  Stash or commit first, or re-run with --force for hard reset.");
      }
    } catch {
      /* not a git repo */
    }
  }

  stepGit(anchor);
  stepLockfiles(anchor);
  stepInstall();
  stepEnv();
  await stepVerify(anchor);
  stepDeploy(anchor);

  console.log("\n✓ Foundation recovery workflow complete.\n");
  if (flags.dryRun) {
    console.log("Dry run finished — no files or git state were changed.\n");
  }
}

main().catch((err) => {
  console.error(`\n✗ Recovery failed: ${err.message}\n`);
  process.exit(1);
});
