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

// Slice 1 of the Audio Visual foundation-hardening plan: hls_transcode_jobs
// gains an explicit job_type instead of inferring media type from whatever
// strings happen to be in the bitrates array. This closes the root-cause bug
// where a video-shaped rendition string ("720k") could reach the audio-only
// FFmpeg encoder because nothing rejected it explicitly.

// ── schema: explicit, validated job_type + video-job support columns ────────

test("hls_transcode_jobs gains job_type, backfilling every existing row to 'audio' — which is exactly what they are", () => {
  const sql = readOnlyMigration("hls_typed_job_architecture");
  assert.match(sql, /add column if not exists job_type text not null default 'audio'\s*\n\s*check \(job_type in \('audio', 'video'\)\),/);
});

test("hls_transcode_jobs gains asset_version_id, heartbeat_at, and a constrained failure_category", () => {
  const sql = readOnlyMigration("hls_typed_job_architecture");
  assert.match(sql, /add column if not exists asset_version_id uuid,/);
  assert.match(sql, /add column if not exists heartbeat_at timestamptz,/);
  assert.match(sql, /add column if not exists failure_category text/);
  assert.match(sql, /'VALIDATION_FAILURE', 'INPUT_NOT_FOUND', 'PROBE_FAILURE', 'FFMPEG_FAILURE',/);
  assert.match(sql, /'LEASE_LOST', 'CANCELED', 'UNKNOWN'/);
});

test("the migration only adds columns/indexes — never touches an existing column", () => {
  const sql = readOnlyMigration("hls_typed_job_architecture");
  assert.doesNotMatch(sql, /drop column/i);
  assert.doesNotMatch(sql, /alter column/i);
});

// ── two fully separate, non-overlapping rendition domains ───────────────────

test("audio-renditions.js and video-renditions.js export disjoint, non-empty rendition lists", async () => {
  const audioMod = await import("../../hls/audio-renditions.js");
  const videoMod = await import("../../hls/video-renditions.js");
  assert.ok(audioMod.AUDIO_RENDITIONS.length > 0);
  assert.ok(videoMod.VIDEO_RENDITIONS.length > 0);
  const overlap = audioMod.AUDIO_RENDITIONS.filter((r) => videoMod.VIDEO_RENDITIONS.includes(r));
  assert.deepEqual(overlap, [], "audio and video rendition domains must never overlap");
});

test("no video-shaped rendition value (e.g. a resolution string) appears in AUDIO_RENDITIONS", async () => {
  const { AUDIO_RENDITIONS } = await import("../../hls/audio-renditions.js");
  for (const value of AUDIO_RENDITIONS) {
    assert.match(value, /^\d+k$/, `${value} must be a bitrate string, not a resolution`);
  }
});

test("no audio-shaped rendition value (e.g. a bitrate string) appears in VIDEO_RENDITIONS", async () => {
  const { VIDEO_RENDITIONS } = await import("../../hls/video-renditions.js");
  for (const value of VIDEO_RENDITIONS) {
    assert.match(value, /^\d+p$/, `${value} must be a resolution string, not a bitrate`);
  }
});

// ── /api/admin/hls/queue: explicit job_type, validated renditions ───────────

test("the queue route imports the two separate rendition constants instead of one merged list", () => {
  const src = read("src/app/api/admin/hls/queue/route.js");
  assert.match(src, /import \{ AUDIO_RENDITIONS \} from "@\/lib\/hls\/audio-renditions";/);
  assert.match(src, /import \{ VIDEO_RENDITIONS \} from "@\/lib\/hls\/video-renditions";/);
  assert.doesNotMatch(src, /VALID_BITRATES/, "the old merged audio+video bitrate list must be gone entirely");
});

test("job_type defaults to 'audio' (today's only real usage) and is validated against a fixed set", () => {
  const src = read("src/app/api/admin/hls/queue/route.js");
  assert.match(src, /const VALID_JOB_TYPES = new Set\(\["audio", "video"\]\);/);
  assert.match(src, /const jobType = VALID_JOB_TYPES\.has\(t\.jobType\) \? t\.jobType : "audio";/);
});

test("an explicit bitrates array is rejected (not silently filtered) when it contains a value outside the resolved job_type's domain", () => {
  const src = read("src/app/api/admin/hls/queue/route.js");
  const fnAt = src.indexOf("let bitrates;");
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 500);
  assert.match(body, /const invalid = t\.bitrates\.filter\(\(b\) => !validRenditions\.includes\(b\)\);/);
  assert.match(body, /if \(invalid\.length\) \{/);
  assert.match(body, /errors\.push\(/);
  assert.match(body, /continue;/);
});

test("an omitted bitrates array defaults to the resolved job_type's own rendition list, never a merged default", () => {
  const src = read("src/app/api/admin/hls/queue/route.js");
  assert.match(src, /bitrates = validRenditions;/);
});

test("job_type is persisted on both the insert path and the re-queue update path", () => {
  const src = read("src/app/api/admin/hls/queue/route.js");
  const matches = src.match(/job_type:\s+jobType,/g) || [];
  assert.equal(matches.length, 2, "job_type must be written on both insert and update");
});

test("the single-track request body shape also forwards jobType/bitrates, not just the batch shape", () => {
  const src = read("src/app/api/admin/hls/queue/route.js");
  const normalizeAt = src.indexOf("const tracks = Array.isArray(body.tracks)");
  assert.ok(normalizeAt > -1);
  const body = src.slice(normalizeAt, normalizeAt + 400);
  assert.match(body, /jobType:\s*body\.jobType,\s*bitrates:\s*body\.bitrates/);
});
