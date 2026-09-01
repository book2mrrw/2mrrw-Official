#!/usr/bin/env node
/**
 * Warn when git diff touches protected foundation paths without explicit SCOPE.
 * Read-only — does not modify files. Optional companion to check:frontend-guardrails.
 *
 * Usage:
 *   node scripts/check-scoped-changes.mjs
 *   SCOPE=vault node scripts/check-scoped-changes.mjs
 */

import { execSync } from "node:child_process";

const SCOPE = (process.env.SCOPE || "").trim().toLowerCase();

const PROTECTED = [
  { id: "page", paths: ["src/app/page.js"], scopes: ["hero", "cinematic", "mobile", "nav", "cart", "checkout", "ui"] },
  { id: "layout", paths: ["src/app/layout.js"], scopes: ["providers", "layout", "ui"] },
  { id: "subscribe", paths: ["src/app/subscribe/page.js"], scopes: ["subscribe"] },
  { id: "vault", paths: ["src/components/vault/VaultUnlockedRoom.jsx"], scopes: ["vault"] },
  { id: "checkout", paths: ["src/components/payments/CheckoutForm.js"], scopes: ["checkout", "cart"] },
  { id: "auth", paths: ["src/context/AuthContext.js"], scopes: ["auth"] },
  { id: "audio", paths: ["src/context/AudioContext.js", "src/components/audio/GlobalAudioPlayerBar.js"], scopes: ["audio", "playback"] },
  { id: "recovery", paths: ["docs/foundation/recovery-anchor.json", "scripts/recovery/"], scopes: ["recovery", "foundation"] },
  { id: "deps", paths: ["package.json", "package-lock.json"], scopes: ["deps", "dependencies", "foundation"] },
];

function changedFiles() {
  try {
    const out = execSync("git diff --name-only HEAD", { encoding: "utf8" });
    const staged = execSync("git diff --name-only --cached", { encoding: "utf8" });
    const untracked = execSync("git ls-files --others --exclude-standard", { encoding: "utf8" });
    return [...new Set([out, staged, untracked].join("\n").split("\n").map((s) => s.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function matchesPath(file, prefix) {
  return file === prefix || file.startsWith(prefix);
}

const files = changedFiles();
if (!files.length) {
  console.log("check-scoped-changes: no local diff vs HEAD.");
  process.exit(0);
}

const warnings = [];

for (const entry of PROTECTED) {
  const hit = files.filter((f) => entry.paths.some((p) => matchesPath(f, p)));
  if (!hit.length) continue;
  const scopeOk = SCOPE && entry.scopes.includes(SCOPE);
  if (!scopeOk) {
    warnings.push({
      entry: entry.id,
      files: hit,
      hint: `Set SCOPE to one of: ${entry.scopes.join(", ")}`,
    });
  }
}

if (!warnings.length) {
  console.log(`check-scoped-changes: OK (${files.length} file(s), scope=${SCOPE || "none"}).`);
  process.exit(0);
}

console.warn("check-scoped-changes: protected paths touched without matching SCOPE:\n");
for (const w of warnings) {
  console.warn(`  [${w.entry}] ${w.files.join(", ")}`);
  console.warn(`    ${w.hint}\n`);
}
console.warn("See PROJECT_GUARDRAILS.md and docs/workflow/SCOPED_PROMPTING_RULES.md");
console.warn("Recovery: npm run recover:foundation -- --dry-run");
process.exit(warnings.length ? 1 : 0);
