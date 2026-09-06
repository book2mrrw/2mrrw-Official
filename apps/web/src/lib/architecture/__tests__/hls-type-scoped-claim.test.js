import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migrationsDir = path.join(root, "supabase/migrations");
const readOnlyMigration = (needle) => {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.includes(needle));
  assert.equal(files.length, 1, `expected exactly one migration matching "${needle}"`);
  return fs.readFileSync(path.join(migrationsDir, files[0]), "utf8");
};

// Type-aware atomic claiming: the wrong worker must never be able to own the
// wrong job. The filter lives INSIDE the atomic claim query itself — a
// worker never claims any pending row and inspects it afterward.

test("the old single-argument claim function is dropped, not left dangling alongside the new one", () => {
  const sql = readOnlyMigration("hls_type_scoped_claim");
  assert.match(sql, /drop function if exists hls_claim_next_job\(text\);/);
});

test("the new claim function requires p_job_type and filters the atomic SELECT by it, not just by status", () => {
  const sql = readOnlyMigration("hls_type_scoped_claim");
  assert.match(sql, /create or replace function hls_claim_next_job\(p_worker_id text, p_job_type text\)/);
  const selectAt = sql.indexOf("select *");
  assert.ok(selectAt > -1);
  const body = sql.slice(selectAt, selectAt + 300);
  assert.match(body, /where status = 'pending'/);
  assert.match(body, /and job_type = p_job_type/);
  assert.match(body, /for update skip locked;/);
});

test("the claim function rejects an invalid job_type before ever touching the table", () => {
  const sql = readOnlyMigration("hls_type_scoped_claim");
  assert.match(sql, /if p_job_type not in \('audio', 'video'\) then/);
  assert.match(sql, /raise exception/);
});

test("a claimed job gets a starting heartbeat_at, giving the video lane's stale check something to compare against immediately", () => {
  const sql = readOnlyMigration("hls_type_scoped_claim");
  const updateAt = sql.indexOf("update hls_transcode_jobs");
  assert.ok(updateAt > -1);
  const body = sql.slice(updateAt, updateAt + 300);
  assert.match(body, /heartbeat_at = now\(\)/);
});

// ── db.js: claimNextJob is type-scoped, touchHeartbeat and categorized failure exist ──

test("claimNextJob requires and forwards a jobType to the RPC as p_job_type", () => {
  const src = read("workers/hls-transcoder/src/db.js");
  assert.match(src, /export async function claimNextJob\(workerId, jobType\)/);
  assert.match(src, /db\.rpc\("hls_claim_next_job", \{ p_worker_id: workerId, p_job_type: jobType \}\)/);
});

test("touchHeartbeat only refreshes a job that is still actually processing", () => {
  const src = read("workers/hls-transcoder/src/db.js");
  const fnAt = src.indexOf("export async function touchHeartbeat(jobId) {");
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 300);
  assert.match(body, /heartbeat_at: new Date\(\)\.toISOString\(\)/);
  assert.match(body, /\.eq\("status", "processing"\)/);
});

test("markJobFailed accepts and persists a failure_category, defaulting to UNKNOWN — never an opaque generic error", () => {
  const src = read("workers/hls-transcoder/src/db.js");
  assert.match(src, /export async function markJobFailed\(jobId, errorMessage, failureCategory = "UNKNOWN"\)/);
  assert.match(src, /failure_category:\s*failureCategory,/);
});

test("markJobFailed also clears heartbeat_at when a job is rescued/reset — no stale heartbeat from a previous attempt survives a retry", () => {
  const src = read("workers/hls-transcoder/src/db.js");
  const fnAt = src.indexOf("export async function markJobFailed(");
  const body = src.slice(fnAt, fnAt + 900);
  assert.match(body, /heartbeat_at:\s*null,/);
});
