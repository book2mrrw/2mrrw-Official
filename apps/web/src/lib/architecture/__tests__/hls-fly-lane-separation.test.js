import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// Real, provisioned two-lane Fly.io architecture: audio and video get
// physically separate machines from day one, each running its own explicit
// worker entry point (not one shared command distinguished only by an env
// var), so a long video encode can never occupy the audio worker's claim
// slot or its CPU/RAM. "app" is kept as the audio lane's process-group name
// unchanged — it's exactly what the already-running production machines
// are tagged as, so this never requires reassigning a live machine.

test("fly.toml declares both lanes with explicit, distinct worker entry points", () => {
  const toml = read("workers/hls-transcoder/fly.toml");
  assert.match(toml, /\[processes\]/);
  assert.match(toml, /app\s*=\s*"node src\/workers\/audio-worker\.js"/);
  assert.match(toml, /video\s*=\s*"node src\/workers\/video-worker\.js"/);
  // The old ambiguous shape (both lanes running the exact same command,
  // distinguished only by an env var at runtime) must be gone.
  assert.doesNotMatch(toml, /app\s*=\s*"node src\/index\.js"/);
});

test("the audio lane keeps the 'app' process-group name and its known-good machine size — the live machines are never reassigned or resized", () => {
  const toml = read("workers/hls-transcoder/fly.toml");
  const vmBlocks = toml.split("[[vm]]").slice(1);
  const appVm = vmBlocks.find((b) => /processes\s*=\s*\["app"\]/.test(b));
  assert.ok(appVm, "an [[vm]] block scoped to the app process group must exist");
  assert.match(appVm, /memory\s*=\s*'2gb'/);
  assert.match(appVm, /cpu_kind\s*=\s*'shared'/);
  assert.match(appVm, /cpus\s*=\s*2/);
});

test("the video lane has its own valid, independent machine size — not the invalid 4gb/performance combination Fly rejected", () => {
  const toml = read("workers/hls-transcoder/fly.toml");
  const vmBlocks = toml.split("[[vm]]").slice(1);
  const videoVm = vmBlocks.find((b) => /processes\s*=\s*\["video"\]/.test(b));
  assert.ok(videoVm, "an [[vm]] block scoped to the video process group must exist");
  assert.match(videoVm, /cpu_kind\s*=\s*'performance'/);
  assert.match(videoVm, /memory\s*=\s*'8gb'/, "performance-tier machines require a minimum of 8gb — 4gb was rejected by Fly");
  assert.match(videoVm, /cpus\s*=\s*4/);
});

test("the Dockerfile's default CMD points at a real entry point, not the deleted index.js", () => {
  const dockerfile = read("workers/hls-transcoder/Dockerfile");
  assert.match(dockerfile, /CMD \["node", "src\/workers\/audio-worker\.js"\]/);
});
