import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { validateSourceAnalysis, runDecodeSanityCheck } from "../source-quality-control.js";

function goodAnalysis(overrides = {}) {
  return {
    durationSeconds: 120,
    width: 1920,
    height: 1080,
    frameRate: 23.976,
    videoCodec: "h264",
    rotationDegrees: 0,
    audioCodec: "aac",
    audioSampleRate: 48000,
    audioChannels: 2,
    ...overrides,
  };
}

test("a well-formed analysis passes with zero failures", () => {
  const result = validateSourceAnalysis(goodAnalysis());
  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
});

test("zero or missing duration is rejected", () => {
  assert.equal(validateSourceAnalysis(goodAnalysis({ durationSeconds: 0 })).passed, false);
  assert.equal(validateSourceAnalysis(goodAnalysis({ durationSeconds: null })).passed, false);
  const { failures } = validateSourceAnalysis(goodAnalysis({ durationSeconds: -5 }));
  assert.ok(failures.some((f) => f.code === "INVALID_DURATION"));
});

test("missing video dimensions is rejected", () => {
  const { passed, failures } = validateSourceAnalysis(goodAnalysis({ width: null, height: null }));
  assert.equal(passed, false);
  assert.ok(failures.some((f) => f.code === "MISSING_VIDEO_DIMENSIONS"));
});

test("invalid frame rate is rejected", () => {
  const { failures } = validateSourceAnalysis(goodAnalysis({ frameRate: 0 }));
  assert.ok(failures.some((f) => f.code === "INVALID_FRAME_RATE"));
});

test("missing video codec is rejected", () => {
  const { failures } = validateSourceAnalysis(goodAnalysis({ videoCodec: null }));
  assert.ok(failures.some((f) => f.code === "MISSING_VIDEO_CODEC"));
});

test("a standard rotation value (0/90/180/270, either sign) is accepted", () => {
  for (const rotation of [0, 90, 180, 270, -90, -180, -270]) {
    assert.equal(validateSourceAnalysis(goodAnalysis({ rotationDegrees: rotation })).passed, true);
  }
});

test("a nonstandard rotation value is flagged, not silently accepted", () => {
  const { failures } = validateSourceAnalysis(goodAnalysis({ rotationDegrees: 45 }));
  assert.ok(failures.some((f) => f.code === "INVALID_ROTATION_METADATA"));
});

test("a video-only source (no audio at all) is legitimate and passes", () => {
  const result = validateSourceAnalysis(goodAnalysis({ audioCodec: null, audioSampleRate: null, audioChannels: null }));
  assert.equal(result.passed, true);
});

test("audio present but missing sample rate or channel count is rejected — a genuinely malformed stream, not a video-only asset", () => {
  const { failures } = validateSourceAnalysis(goodAnalysis({ audioSampleRate: null }));
  assert.ok(failures.some((f) => f.code === "MALFORMED_AUDIO_STREAM"));
});

test("multiple simultaneous problems are all reported together, not just the first one found", () => {
  const { failures } = validateSourceAnalysis(goodAnalysis({ durationSeconds: 0, videoCodec: null, width: null, height: null }));
  const codes = failures.map((f) => f.code);
  assert.ok(codes.includes("INVALID_DURATION"));
  assert.ok(codes.includes("MISSING_VIDEO_CODEC"));
  assert.ok(codes.includes("MISSING_VIDEO_DIMENSIONS"));
});

// ── runDecodeSanityCheck — injected spawn, no real FFmpeg needed ────────────

function fakeSpawnProcess({ exitCode = 0, stderrChunks = [] } = {}) {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  // Simulate the async nature of a real child process without a real timer delay.
  queueMicrotask(() => {
    for (const chunk of stderrChunks) proc.stderr.emit("data", Buffer.from(chunk));
    proc.emit("close", exitCode);
  });
  return proc;
}

test("a clean decode (exit 0, no stderr) passes", async () => {
  const spawnFn = () => fakeSpawnProcess({ exitCode: 0 });
  const result = await runDecodeSanityCheck("/data/jobs/job-1/1/master.mov", { spawnFn });
  assert.equal(result.passed, true);
  assert.equal(result.exitCode, 0);
});

test("a nonzero exit code fails the sanity check even with no stderr", async () => {
  const spawnFn = () => fakeSpawnProcess({ exitCode: 1 });
  const result = await runDecodeSanityCheck("/data/jobs/job-1/1/master.mov", { spawnFn });
  assert.equal(result.passed, false);
  assert.equal(result.exitCode, 1);
});

test("any stderr output fails the check even with exit code 0 — FFmpeg can warn without a nonzero exit", async () => {
  const spawnFn = () => fakeSpawnProcess({ exitCode: 0, stderrChunks: ["Invalid NAL unit size", "\n"] });
  const result = await runDecodeSanityCheck("/data/jobs/job-1/1/master.mov", { spawnFn });
  assert.equal(result.passed, false);
  assert.match(result.stderrOutput, /Invalid NAL unit size/);
});

test("a spawn-level error (binary not found) resolves as a failure, never throws/rejects", async () => {
  const spawnFn = () => {
    const proc = new EventEmitter();
    proc.stderr = new EventEmitter();
    queueMicrotask(() => proc.emit("error", new Error("ENOENT: ffmpeg not found")));
    return proc;
  };
  const result = await runDecodeSanityCheck("/data/jobs/job-1/1/master.mov", { spawnFn });
  assert.equal(result.passed, false);
  assert.match(result.stderrOutput, /ENOENT/);
});

test("the probe duration is passed through to FFmpeg's -t flag", async () => {
  let capturedArgs = null;
  const spawnFn = (bin, args) => {
    capturedArgs = args;
    return fakeSpawnProcess({ exitCode: 0 });
  };
  await runDecodeSanityCheck("/data/jobs/job-1/1/master.mov", { probeDurationSeconds: 8, spawnFn });
  const tIndex = capturedArgs.indexOf("-t");
  assert.ok(tIndex > -1);
  assert.equal(capturedArgs[tIndex + 1], "8");
});
