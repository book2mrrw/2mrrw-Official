import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";
import { encodeAvcRendition } from "../codec-avc.js";

function fakeSpawnProcess({ exitCode = 0, stderrChunks = [] } = {}) {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  queueMicrotask(() => {
    for (const chunk of stderrChunks) proc.stderr.emit("data", Buffer.from(chunk));
    proc.emit("close", exitCode);
  });
  return proc;
}

function avcRendition(overrides = {}) {
  return {
    codecFamily: "avc",
    resolutionLabel: "720p",
    width: 1280,
    height: 720,
    frameRate: 24,
    crf: 22,
    preset: "slow",
    ...overrides,
  };
}

test("rejects a non-AVC rendition rather than silently encoding it wrong", async () => {
  await assert.rejects(
    () => encodeAvcRendition({ sourcePath: "/data/master.mov", outputDir: "/data/out", rendition: { codecFamily: "av1" } }),
    /expected codecFamily "avc", got "av1"/
  );
});

test("builds the confirmed-working fMP4/CMAF HLS ffmpeg invocation", async () => {
  let capturedArgs = null;
  const spawnFn = (bin, args) => {
    capturedArgs = args;
    return fakeSpawnProcess({ exitCode: 0 });
  };
  const result = await encodeAvcRendition({
    sourcePath: "/data/jobs/job-1/1/master.mov",
    outputDir: "/data/jobs/job-1/1/avc-720p",
    rendition: avcRendition(),
    segmentDurationSeconds: 6,
    spawnFn,
  });

  assert.equal(result.playlistPath, path.join("/data/jobs/job-1/1/avc-720p", "playlist.m3u8"));
  assert.ok(capturedArgs.includes("-i"));
  assert.ok(capturedArgs.includes("/data/jobs/job-1/1/master.mov"));
  assert.ok(capturedArgs.includes("scale=1280:720"));
  assert.ok(capturedArgs.includes("libx264"));
  assert.ok(capturedArgs.includes("high"));
  assert.ok(capturedArgs.includes("yuv420p"));
  assert.ok(capturedArgs.includes("fmp4"));
  assert.ok(capturedArgs.includes("independent_segments"));
  assert.ok(capturedArgs.includes("vod"));
});

test("GOP/keyint is aligned to the segment duration in frames, not a hardcoded constant — required for ABR-safe keyframe switching", async () => {
  let capturedArgs = null;
  const spawnFn = (bin, args) => {
    capturedArgs = args;
    return fakeSpawnProcess({ exitCode: 0 });
  };
  await encodeAvcRendition({
    sourcePath: "/data/master.mov",
    outputDir: "/data/out",
    rendition: avcRendition({ frameRate: 30 }),
    segmentDurationSeconds: 4,
    spawnFn,
  });
  const gIndex = capturedArgs.indexOf("-g");
  const keyintIndex = capturedArgs.indexOf("-keyint_min");
  assert.equal(capturedArgs[gIndex + 1], "120"); // 30fps * 4s
  assert.equal(capturedArgs[keyintIndex + 1], "120");
});

test("CRF and preset come from the rendition plan, never hardcoded", async () => {
  let capturedArgs = null;
  const spawnFn = (bin, args) => {
    capturedArgs = args;
    return fakeSpawnProcess({ exitCode: 0 });
  };
  await encodeAvcRendition({
    sourcePath: "/data/master.mov",
    outputDir: "/data/out",
    rendition: avcRendition({ crf: 19, preset: "veryslow" }),
    spawnFn,
  });
  const crfIndex = capturedArgs.indexOf("-crf");
  const presetIndex = capturedArgs.indexOf("-preset");
  assert.equal(capturedArgs[crfIndex + 1], "19");
  assert.equal(capturedArgs[presetIndex + 1], "veryslow");
});

test("a nonzero FFmpeg exit is categorized as FFMPEG_FAILURE with stderr context, never a bare generic error", async () => {
  const spawnFn = () => fakeSpawnProcess({ exitCode: 1, stderrChunks: ["Unknown encoder"] });
  await assert.rejects(
    () => encodeAvcRendition({ sourcePath: "/data/master.mov", outputDir: "/data/out", rendition: avcRendition(), spawnFn }),
    (err) => {
      assert.match(err.message, /Unknown encoder/);
      assert.equal(err.failureCategory, "FFMPEG_FAILURE");
      return true;
    }
  );
});

test("a spawn-level error (binary missing) is also categorized as FFMPEG_FAILURE", async () => {
  const spawnFn = () => {
    const proc = new EventEmitter();
    proc.stderr = new EventEmitter();
    queueMicrotask(() => proc.emit("error", new Error("ENOENT")));
    return proc;
  };
  await assert.rejects(
    () => encodeAvcRendition({ sourcePath: "/data/master.mov", outputDir: "/data/out", rendition: avcRendition(), spawnFn }),
    (err) => {
      assert.equal(err.failureCategory, "FFMPEG_FAILURE");
      return true;
    }
  );
});
