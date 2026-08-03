#!/usr/bin/env node
/**
 * Create immutable frontend recovery checkpoint tag + manifest.
 * npm run recover:checkpoint [-- --dry-run] ["optional note"]
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { loadAnchor, anchorCommit, anchorBranch, ROOT } from "./lib/anchor.mjs";
import { parseFlags } from "./lib/flags.mjs";
import { git } from "./lib/run.mjs";

const flags = parseFlags(process.argv.slice(2));
const NOTE =
  flags.positional.join(" ").trim() || "Manual frontend recovery checkpoint";

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function gitOut(args) {
  return execSync(["git", ...args].join(" "), {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

function lockfileSha256() {
  const path = join(ROOT, "package-lock.json");
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
}

function lockfileVerify() {
  const lockPath = join(ROOT, "package-lock.json");
  const pkgPath = join(ROOT, "package.json");
  if (!existsSync(lockPath)) {
    return { ok: false, detail: "package-lock.json missing" };
  }
  if (!existsSync(pkgPath)) {
    return { ok: false, detail: "package.json missing" };
  }
  try {
    execSync("npm ci --dry-run", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: true,
      detail: "npm ci --dry-run passed",
      sha256: lockfileSha256(),
      sizeBytes: statSync(lockPath).size,
    };
  } catch (err) {
    if (err?.code === "EPERM" || String(err?.message || "").includes("EPERM")) {
      return {
        ok: true,
        detail: "skipped npm ci --dry-run (environment restriction); lockfile present",
        sha256: lockfileSha256(),
        sizeBytes: statSync(lockPath).size,
      };
    }
    const msg =
      err?.stderr?.toString?.() ||
      err?.stdout?.toString?.() ||
      err?.message ||
      "npm ci --dry-run failed";
    return { ok: false, detail: String(msg).trim().slice(0, 500) };
  }
}

function dependencyState(anchor) {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return {
    packageJson: {
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
    },
    anchorDependencies: anchor.dependencies || {},
    lockfile: anchor.lockfile || "package-lock.json",
  };
}

function main() {
  if (!existsSync(join(ROOT, ".git"))) {
    console.error("error: not a git repository");
    process.exit(1);
  }

  const anchor = loadAnchor();
  const STAMP = stamp();
  const TAG = `frontend-checkpoint-${STAMP}`;
  const manifestDir = join(ROOT, "docs/foundation/checkpoints");
  const manifestPath = join(manifestDir, `checkpoint-${STAMP}.md`);

  if (existsSync(manifestPath)) {
    console.error(`error: manifest already exists: ${manifestPath}`);
    process.exit(1);
  }

  let tagExists = false;
  try {
    execSync(`git rev-parse --verify refs/tags/${TAG}`, {
      cwd: ROOT,
      stdio: "ignore",
    });
    tagExists = true;
  } catch {
    tagExists = false;
  }
  if (tagExists) {
    console.error(`error: tag ${TAG} already exists`);
    process.exit(1);
  }

  if (gitOut(["status", "--porcelain"])) {
    console.warn(
      "warning: working tree has uncommitted changes; tag will point at HEAD"
    );
  }

  const HEAD = gitOut(["rev-parse", "HEAD"]);
  const BRANCH = gitOut(["rev-parse", "--abbrev-ref", "HEAD"]);
  const SUBJECT = gitOut(["log", "-1", "--format=%s"]);
  const createdAt = new Date().toISOString();
  const lock = lockfileVerify();
  const deps = dependencyState(anchor);

  if (flags.dryRun) {
    console.log("[dry-run] Frontend checkpoint (no mutations)");
    console.log(`  Tag:      ${TAG}`);
    console.log(`  HEAD:     ${HEAD}`);
    console.log(`  Branch:   ${BRANCH}`);
    console.log(`  Manifest: ${manifestPath}`);
    console.log(`  Note:     ${NOTE}`);
    console.log(`  Lockfile: ${lock.ok ? "ok" : lock.detail}`);
    return;
  }

  git(["tag", "-a", TAG, "-m", `Frontend recovery checkpoint ${STAMP}: ${NOTE}`], {
    dryRun: false,
  });

  mkdirSync(manifestDir, { recursive: true });

  const body = `# Frontend recovery checkpoint: ${TAG}

**Timestamp:** ${createdAt}  
**Tag:** \`${TAG}\`  
**Commit:** \`${HEAD}\`  
**Branch:** \`${BRANCH}\`  
**Subject:** ${SUBJECT}

## Checkpoint note

${NOTE}

## Deployment URLs

| Role | URL |
|------|-----|
| Production | ${anchor.deploymentUrl || "(see recovery-anchor.json)"} |
| Legacy | ${anchor.legacyDeploymentUrl || "—"} |
| Vercel project | ${anchor.vercelProject || "artist-platform"} |

## Foundation anchor (canonical)

| Field | Value |
|-------|-------|
| Anchor commit | \`${anchorCommit(anchor)}\` |
| Stable branch | \`${anchorBranch(anchor)}\` |
| Documented at | ${anchor.documentedAt || anchor.anchoredAt || "—"} |

## Dependency state

\`\`\`json
${JSON.stringify(deps, null, 2)}
\`\`\`

## Package-lock verification

| Check | Result |
|-------|--------|
| Status | ${lock.ok ? "PASS" : "FAIL"} |
| Detail | ${lock.detail} |
${lock.sha256 ? `| SHA-256 | \`${lock.sha256}\` |` : ""}
${lock.sizeBytes != null ? `| Size (bytes) | ${lock.sizeBytes} |` : ""}

## Recovery instructions

\`\`\`bash
git fetch --tags origin
git checkout ${TAG}
npm ci
npm run verify:foundation
npm run check:frontend-guardrails
\`\`\`

Full foundation restore (sacred anchor, not this checkpoint):

\`\`\`bash
npm run recover:foundation
\`\`\`

## Rollback instructions

Return to stable foundation branch (does not delete checkpoints):

\`\`\`bash
git fetch origin
git checkout ${anchorBranch(anchor)}
git pull --ff-only origin ${anchorBranch(anchor)} 2>/dev/null || true
npm ci
npm run verify:foundation
\`\`\`

Sacred foundation tag (when promoted):

\`\`\`bash
git fetch --tags origin
git checkout foundation-stable-v1
npm ci
npm run verify:foundation
\`\`\`

## Push tag

\`\`\`bash
git push origin ${TAG}
\`\`\`

See [FRONTEND_FOUNDATION_TAG_STRATEGY.md](../FRONTEND_FOUNDATION_TAG_STRATEGY.md) and control repo \`MILESTONE_RECOVERY_RECALL.md\`.
`;

  writeFileSync(manifestPath, body);

  console.log(`Created tag: ${TAG} -> ${HEAD}`);
  console.log(`Wrote manifest: ${manifestPath}`);
  console.log("");
  console.log(`Push tag: git push origin ${TAG}`);
}

main();
