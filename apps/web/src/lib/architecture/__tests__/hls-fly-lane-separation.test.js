import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// Slice 3 of the Audio Visual foundation-hardening plan: the Fly.io worker
// gains a second, independently-scalable process-group lane for video, so a
// long video encode can never block the audio lane from claiming its next
// job. The existing "app" process group — what the live, currently-serving
// audio machines are already tagged as — is kept unrenamed so this split is
// purely additive and never requires reassigning a production machine.

test("fly.toml defines two process groups, not a single undifferentiated one", () => {
  const toml = read("workers/hls-transcoder/fly.toml");
  assert.match(toml, /\[processes\]/);
  assert.match(toml, /app\s*=\s*"node src\/index\.js"/);
  assert.match(toml, /video\s*=\s*"node src\/index\.js"/);
});

test("the audio lane keeps the 'app' process-group name — the existing live machines are never reassigned", () => {
  const toml = read("workers/hls-transcoder/fly.toml");
  const vmBlocks = toml.split("[[vm]]").slice(1);
  const appVm = vmBlocks.find((b) => /processes\s*=\s*\["app"\]/.test(b));
  assert.ok(appVm, "an [[vm]] block scoped to the app process group must exist");
  assert.match(appVm, /memory\s*=\s*'2gb'/);
  assert.match(appVm, /cpus\s*=\s*2/);
});

test("the video lane is defined with its own vm sizing, separate from the audio lane's", () => {
  const toml = read("workers/hls-transcoder/fly.toml");
  const vmBlocks = toml.split("[[vm]]").slice(1);
  const videoVm = vmBlocks.find((b) => /processes\s*=\s*\["video"\]/.test(b));
  assert.ok(videoVm, "an [[vm]] block scoped to the video process group must exist");
  assert.notEqual(videoVm, undefined);
});

test("index.js resolves its own lane from FLY_PROCESS_GROUP with a safe audio default", () => {
  const src = read("workers/hls-transcoder/src/index.js");
  assert.match(src, /const WORKER_JOB_TYPE =/);
  assert.match(src, /process\.env\.FLY_PROCESS_GROUP === "video" \? "video" : "audio"/);
});

test("worker startup logging reports which lane this machine believes itself to be", () => {
  const src = read("workers/hls-transcoder/src/index.js");
  assert.match(src, /logger\.info\("worker started", \{ workerId: WORKER_ID, jobType: WORKER_JOB_TYPE, idlePollMs: IDLE_POLL_MS \}\);/);
});
