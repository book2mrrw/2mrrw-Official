#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
const check = (id, pass, detail) => checks.push({ id, pass: Boolean(pass), detail });
const file = (relative) => path.join(root, relative);

for (const relative of [
  "docs/recovery/F0-DISASTER-RECOVERY-RUNBOOK.md",
  "supabase/verify/F0-ACCOUNT-LIFECYCLE-CERTIFICATION.sql",
  "scripts/recovery/recover-rollback.mjs",
  "scripts/recovery/verify-foundation.mjs",
]) check(`file:${relative}`, existsSync(file(relative)), relative);

const runbook = readFileSync(file("docs/recovery/F0-DISASTER-RECOVERY-RUNBOOK.md"), "utf8");
for (const token of ["RPO", "RTO", "isolated", "PITR", "R2", "Stripe", "AAL2", "Stop conditions"]) {
  check(`runbook:${token}`, runbook.includes(token), `runbook contains ${token}`);
}

const migrationDir = file("supabase/migrations");
const migrationNames = readdirSync(migrationDir);
const lifecycleMigrations = [40, 41, 42, 43, 44, 45, 46, 47, 48].every((suffix) =>
  migrationNames.some((name) => name.startsWith(`202608230000${suffix}_`)));
check("schema:lifecycle-migrations-40-48", lifecycleMigrations, "all lifecycle migrations exist");

for (const name of ["SUPABASE_SECRET_KEY", "CRON_SECRET", "ACCOUNT_EXPORT_KEK_BASE64",
  "ACCOUNT_EXPORT_KEK_VERSION", "ACCOUNT_LIFECYCLE_PSEUDONYM_KEY"]) {
  check(`env:${name}`, Boolean(process.env[name]), process.env[name] ? "present" : "not present in this execution environment");
}

// These cannot truthfully pass from repository inspection. Operators attach drill evidence.
check("drill:supabase-isolated-restore", false, "requires dated isolated restore evidence");
check("drill:r2-restore", false, "requires inventory/checksum restore evidence");
check("drill:stripe-replay", false, "requires duplicate replay evidence");
check("drill:measured-rpo-rto", false, "requires measured incident timeline");

const summary = { schema: "2mrrw.dr-readiness.v1", generatedAt: new Date().toISOString(),
  passed: checks.filter((item) => item.pass).length, failed: checks.filter((item) => !item.pass).length,
  certified: checks.every((item) => item.pass), checks };
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.certified ? 0 : 2;
