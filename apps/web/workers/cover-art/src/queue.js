/**
 * The cover_art_versions queue (supabase/migrations/20261118190000_cover_art_lane.sql),
 * reached as the lane's own database login (cover_art_worker): it can claim,
 * heartbeat and finish cover-art jobs and nothing else. TLS is verified against
 * Supabase's root certificate, shipped with the lane (certs/).
 */

import { readFileSync } from "node:fs";
import pg from "pg";

const SUPABASE_ROOT = new URL("../certs/supabase-root-2021.crt", import.meta.url);

let pool = null;
function db() {
  if (pool) return pool;
  const raw = process.env.COVER_ART_DATABASE_URL;
  if (!raw) throw new Error("COVER_ART_DATABASE_URL is required");
  const url = new URL(raw);
  // TLS is configured below (verified); connection-string TLS flags would override it.
  for (const param of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(param);
  pool = new pg.Pool({
    connectionString: url.href,
    max: 2,
    idleTimeoutMillis: 30_000,
    ssl: { ca: readFileSync(SUPABASE_ROOT, "utf8"), servername: url.hostname, rejectUnauthorized: true },
  });
  return pool;
}

async function call(sql, params) {
  const { rows } = await db().query(sql, params);
  return rows[0]?.result ?? null;
}

export const claim = (workerId) => call("select public.claim_cover_art_job($1) as result", [workerId]);
export const heartbeat = (job) => call("select public.heartbeat_cover_art_job($1, $2) as result", [job.id, job.lease_token]);
export const complete = (job, renditions) =>
  call("select public.complete_cover_art_job($1, $2, $3::jsonb, null) as result", [job.id, job.lease_token, JSON.stringify(renditions)]);
export const fail = (job, message) =>
  call("select public.complete_cover_art_job($1, $2, null, $3) as result", [job.id, job.lease_token, String(message).slice(0, 500)]);

export async function closeQueue() {
  await pool?.end();
  pool = null;
}
