import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
// PGlite is a pinned devDependency; PGLITE_MODULE can point at another build.
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const migration = await fs.readFile(new URL("../../supabase/migrations/20261119153000_revoke_public_definer_exposure.sql", import.meta.url), "utf8");

// The exposed functions' production signatures (pg_get_function_identity_arguments,
// 2026-11-19), as SECURITY DEFINER stand-ins with PostgreSQL's default PUBLIC execute.
const EXPOSED = [
  "get_attribution_breakdown(since timestamp with time zone)",
  "get_cohort_retention(months_back integer)",
  "get_funnel_stats(since timestamp with time zone)",
  "get_listening_time_patterns(since timestamp with time zone)",
  "get_play_stats(since timestamp with time zone)",
  "get_regional_listening_patterns(since timestamp with time zone)",
  "get_release_revenue_stats(since timestamp with time zone)",
  "get_subscription_stats()",
  "get_track_play_stats(since timestamp with time zone)",
  "increment_rate_limit(p_key text, p_route_key text, p_id_hash text, p_window_start timestamp with time zone, p_expires_at timestamp with time zone, p_limit integer)",
  "hls_claim_next_job(p_worker_id text, p_job_type text)",
];
const KEPT_PUBLIC = "get_public_catalog(p_limit integer)";

async function fresh() {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE cover_art_worker NOINHERIT;");
  for (const signature of [...EXPOSED, KEPT_PUBLIC]) {
    await db.exec(`CREATE FUNCTION public.${signature} RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'select 1';`);
  }
  // has_function_privilege takes argument types only, without parameter names.
  const typesOnly = (signature) => signature.replace(/\((.*)\)/, (_, args) =>
    `(${args.split(",").map((arg) => arg.trim().split(" ").slice(1).join(" ")).filter(Boolean).join(", ")})`);
  const can = async (role, signature) =>
    (await db.query(`select has_function_privilege('${role}', 'public.${typesOnly(signature)}', 'execute') as ok`)).rows[0].ok;
  return { db, can };
}

test("before: every exposed function is callable by anyone, including the lanes' own logins", async () => {
  const { can } = await fresh();
  for (const fn of EXPOSED) {
    assert.equal(await can("anon", fn), true, fn);
    assert.equal(await can("cover_art_worker", fn), true, fn);
  }
});

test("after: only the service role can call them; other functions keep their grants", async () => {
  const { db, can } = await fresh();
  await db.exec(migration);
  for (const fn of EXPOSED) {
    for (const role of ["anon", "authenticated", "cover_art_worker"]) assert.equal(await can(role, fn), false, `${role}: ${fn}`);
    assert.equal(await can("service_role", fn), true, `service_role: ${fn}`);
  }
  assert.equal(await can("anon", KEPT_PUBLIC), true, "a function not on the list is left as it was");
  await db.exec(migration);
  assert.equal(await can("service_role", EXPOSED[0]), true, "running it again changes nothing");
});
