/**
 * The video lanes' database: their own login (hls_media_worker, migration
 * 20261119150000_hls_media_worker_role.sql), which can call the lane
 * functions and nothing else — no table, no service-role key on the host.
 * TLS is verified against Supabase's root certificate, shipped with the lane
 * (certs/). HLS_MEDIA_DATABASE_URL is the host's one secret.
 */

import { readFileSync } from "node:fs";
import pg from "pg";

const SUPABASE_ROOT = new URL("../certs/supabase-root-2021.crt", import.meta.url);
// Functions that return a table row (a composite NULL means "no job").
const ROW_FUNCTIONS = new Set(["hls_claim_media_job"]);

let pool = null;
function connect() {
  if (pool) return pool;
  const raw = process.env.HLS_MEDIA_DATABASE_URL;
  if (!raw) throw new Error("HLS_MEDIA_DATABASE_URL is required");
  const url = new URL(raw);
  // TLS is configured below (verified); connection-string TLS flags would override it.
  for (const param of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(param);
  pool = new pg.Pool({
    connectionString: url.href,
    max: 3,
    idleTimeoutMillis: 30_000,
    ssl: { ca: readFileSync(SUPABASE_ROOT, "utf8"), servername: url.hostname, rejectUnauthorized: true },
  });
  return pool;
}

/**
 * Call a lane function with named arguments ({ p_job_id: ..., ... }); objects
 * are sent as JSON. Returns its result (a row-returning claim: the row or null).
 */
export async function rpc(name, args = {}, { query = (text, values) => connect().query(text, values) } = {}) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`not a lane function: ${name}`);
  const keys = Object.keys(args);
  if (keys.some((key) => !/^p_[a-z0-9_]+$/.test(key))) throw new Error(`bad argument names for ${name}`);
  const named = keys.map((key, i) => `${key} => $${i + 1}`).join(", ");
  const values = keys.map((key) => (args[key] !== null && typeof args[key] === "object" ? JSON.stringify(args[key]) : args[key]));
  if (ROW_FUNCTIONS.has(name)) {
    const { rows } = await query(`select * from public.${name}(${named})`, values);
    return rows[0]?.id ? rows[0] : null;
  }
  const { rows } = await query(`select public.${name}(${named}) as result`, values);
  return rows[0]?.result ?? null;
}

/** Whether a video-lane lease is still held (boot-time scratch sweep). */
export const isLeaseLive = (jobId, claimToken) => rpc("hls_media_lease_live", { p_job_id: jobId, p_claim_token: claimToken });

export async function closeLaneDb() {
  await pool?.end();
  pool = null;
}
