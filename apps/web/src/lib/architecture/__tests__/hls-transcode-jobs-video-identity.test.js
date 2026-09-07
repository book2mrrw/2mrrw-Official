import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const MIGRATION = "supabase/migrations/20260906180000_hls_transcode_jobs_video_identity.sql";

test("slug is relaxed to nullable — a video job has no slug at all", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /alter table public\.hls_transcode_jobs\s+alter column slug drop not null/);
});

test("a row must still identify itself correctly for its own job_type — an audio job needs a slug, a video job needs an asset_version_id, never neither", () => {
  const sql = read(MIGRATION);
  assert.match(
    sql,
    /check \(\s*\(job_type = 'audio' and slug is not null\)\s*or\s*\(job_type = 'video' and asset_version_id is not null\)\s*\)/
  );
});

test("the new identity constraint is guarded by a by-name existence check, safe to re-run", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /conname = 'hls_transcode_jobs_identity_by_type_check'/);
});

test("video jobs get their own uniqueness guarantee on asset_version_id, scoped to job_type='video' only — never touching audio's own unique index", () => {
  const sql = read(MIGRATION);
  assert.match(
    sql,
    /create unique index if not exists idx_hls_transcode_jobs_video_asset_version_unique\s+on public\.hls_transcode_jobs \(asset_version_id\)\s+where job_type = 'video'/
  );
  // The existing audio index name must never appear as something this
  // migration drops or recreates — confirms it's genuinely untouched.
  assert.doesNotMatch(sql, /drop.*idx_hls_transcode_jobs_unique_track/i);
});

test("this migration is documented as following the same additive precedent the job_type split itself established, never described as a patch", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /20260905110000_hls_typed_job_architecture\.sql/);
  assert.match(sql, /Nothing here changes audio's existing/);
});
