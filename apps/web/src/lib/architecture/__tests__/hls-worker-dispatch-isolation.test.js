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

test("both entry points request their own type from runWorker and nothing else's", () => {
  const audioSrc = read("workers/hls-transcoder/src/workers/audio-worker.js");
  const videoSrc = read("workers/hls-transcoder/src/workers/video-worker.js");
  assert.match(audioSrc, /runWorker\(\{\s*\n\s*jobType:\s*JOB_TYPE,/);
  assert.match(videoSrc, /runWorker\(\{\s*\n\s*jobType:\s*JOB_TYPE,/);
});

test("transcoder.js — today's audio encoder — is still imported only by the audio lane", () => {
  const audioSrc = read("workers/hls-transcoder/src/workers/audio-worker.js");
  assert.match(audioSrc, /from ["']\.\.\/transcoder\.js["']/);
});

test("the audio processor still calls transcoder.js's transcode() and markJobComplete, unchanged", () => {
  const src = read("workers/hls-transcoder/src/workers/audio-worker.js");
  const fnAt = src.indexOf("async function processAudioTranscodeJob(job) {");
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 300);
  assert.match(body, /const manifest = await transcode\(\{ job \}\);/);
  assert.match(body, /await markJobComplete\(job, manifest\);/);
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
    /dbClient, downloadStreamFn, and uploadFn are all required/
  );
});

test("video-worker.js is the one real place that imports db.js/r2.js for the video lane, closing over them for video-transcoder.js", () => {
  const src = read("workers/hls-transcoder/src/workers/video-worker.js");
  assert.match(src, /import \{ db \} from ["']\.\.\/db\.js["']/);
  assert.match(src, /import \{ downloadStream, upload \} from ["']\.\.\/r2\.js["']/);
  assert.match(src, /processVideoTranscodeJob\(job, \{ dbClient: db, downloadStreamFn: downloadStream, uploadFn: upload \}\)/);
});

test("the old shared index.js entry point is gone, not just unreferenced", () => {
  assert.ok(!fs.existsSync(path.join(root, "workers/hls-transcoder/src/index.js")));
});
