import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// The video machine's default ephemeral root disk (~7.8gb, confirmed via
// `df -h /` on the live machine) cannot hold a realistic 4K/HDR master plus
// simultaneous AVC+AV1 rendition candidates plus VMAF/CAMBI reference
// decoding plus CMAF packaging output. A dedicated scratch volume is
// mounted for the video lane only — the audio lane needs no change and
// never touches it. The volume is workspace, not canonical storage:
// masters/HLS/CMAF/Peek/posters/thumbnails all still live in R2.

test("the scratch volume is mounted for the video process group only — audio is untouched", () => {
  const toml = read("workers/hls-transcoder/fly.toml");
  assert.match(toml, /\[mounts\]/);
  assert.match(toml, /source\s*=\s*"video_scratch"/);
  assert.match(toml, /destination\s*=\s*"\/data"/);
  assert.match(toml, /processes\s*=\s*\["video"\]/);
});

test("the mount config does not appear anywhere scoped to the app (audio) process group", () => {
  const toml = read("workers/hls-transcoder/fly.toml");
  // The only processes=["app"] block in the file must be the existing vm
  // sizing block, not a mount — i.e. there is exactly one processes=["app"] match.
  const appScoped = toml.match(/processes\s*=\s*\["app"\]/g) || [];
  assert.equal(appScoped.length, 1, "app must not gain a second processes=[\"app\"] block for a mount");
});

test("a fresh, root-owned volume mount is handled at the application layer, not assumed pre-owned by the worker user", () => {
  const src = read("workers/hls-transcoder/src/drop-privileges.js");
  assert.match(src, /export function dropPrivilegesIfRoot\(chownPaths = \[\]\)/);
  assert.match(src, /process\.getuid\(\) !== 0/);
  assert.match(src, /fs\.chownSync\(path, WORKER_UID, WORKER_GID\)/);
  assert.match(src, /process\.setgid\("worker"\)/);
  assert.match(src, /process\.setuid\("worker"\)/);
});

test("setgid happens before setuid — dropping uid first would forfeit permission to change gid", () => {
  const src = read("workers/hls-transcoder/src/drop-privileges.js");
  const setgidAt = src.indexOf('process.setgid("worker")');
  const setuidAt = src.indexOf('process.setuid("worker")');
  assert.ok(setgidAt > -1 && setuidAt > -1 && setgidAt < setuidAt);
});

test("the video worker chowns and drops into /data; the audio worker drops privileges without touching it", () => {
  const audioSrc = read("workers/hls-transcoder/src/workers/audio-worker.js");
  const videoSrc = read("workers/hls-transcoder/src/workers/video-worker.js");
  assert.match(audioSrc, /dropPrivilegesIfRoot\(\);/);
  assert.match(videoSrc, /dropPrivilegesIfRoot\(\["\/data"\]\);/);
});

test("the Dockerfile no longer drops privileges itself — that now happens in application code so /data can be chowned first", () => {
  const dockerfile = read("workers/hls-transcoder/Dockerfile");
  assert.doesNotMatch(dockerfile, /^USER worker/m);
  // The worker user must still exist for setuid/setgid to resolve it by name.
  assert.match(dockerfile, /useradd -r -u 1001 worker/);
});
