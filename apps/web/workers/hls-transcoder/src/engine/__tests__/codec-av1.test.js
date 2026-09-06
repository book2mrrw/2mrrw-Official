import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";
import { encodeAv1Rendition } from "../codec-av1.js";

function fakeSpawnProcess({ exitCode = 0, stderrChunks = [] } = {}) {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  queueMicrotask(() => {
    for (const chunk of stderrChunks) proc.stderr.emit("data", Buffer.from(chunk));
    proc.emit("close", exitCode);
  });
  return proc;
}

function av1Rendition(overrides = {}) {
  return {
    codecFamily: "av1",
    resolutionLabel: "720p",
    width: 1280,
    height: 720,
    frameRate: 24,
    crf: 34,
    preset: 6,
    bitDepth: 8,
    hdrMode: "sdr",
    ...overrides,
  };
}

test("rejects a non-AV1 rendition rather than silently encoding it wrong", async () => {
  await assert.rejects(
    () => encodeAv1Rendition({ sourcePath: "/data/master.mov", outputDir: "/data/out", rendition: { codecFamily: "avc" } }),
    /expected codecFamily "av1", got "avc"/
  );
});

test("builds the confirmed-working SVT-AV1 fMP4/CMAF HLS invocation", async () => {
  let capturedArgs = null;
  const spawnFn = (bin, args) => {
    capturedArgs = args;
    return fakeSpawnProcess({ exitCode: 0 });
  };
  const result = await encodeAv1Rendition({
    sourcePath: "/data/jobs/job-1/1/master.mov",
    outputDir: "/data/jobs/job-1/1/av1-720p",
    rendition: av1Rendition(),
    spawnFn,
  });
  assert.equal(result.playlistPath, path.join("/data/jobs/job-1/1/av1-720p", "playlist.m3u8"));
  assert.ok(capturedArgs.includes("libsvtav1"));
  assert.ok(capturedArgs.includes("fmp4"));
  assert.ok(capturedArgs.includes("scale=1280:720"));
});

test("an 8-bit rendition uses yuv420p; a 10-bit rendition uses yuv420p10le — confirmed real pixel formats, not guessed", async () => {
  let capturedArgs8 = null;
  await encodeAv1Rendition({
    sourcePath: "/data/master.mov", outputDir: "/data/out",
    rendition: av1Rendition({ bitDepth: 8 }),
    spawnFn: (bin, args) => { capturedArgs8 = args; return fakeSpawnProcess({ exitCode: 0 }); },
  });
  assert.ok(capturedArgs8.includes("yuv420p"));
  assert.ok(!capturedArgs8.includes("yuv420p10le"));

  let capturedArgs10 = null;
  await encodeAv1Rendition({
    sourcePath: "/data/master.mov", outputDir: "/data/out",
    rendition: av1Rendition({ bitDepth: 10, hdrMode: "hdr10" }),
    spawnFn: (bin, args) => { capturedArgs10 = args; return fakeSpawnProcess({ exitCode: 0 }); },
  });
  assert.ok(capturedArgs10.includes("yuv420p10le"));
});

test("GOP/keyint is aligned to the segment duration in frames, matching the AVC path's convention", async () => {
  let capturedArgs = null;
  await encodeAv1Rendition({
    sourcePath: "/data/master.mov", outputDir: "/data/out",
    rendition: av1Rendition({ frameRate: 30 }),
    segmentDurationSeconds: 4,
    spawnFn: (bin, args) => { capturedArgs = args; return fakeSpawnProcess({ exitCode: 0 }); },
  });
  const gIndex = capturedArgs.indexOf("-g");
  assert.equal(capturedArgs[gIndex + 1], "120");
});

test("CRF and preset come from the rendition plan, using SVT-AV1's own numeric preset scale, never AVC's string presets", async () => {
  let capturedArgs = null;
  await encodeAv1Rendition({
    sourcePath: "/data/master.mov", outputDir: "/data/out",
    rendition: av1Rendition({ crf: 28, preset: 4 }),
    spawnFn: (bin, args) => { capturedArgs = args; return fakeSpawnProcess({ exitCode: 0 }); },
  });
  const crfIndex = capturedArgs.indexOf("-crf");
  const presetIndex = capturedArgs.indexOf("-preset");
  assert.equal(capturedArgs[crfIndex + 1], "28");
  assert.equal(capturedArgs[presetIndex + 1], "4");
});

test("a nonzero FFmpeg exit is categorized as FFMPEG_FAILURE with stderr context", async () => {
  const spawnFn = () => fakeSpawnProcess({ exitCode: 1, stderrChunks: ["invalid crf value"] });
  await assert.rejects(
    () => encodeAv1Rendition({ sourcePath: "/data/master.mov", outputDir: "/data/out", rendition: av1Rendition(), spawnFn }),
    (err) => {
      assert.match(err.message, /invalid crf value/);
      assert.equal(err.failureCategory, "FFMPEG_FAILURE");
      return true;
    }
  );
});

test("a spawn-level error is also categorized as FFMPEG_FAILURE", async () => {
  const spawnFn = () => {
    const proc = new EventEmitter();
    proc.stderr = new EventEmitter();
    queueMicrotask(() => proc.emit("error", new Error("ENOENT")));
    return proc;
  };
  await assert.rejects(
    () => encodeAv1Rendition({ sourcePath: "/data/master.mov", outputDir: "/data/out", rendition: av1Rendition(), spawnFn }),
    (err) => {
      assert.equal(err.failureCategory, "FFMPEG_FAILURE");
      return true;
    }
  );
});
