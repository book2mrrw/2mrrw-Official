import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// The stale-job rescue cron must not use one fixed threshold for both media
// types: audio jobs are short (a fixed wall-clock age on started_at is the
// right signal, unchanged), but a genuinely healthy long video encode must
// never be falsely reclaimed just for taking a while — its staleness signal
// is heartbeat_at going quiet, not total elapsed time.

test("audio staleness is unchanged: keyed on started_at, still job_type-scoped so it can't also catch video rows", () => {
  const src = read("src/app/api/cron/hls-stale-jobs/route.js");
  assert.match(src, /const AUDIO_STALE_THRESHOLD_MINUTES = 15;/);
  const audioQueryAt = src.indexOf('.eq("job_type", "audio")');
  assert.ok(audioQueryAt > -1);
  const body = src.slice(audioQueryAt - 200, audioQueryAt + 100);
  assert.match(body, /\.lt\("started_at", audioStaleAfter\)/);
});

test("video staleness is heartbeat-based, not a fixed total-duration timeout", () => {
  const src = read("src/app/api/cron/hls-stale-jobs/route.js");
  assert.match(src, /const VIDEO_HEARTBEAT_STALE_MINUTES = 3;/);
  const videoQueryAt = src.indexOf('.eq("job_type", "video")');
  assert.ok(videoQueryAt > -1);
  const body = src.slice(videoQueryAt, videoQueryAt + 150);
  assert.match(body, /\.lt\("heartbeat_at", videoStaleAfter\)/);
  assert.doesNotMatch(body, /started_at/, "video staleness must not key off total elapsed time");
});

test("both discovery queries run independently and are merged before the shared rescue/escalate logic runs", () => {
  const src = read("src/app/api/cron/hls-stale-jobs/route.js");
  assert.match(src, /const \[audioResult, videoResult\] = await Promise\.all\(\[/);
  assert.match(src, /const staleJobs = \[\.\.\.\(audioResult\.data \|\| \[\]\), \.\.\.\(videoResult\.data \|\| \[\]\)\];/);
});

test("a rescued job's heartbeat_at is cleared along with started_at — no stale heartbeat survives into the next attempt", () => {
  const src = read("src/app/api/cron/hls-stale-jobs/route.js");
  const rescueAt = src.indexOf("if (toRescue.length) {");
  assert.ok(rescueAt > -1);
  const body = src.slice(rescueAt, rescueAt + 400);
  assert.match(body, /heartbeat_at:\s*null,/);
});

test("an escalated (max-retries) job is categorized LEASE_LOST, not left as an opaque generic failure", () => {
  const src = read("src/app/api/cron/hls-stale-jobs/route.js");
  const escalateAt = src.indexOf("if (toEscalate.length) {");
  assert.ok(escalateAt > -1);
  const body = src.slice(escalateAt, escalateAt + 400);
  assert.match(body, /failure_category:\s*"LEASE_LOST",/);
});
