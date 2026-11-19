import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// Real two-lane Fly.io architecture: audio-worker.js and video-worker.js are
// separate, explicit process entry points (not one shared command branching
// on an env var). Each requests only its own job_type from the atomic claim
// query and dispatches only to its own processor — there is no code path in
// either file that could reach the other lane's media processing.

test("audio-worker.js never imports the video processor or video-transcoder.js", () => {
  const src = read("workers/hls-transcoder/src/workers/audio-worker.js");
  assert.doesNotMatch(src, /video-transcoder/);
  assert.doesNotMatch(src, /processVideoTranscodeJob/);
  assert.match(src, /const JOB_TYPE = "audio";/);
});

test("video-worker.js never imports transcoder.js — today's audio encoder", () => {
  const src = read("workers/hls-transcoder/src/workers/video-worker.js");
  assert.doesNotMatch(src, /from ["']\.\.\/transcoder\.js["']/);
  assert.match(src, /const JOB_TYPE = "video";/);
});

test("each entry point requests its own type and nothing else's, all through the leased lane loop", () => {
  for (const worker of ["audio-worker.js", "video-worker.js", "vault-video-worker.js"]) {
    const src = read(`workers/hls-transcoder/src/workers/${worker}`);
    assert.match(src, /runMediaLane\(\{\s*\n\s*jobType:\s*JOB_TYPE,/, `${worker} claims its own type`);
    assert.doesNotMatch(src, /runWorker|worker-runtime/, `${worker} never uses the unleased loop`);
  }
});

test("transcoder.js — today's audio encoder — is reached only by the audio lane", () => {
  assert.match(read("workers/hls-transcoder/src/workers/audio-worker.js"), /from ["']\.\.\/audio-lane\.js["']/);
  assert.match(read("workers/hls-transcoder/src/audio-lane.js"), /from ["']\.\/transcoder\.js["']/);
});

test("the audio processor encodes with transcoder.js and publishes only through the fenced commit named by its lease", () => {
  const src = read("workers/hls-transcoder/src/audio-lane.js");
  assert.match(src, /const manifest = await transcodeFn\(\{ job, lane \}\);/);
  assert.match(src, /rpc\("hls_commit_transcode_job", \{ \.\.\.lease, p_manifest: manifest \}\)/);
  assert.match(src, /if \(!published\?\.committed\) throw new LeaseLost\(job\.id\);/);
  assert.doesNotMatch(src, /markJobComplete|from ["']\.\/db\.js["']/);
});

test("worker-runtime.js is the shared claim/heartbeat/failure loop and carries zero media-specific policy", () => {
  const src = read("workers/hls-transcoder/src/worker-runtime.js");
  // No FFmpeg process spawning, no rendition constants, no manifest-shape
  // assumptions — if any of these show up here, media policy has leaked
  // into the shared layer instead of staying in each lane's own processor.
  assert.doesNotMatch(src, /spawn\(/);
  assert.doesNotMatch(src, /AUDIO_RENDITIONS|VIDEO_RENDITIONS/);
  assert.doesNotMatch(src, /hls_prefix|segment_duration|\.m3u8/);
  assert.match(src, /export function runWorker\(/);
});

test("runWorker defensively rejects a job whose job_type doesn't match this lane's, as a validation failure — defense in depth beyond the DB-level claim filter", () => {
  const src = read("workers/hls-transcoder/src/worker-runtime.js");
  const guardAt = src.indexOf("if (job.job_type !== jobType) {");
  assert.ok(guardAt > -1);
  const body = src.slice(guardAt, guardAt + 550);
  assert.match(body, /"VALIDATION_FAILURE"/);
  assert.match(body, /return;/);
});

test("the video processor is a real, wired pipeline now (Slice 15) — no longer the earlier stub", async () => {
  const src = read("workers/hls-transcoder/src/video-transcoder.js");
  assert.match(src, /export async function processVideoTranscodeJob\(job, params\)/);
  // Never imports db.js/r2.js directly — both throw at import time without
  // real env vars, which would make this file (and any test of it) unsafe
  // to import. dbClient/downloadStreamFn/uploadFn are required params
  // instead, supplied only by video-worker.js — the same reason
  // publication-authority.js's own header gives for the identical choice.
  assert.doesNotMatch(src, /from ["']\.\/db\.js["']/);
  assert.doesNotMatch(src, /from ["']\.\/r2\.js["']/);

  const mod = await import("../../../../workers/hls-transcoder/src/video-transcoder.js");
  await assert.rejects(
    () => mod.processVideoTranscodeJob({ id: "test-job-id" }, {}),
    /rpc, lease and lane are all required/
  );
});

test("the video lanes hold no key: the database only through their own login, storage and content keys only through the website", () => {
  // Keyless since 2026-11-19: no service-role key (db.js), no storage key
  // (r2.js), no master secret on the hosts of these lanes — the lane login
  // (lane-db.js) and per-lease website links and keys (lane-transfers.js).
  for (const worker of ["audio-worker.js", "video-worker.js", "vault-video-worker.js", "track-visual-worker.js"]) {
    const src = read(`workers/hls-transcoder/src/workers/${worker}`);
    assert.match(src, /from ["']\.\.\/lane-db\.js["']/, `${worker} uses the lane login`);
    assert.match(src, /import \{ laneSession \} from ["']\.\.\/lane-transfers\.js["']/, `${worker} uses the website per lease`);
    assert.doesNotMatch(src, /from ["']\.\.\/(db|r2)\.js["']/, `${worker} imports no keyed client`);
  }
  for (const file of ["transcoder.js", "audio-lane.js", "video-transcoder.js", "vault-video-transcoder.js", "track-visual-transcoder.js"]) {
    const src = read(`workers/hls-transcoder/src/${file}`);
    assert.doesNotMatch(src, /from ["']\.\/(db|r2)\.js["']/, `${file} imports no keyed client`);
    assert.doesNotMatch(src, /process\.env\.(HLS_MASTER_SECRET|TRACK_VISUAL_MASTER_SECRET|SUPABASE_SECRET_KEY|R2_SECRET_ACCESS_KEY)/, `${file} reads no secret`);
  }
  const video = read("workers/hls-transcoder/src/workers/video-worker.js");
  assert.match(video, /processVideoTranscodeJob\(job, \{\s*rpc, lease, lane: laneSession\(\{ lane: JOB_TYPE, job \}\),\s*\}\)/);
});

test("the old shared index.js entry point is gone, not just unreferenced", () => {
  assert.ok(!fs.existsSync(path.join(root, "workers/hls-transcoder/src/index.js")));
});
