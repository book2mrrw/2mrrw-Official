import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Regression for: only 20 of 84+ environment variables the app actually reads
 * were documented in .env.example — the same class of gap that let APP_URL
 * ship unset in production and silently degrade the HLS completion webhook
 * (see the replace-master-audio fix earlier this session). This is the
 * pre-deploy check the readiness audit recommended: fail the build's test
 * suite, not a production incident, when a new SCREAMING_CASE env var
 * reference has no documentation trail.
 *
 * Update EXPECTED_UNDOCUMENTED below only for variables the platform itself
 * provides (Node/Vercel-injected) — never for a real app/worker/script secret.
 */

const WEB_ROOT = process.cwd();
const REPO_ROOT = path.join(WEB_ROOT, "..", "..");

// Platform-injected vars no one configures by hand — never expected in .env.example.
const PLATFORM_PROVIDED = new Set([
  "NODE_ENV", "PATH", "PATHEXT", "TEMP", "TMP", "VERCEL_URL", "NEXT_RUNTIME",
  // Windows-provided (scripts/recovery/certify-stripe-exactly-once.mjs reads
  // these for cross-platform shell handling, not as app configuration).
  "ComSpec", "SystemRoot",
]);

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

function extractEnvVarNames(files) {
  const names = new Set();
  // Any case is a real reference (Vercel KV auto-injects mixed/lower-case
  // names like rate_limits_2mrrw_KV_REST_API_URL) — just require a real
  // identifier boundary at the end.
  const pattern = /process\.env\.([a-zA-Z_][a-zA-Z0-9_]*)(?![a-zA-Z0-9_])/g;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    let match;
    while ((match = pattern.exec(source))) names.add(match[1]);
  }
  return names;
}

test("every SCREAMING_CASE process.env reference in the app, workers, and scripts is documented in .env.example", () => {
  const sourceDirs = [
    path.join(WEB_ROOT, "src"),
    path.join(WEB_ROOT, "workers"),
    path.join(WEB_ROOT, "scripts"),
  ].filter((dir) => fs.existsSync(dir));

  const files = sourceDirs.flatMap((dir) => walk(dir, [".js", ".mjs", ".ts"]));
  const used = extractEnvVarNames(files);

  const envExamplePath = path.join(REPO_ROOT, ".env.example");
  const envExample = fs.readFileSync(envExamplePath, "utf8");
  // Documented if it appears as an assignment (KEY=) anywhere, commented or not —
  // this file uses "# KEY=" for optional/example-only flags (e.g. R2_STREAM_DEBUG).
  const documented = new Set(
    Array.from(envExample.matchAll(/^#?\s*([a-zA-Z_][a-zA-Z0-9_]*)=/gm)).map((m) => m[1])
  );

  const undocumented = Array.from(used)
    .filter((name) => !PLATFORM_PROVIDED.has(name))
    .filter((name) => !documented.has(name))
    .sort();

  assert.deepEqual(
    undocumented,
    [],
    `.env.example is missing: ${undocumented.join(", ")}. Add each one (with a comment ` +
      `saying what it's for and whether it's [APP]/[WORKER]/[SCRIPT]-only) before merging.`
  );
});
