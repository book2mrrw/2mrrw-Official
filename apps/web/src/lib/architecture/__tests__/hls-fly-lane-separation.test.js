import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// Correction after a real deploy attempt: Fly.io does not treat a newly
// declared process group as a dormant placeholder — it tries to provision
// (and bill for) a real machine for it immediately. Declaring a "video"
// process group here before real VIDEO_TRANSCODE work exists to benchmark
// would provision paid, idle compute for no reason. So fly.toml stays
// single-process until that work is ready — only the harmless, inert
// code-level lane resolution in index.js ships ahead of time.

test("fly.toml does not declare a second process group yet — no idle video machine gets provisioned", () => {
  const toml = read("workers/hls-transcoder/fly.toml");
  assert.doesNotMatch(toml, /\[processes\]/, "a [processes] table would make Fly try to provision a machine for every group in it");
  assert.doesNotMatch(toml, /\bvideo\s*=/);
});

test("the single vm block is unchanged from the known-good production config", () => {
  const toml = read("workers/hls-transcoder/fly.toml");
  const vmBlocks = toml.split("[[vm]]").slice(1);
  assert.equal(vmBlocks.length, 1, "exactly one [[vm]] block — no per-process-group split yet");
  assert.match(vmBlocks[0], /memory\s*=\s*'2gb'/);
  assert.match(vmBlocks[0], /cpu_kind\s*=\s*'shared'/);
  assert.match(vmBlocks[0], /cpus\s*=\s*2/);
});

test("index.js still resolves its own lane defensively from FLY_PROCESS_GROUP, defaulting to audio — harmless ahead of any second lane existing", () => {
  const src = read("workers/hls-transcoder/src/index.js");
  assert.match(src, /const WORKER_JOB_TYPE =/);
  assert.match(src, /process\.env\.FLY_PROCESS_GROUP === "video" \? "video" : "audio"/);
});

test("worker startup logging reports which lane this machine believes itself to be", () => {
  const src = read("workers/hls-transcoder/src/index.js");
  assert.match(src, /logger\.info\("worker started", \{ workerId: WORKER_ID, jobType: WORKER_JOB_TYPE, idlePollMs: IDLE_POLL_MS \}\);/);
});
