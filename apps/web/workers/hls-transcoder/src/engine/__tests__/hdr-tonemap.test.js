import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";
import { tonemapHdrToSdr } from "../hdr-tonemap.js";

// zscale's HDR->SDR chain was confirmed blocked on the previous FFmpeg image
// (see hdr-tonemap.js's header for the full history) — this now goes through
// libplacebo instead, which needs no linear-transfer zscale conversion at
// all. These tests cover the invocation shape; the actual Vulkan/lavapipe
// behavior needs live confirmation on a real machine (also documented in
// hdr-tonemap.js's header) — not something a unit test can verify.

function fakeSpawnProcess({ exitCode = 0, stderrChunks = [] } = {}) {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  queueMicrotask(() => {
    for (const chunk of stderrChunks) proc.stderr.emit("data", Buffer.from(chunk));
    proc.emit("close", exitCode);
  });
  return proc;
}

function toneMapRendition(overrides = {}) {
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
    requiresToneMap: true,
    ...overrides,
  };
}

test("rejects a non-AV1 rendition rather than silently encoding it wrong", async () => {
  await assert.rejects(
    () => tonemapHdrToSdr({ sourcePath: "/data/master.mov", outputDir: "/data/out", rendition: { codecFamily: "avc", requiresToneMap: true } }),
    /expected codecFamily "av1", got "avc"/
  );
});

test("rejects a rendition that doesn't actually require tone-mapping", async () => {
  await assert.rejects(
    () => tonemapHdrToSdr({ sourcePath: "/data/master.mov", outputDir: "/data/out", rendition: toneMapRendition({ requiresToneMap: false }) }),
    /requiresToneMap must be true/
  );
});

test("builds a libplacebo tone-map + SVT-AV1 fMP4/CMAF HLS invocation with a Vulkan device", async () => {
  let capturedArgs = null;
  const spawnFn = (bin, args) => {
    capturedArgs = args;
    return fakeSpawnProcess({ exitCode: 0 });
  };
  const result = await tonemapHdrToSdr({
    sourcePath: "/data/jobs/job-1/1/master.mov",
    outputDir: "/data/jobs/job-1/1/av1-720p-tonemap",
    rendition: toneMapRendition(),
    spawnFn,
  });
  assert.equal(result.playlistPath, path.join("/data/jobs/job-1/1/av1-720p-tonemap", "playlist.m3u8"));
  assert.ok(capturedArgs.includes("-init_hw_device"));
  assert.ok(capturedArgs.includes("vulkan=vk0"));
  assert.ok(capturedArgs.some((a) => a.includes("libplacebo=tonemapping=bt.2390")));
  assert.ok(capturedArgs.some((a) => a.includes("scale=1280:720")));
  assert.ok(capturedArgs.includes("libsvtav1"));
  assert.ok(capturedArgs.includes("fmp4"));
});

test("a Vulkan/lavapipe initialization failure is categorized distinctly from an ordinary encode failure", async () => {
  const spawnFn = () => fakeSpawnProcess({
    exitCode: 1,
    stderrChunks: ["[vulkan @ 0x0] No usable Vulkan devices found\n"],
  });
  await assert.rejects(
    () => tonemapHdrToSdr({ sourcePath: "/data/master.mov", outputDir: "/data/out", rendition: toneMapRendition(), spawnFn }),
    (err) => {
      assert.equal(err.failureCategory, "TONEMAP_VULKAN_UNAVAILABLE");
      return true;
    }
  );
});

test("an ordinary encode failure still falls back to the generic FFmpeg failure category", async () => {
  const spawnFn = () => fakeSpawnProcess({ exitCode: 1, stderrChunks: ["some unrelated encoder error\n"] });
  await assert.rejects(
    () => tonemapHdrToSdr({ sourcePath: "/data/master.mov", outputDir: "/data/out", rendition: toneMapRendition(), spawnFn }),
    (err) => {
      assert.equal(err.failureCategory, "FFMPEG_FAILURE");
      return true;
    }
  );
});
