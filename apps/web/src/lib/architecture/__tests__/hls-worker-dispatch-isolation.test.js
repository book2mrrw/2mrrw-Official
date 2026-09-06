import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// Slice 2 of the Audio Visual foundation-hardening plan: the Fly.io worker's
// processJob() branches once, explicitly, on job.job_type — a video job can
// never fall through to transcoder.js's audio-only FFmpeg encoder, and an
// audio job's existing behavior is byte-for-byte unchanged by the split.

test("transcoder.js — today's audio encoder — is never imported by the video path", () => {
  const src = read("workers/hls-transcoder/src/video-transcoder.js");
  assert.doesNotMatch(src, /from ["']\.\/transcoder\.js["']/);
});

test("index.js dispatches on job_type to two distinct, named processors", () => {
  const src = read("workers/hls-transcoder/src/index.js");
  assert.match(src, /import \{ processVideoTranscodeJob \}\s+from "\.\/video-transcoder\.js";/);
  const dispatchAt = src.indexOf("async function processJob(job) {");
  assert.ok(dispatchAt > -1);
  const body = src.slice(dispatchAt, dispatchAt + 700);
  assert.match(body, /if \(job\.job_type === "video"\) \{\s*\n\s*await processVideoTranscodeJob\(job\);\s*\n\s*\} else \{\s*\n\s*await processAudioTranscodeJob\(job\);/);
});

test("the audio processor still calls transcoder.js's transcode() and markJobComplete, unchanged", () => {
  const src = read("workers/hls-transcoder/src/index.js");
  const fnAt = src.indexOf("async function processAudioTranscodeJob(job) {");
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 300);
  assert.match(body, /const manifest = await transcode\(\{ job \}\);/);
  assert.match(body, /await markJobComplete\(job, manifest\);/);
});

test("job claim and job failure handling stay shared across both job types (generic db plumbing, not media policy)", () => {
  const src = read("workers/hls-transcoder/src/index.js");
  const dispatchAt = src.indexOf("async function processJob(job) {");
  const nextFnAt = src.indexOf("async function processAudioTranscodeJob");
  const body = src.slice(dispatchAt, nextFnAt);
  assert.match(body, /await markJobFailed\(job\.id, message\)/);
  assert.match(body, /jobType:\s*job\.job_type/, "failure logging must distinguish job type");
});

test("the video processor is a real, isolated file that fails loudly instead of silently pretending to encode", async () => {
  const src = read("workers/hls-transcoder/src/video-transcoder.js");
  assert.match(src, /export async function processVideoTranscodeJob\(job\)/);
  assert.match(src, /throw new Error\(/);

  const mod = await import("../../../../workers/hls-transcoder/src/video-transcoder.js");
  await assert.rejects(() => mod.processVideoTranscodeJob({ id: "test-job-id" }), /VIDEO_TRANSCODE is not implemented yet/);
});
