#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = new Map(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf("=");
    return separator === -1
      ? [argument, true]
      : [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);

if (args.has("--help")) {
  console.log(`Usage:
  node scripts/hls-profile-rollout.mjs [options]

Read-only inventory (default):
  --env-dir=<path>             Directory containing .env.local
  --details                    Show failed jobs and manifests without a job
  --verify-job=<uuid>          Re-check a completed cutover without mutating

Bounded profile rollout:
  --enqueue=<1-25>             Number of profile upgrades to enqueue
  --target-profile=<version>   Target profile version (default: 3)
  --confirm-host=<hostname>    Must exactly match the Supabase URL hostname
  --watch-seconds=<0-3600>     Watch enqueued jobs (default: 900)
  --poll-seconds=<2-30>        Watch interval (default: 5)
`);
  process.exit(0);
}

function parseInteger(name, fallback, minimum, maximum) {
  const raw = args.get(name);
  const value = raw == null ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function unwrapEnvValue(raw) {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function loadEnvFile(directory) {
  const envPath = resolve(directory, ".env.local");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!process.env[key]) process.env[key] = unwrapEnvValue(rawValue);
  }
}

const envDirectory = resolve(String(args.get("--env-dir") || process.cwd()));
loadEnvFile(envDirectory);

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.E2E_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing production Supabase URL or service-role configuration");
}

const hostname = new URL(supabaseUrl).hostname;
const enqueueLimit = parseInteger("--enqueue", 0, 0, 25);
const targetProfile = parseInteger("--target-profile", 3, 1, 100);
const watchSeconds = parseInteger("--watch-seconds", enqueueLimit > 0 ? 900 : 0, 0, 3600);
const pollSeconds = parseInteger("--poll-seconds", 5, 2, 30);

if (enqueueLimit > 0 && args.get("--confirm-host") !== hostname) {
  throw new Error(
    `Mutation refused. Re-run with --confirm-host=${hostname} after verifying the inventory.`,
  );
}

const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function assertResult(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result;
}

function tally(rows, keyFor) {
  const counts = {};
  for (const row of rows || []) {
    const key = keyFor(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function inventory() {
  const [manifests, outdated, jobs, retired, products] = await Promise.all([
    db.from("hls_manifests").select("slug,track_slug,transcode_profile_version", { count: "exact" }),
    db
      .from("hls_manifests")
      .select("id", { count: "exact", head: true })
      .lt("transcode_profile_version", targetProfile),
    db
      .from("hls_transcode_jobs")
      .select("id,slug,track_slug,status,target_profile_version,generation,error_message"),
    db.from("hls_retired_prefixes").select("status", { count: "exact" }),
    db.from("products").select("slug,active"),
  ]);

  assertResult(manifests, "manifest inventory");
  assertResult(outdated, "profile inventory");
  assertResult(jobs, "job inventory");
  assertResult(retired, "retired-prefix inventory");
  assertResult(products, "product inventory");

  const activeSlugs = new Set(
    (products.data || []).filter((row) => row.active).map((row) => row.slug),
  );
  const jobIdentities = new Set(
    (jobs.data || []).map((row) => `${row.slug}\u0000${row.track_slug || ""}`),
  );
  const detail = args.has("--details")
    ? {
        failedJobs: (jobs.data || [])
          .filter((row) => row.status === "failed")
          .map(({ id, slug, track_slug: trackSlug, generation, error_message: error }) => ({
            id,
            slug,
            trackSlug,
            generation,
            error,
          })),
        manifestsWithoutJobs: (manifests.data || [])
          .filter((row) => !jobIdentities.has(`${row.slug}\u0000${row.track_slug || ""}`))
          .map(({ slug, track_slug: trackSlug, transcode_profile_version: profile }) => ({
            slug,
            trackSlug,
            profile,
          })),
        inactiveManifestsNeedingUpgrade: (manifests.data || [])
          .filter(
            (row) =>
              row.transcode_profile_version < targetProfile && !activeSlugs.has(row.slug),
          )
          .map(({ slug, track_slug: trackSlug, transcode_profile_version: profile }) => ({
            slug,
            trackSlug,
            profile,
          })),
      }
    : {};

  return {
    host: hostname,
    targetProfile,
    manifests: manifests.count || 0,
    needsUpgrade: outdated.count || 0,
    activeNeedsUpgrade: (manifests.data || []).filter(
      (row) => row.transcode_profile_version < targetProfile && activeSlugs.has(row.slug),
    ).length,
    jobs: tally(jobs.data, (row) => `${row.status}/p${row.target_profile_version}`),
    retiredPrefixes: {
      total: retired.count || 0,
      byStatus: tally(retired.data, (row) => row.status),
    },
    ...detail,
  };
}

async function enqueue() {
  const result = assertResult(
    await db.rpc("hls_enqueue_profile_upgrades", {
      p_limit: enqueueLimit,
      p_queued_by: "system:playback-quality-rollout",
      p_target_profile_version: targetProfile,
    }),
    "profile enqueue",
  );

  return (result.data || []).map((job) => ({
    id: job.id,
    slug: job.slug,
    trackSlug: job.track_slug,
    generation: job.generation,
    status: job.status,
    profile: job.target_profile_version,
    prefix: job.hls_prefix,
  }));
}

async function watch(jobIds) {
  if (!jobIds.length || watchSeconds === 0) return [];
  const deadline = Date.now() + watchSeconds * 1_000;

  while (true) {
    const result = assertResult(
      await db
        .from("hls_transcode_jobs")
        .select("id,slug,track_slug,status,generation,target_profile_version,error_message,completed_at")
        .in("id", jobIds)
        .order("slug"),
      "job watch",
    );
    const states = result.data || [];
    console.log(JSON.stringify({ observedAt: new Date().toISOString(), states }, null, 2));

    if (states.length === jobIds.length && states.every((job) => ["complete", "failed"].includes(job.status))) {
      return states;
    }
    if (Date.now() >= deadline) return states;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollSeconds * 1_000));
  }
}

async function verifyCutovers(enqueued, terminalStates) {
  const completedIds = new Set(
    terminalStates.filter((job) => job.status === "complete").map((job) => job.id),
  );
  if (!completedIds.size) return [];

  const [manifestResult, retiredResult] = await Promise.all([
    db
      .from("hls_manifests")
      .select("slug,track_slug,hls_prefix,active_generation,transcode_profile_version,activated_at"),
    db
      .from("hls_retired_prefixes")
      .select("slug,track_slug,hls_prefix,generation,status,delete_after"),
  ]);
  assertResult(manifestResult, "cutover manifest verification");
  assertResult(retiredResult, "retired-prefix verification");

  return enqueued
    .filter((job) => completedIds.has(job.id))
    .map((job) => {
      const manifest = (manifestResult.data || []).find(
        (row) => row.slug === job.slug && (row.track_slug || "") === (job.trackSlug || ""),
      );
      const retired = (retiredResult.data || []).filter(
        (row) => row.slug === job.slug && (row.track_slug || "") === (job.trackSlug || ""),
      );
      const manifestMatches = Boolean(
        manifest &&
          manifest.hls_prefix === job.prefix &&
          manifest.active_generation === job.generation &&
          manifest.transcode_profile_version >= targetProfile &&
          manifest.activated_at,
      );
      const activePrefixNotRetired = !retired.some((row) => row.hls_prefix === job.prefix);
      const activatedAt = Date.parse(manifest?.activated_at || "");
      const oldPrefixProtected = retired.some(
        (row) =>
          row.hls_prefix !== job.prefix &&
          row.status === "pending" &&
          Number.isFinite(activatedAt) &&
          Date.parse(row.delete_after) - activatedAt >= 47 * 60 * 60 * 1_000,
      );
      return {
        jobId: job.id,
        slug: job.slug,
        trackSlug: job.trackSlug,
        manifestMatches,
        activePrefixNotRetired,
        oldPrefixProtected,
        retiredPrefixCount: retired.length,
        passed: manifestMatches && activePrefixNotRetired && oldPrefixProtected,
      };
    });
}

console.log(JSON.stringify({ phase: "before", ...(await inventory()) }, null, 2));

if (args.has("--verify-job")) {
  const jobId = String(args.get("--verify-job"));
  const result = assertResult(
    await db
      .from("hls_transcode_jobs")
      .select("id,slug,track_slug,hls_prefix,generation,target_profile_version,status")
      .eq("id", jobId)
      .maybeSingle(),
    "cutover job lookup",
  );
  if (!result.data) throw new Error(`HLS job not found: ${jobId}`);
  const job = {
    id: result.data.id,
    slug: result.data.slug,
    trackSlug: result.data.track_slug,
    prefix: result.data.hls_prefix,
    generation: result.data.generation,
  };
  const cutovers = await verifyCutovers([job], [result.data]);
  console.log(JSON.stringify({ phase: "cutover-verification", cutovers }, null, 2));
  if (cutovers.length !== 1 || !cutovers[0].passed) process.exitCode = 1;
}

if (enqueueLimit > 0) {
  const enqueued = await enqueue();
  console.log(JSON.stringify({ phase: "enqueued", count: enqueued.length, jobs: enqueued }, null, 2));
  const terminalStates = await watch(enqueued.map((job) => job.id));
  const cutovers = await verifyCutovers(enqueued, terminalStates);
  console.log(JSON.stringify({ phase: "cutover-verification", cutovers }, null, 2));
  console.log(JSON.stringify({ phase: "after", ...(await inventory()) }, null, 2));
  const watchIncomplete =
    watchSeconds > 0 &&
    (terminalStates.length !== enqueued.length ||
      terminalStates.some((job) => !["complete", "failed"].includes(job.status)));
  if (
    watchIncomplete ||
    terminalStates.some((job) => job.status === "failed") ||
    cutovers.some((cutover) => !cutover.passed)
  ) {
    process.exitCode = 1;
  }
}
