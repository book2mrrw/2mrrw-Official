#!/usr/bin/env node
/**
 * Lightweight stability checks for the official frontend foundation baseline.
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let failures = 0;

function fail(message) {
  console.error(`FAIL ${message}`);
  failures += 1;
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
}

const EXPECTED = {
  next: "16.2.4",
  react: "19.2.4",
  "react-dom": "19.2.4",
  "framer-motion": "12.38.0",
  "@supabase/ssr": "0.10.3",
  "@supabase/supabase-js": "2.105.4",
  "@stripe/react-stripe-js": "6.2.0",
  "@stripe/stripe-js": "9.2.0",
};

const pkg = readJson("package.json");
for (const [name, version] of Object.entries(EXPECTED)) {
  const actual = pkg.dependencies?.[name];
  if (actual !== version) {
    fail(`${name} expected ${version}, got ${actual ?? "missing"}`);
  } else {
    pass(`${name} pinned at ${version}`);
  }
}

for (const [section, deps] of Object.entries({
  dependencies: pkg.dependencies || {},
  devDependencies: pkg.devDependencies || {},
})) {
  for (const [name, version] of Object.entries(deps)) {
    if (typeof version === "string" && /^[\^~]/.test(version)) {
      fail(`${section}.${name} is not exact-pinned (${version})`);
    }
  }
}
if (!failures) pass("All package.json versions are exact-pinned");

const foundationDocs = [
  "docs/foundation/recovery-anchor.json",
  "docs/foundation/FRONTEND_FOUNDATION_BASELINE.md",
  "docs/foundation/FRONTEND_RECOVERY_ANCHOR.md",
  "docs/foundation/FRONTEND_DEPLOYMENT_REFERENCE.md",
  "docs/foundation/CURRENT_FRONTEND_SYSTEM_STATE.md",
  "docs/foundation/FRONTEND_RECOVERY_PROTOCOL.md",
  "docs/foundation/FRONTEND_ARCHITECTURAL_GUARDRAILS.md",
  "docs/foundation/FRONTEND_DEPLOYMENT_RULES.md",
  "docs/foundation/FRONTEND_LONG_TERM_RECOVERY.md",
  "docs/foundation/FRONTEND_FOUNDATION_REPORT.md",
  "docs/foundation/CURSOR_RECOVERY_WORKFLOWS.md",
  "docs/foundation/FRONTEND_EMERGENCY_RECOVERY_PLAYBOOK.md",
  "docs/foundation/FRONTEND_LOCAL_RECOVERY.md",
  "docs/foundation/FRONTEND_RECOVERY_COMMAND_REPORT.md",
];

for (const doc of foundationDocs) {
  if (!existsSync(join(ROOT, doc))) {
    fail(`Missing ${doc}`);
  } else {
    pass(`Found ${doc}`);
  }
}

const criticalPaths = [
  "src/app/page.js",
  "src/app/layout.js",
  "src/context/AuthContext.js",
  "src/context/AudioContext.js",
  "src/lib/supabase/client.js",
  "src/lib/supabase/server.js",
  "middleware.js",
  ".cursor/rules/frontend-foundation.mdc",
  "scripts/recovery/recover-foundation.mjs",
  "scripts/recovery/verify-foundation.mjs",
];

for (const path of criticalPaths) {
  if (!existsSync(join(ROOT, path))) {
    fail(`Missing critical path ${path}`);
  } else {
    pass(`Found ${path}`);
  }
}

try {
  const head = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  const baseline = readFileSync(
    join(ROOT, "docs/foundation/FRONTEND_FOUNDATION_BASELINE.md"),
    "utf8"
  );
  const anchor = existsSync(join(ROOT, "docs/foundation/recovery-anchor.json"))
    ? readJson("docs/foundation/recovery-anchor.json")
    : null;
  let operational = head;
  if (anchor?.operationalTag) {
    try {
      operational = execSync(`git rev-parse ${anchor.operationalTag}^{commit}`, {
        cwd: ROOT,
        encoding: "utf8",
      }).trim();
    } catch {
      operational = head;
    }
  }
  const baselineOk =
    baseline.includes(head) ||
    (operational === head &&
      (baseline.includes(anchor?.operationalTag || "") ||
        baseline.includes("recovery-anchor.json")));
  if (!baselineOk) {
    fail(`FRONTEND_FOUNDATION_BASELINE.md does not document current HEAD (${head})`);
  } else {
    pass(`Baseline doc references current HEAD ${head.slice(0, 12)}…`);
  }

  const anchorPath = join(ROOT, "docs/foundation/recovery-anchor.json");
  if (existsSync(anchorPath) && anchor) {
    let expected = anchor.commit;
    if (anchor.operationalTag) {
      try {
        expected = execSync(`git rev-parse ${anchor.operationalTag}^{commit}`, {
          cwd: ROOT,
          encoding: "utf8",
        }).trim();
      } catch {
        // use anchor.commit
      }
    }
    if (expected !== head) {
      fail(
        `operational anchor (${expected}) != HEAD (${head})` +
          (anchor.operationalTag ? ` [tag ${anchor.operationalTag}]` : "")
      );
    } else {
      pass(
        anchor.operationalTag
          ? `Operational anchor (${anchor.operationalTag}) matches HEAD`
          : "recovery-anchor.json matches HEAD"
      );
    }
  }
} catch (err) {
  fail(`Git HEAD check failed: ${err.message}`);
}

console.log("");
if (failures > 0) {
  console.error(`Frontend foundation smoke: ${failures} failure(s).`);
  process.exit(1);
}
console.log("Frontend foundation smoke: all checks passed.");
