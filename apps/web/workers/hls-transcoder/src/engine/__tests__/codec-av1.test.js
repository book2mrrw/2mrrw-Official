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

// ── HDR color-metadata tagging — confirmed real, distinct from the blocked tone-map path ──

test("an SDR rendition never gets an HDR metadata tag filter, even when sourceAnalysis reports HDR (only the rendition's own hdrMode governs)", async () => {
  let capturedArgs = null;
  await encodeAv1Rendition({
    sourcePath: "/data/master.mov", outputDir: "/data/out",
    rendition: av1Rendition({ hdrMode: "sdr" }),
    sourceAnalysis: { colorPrimaries: "bt2020", colorTransfer: "smpte2084", colorMatrix: "bt2020nc", colorRange: "tv" },
    spawnFn: (bin, args) => { capturedArgs = args; return fakeSpawnProcess({ exitCode: 0 }); },
  });
  const vfIndex = capturedArgs.indexOf("-vf");
  assert.doesNotMatch(capturedArgs[vfIndex + 1], /zscale/);
});

test("a genuine HDR rendition (not tone-mapped) gets the confirmed-working zscale metadata-tag filter, using the real source's own color values", async () => {
  let capturedArgs = null;
  await encodeAv1Rendition({
    sourcePath: "/data/master.mov", outputDir: "/data/out",
    rendition: av1Rendition({ hdrMode: "hdr10", bitDepth: 10, requiresToneMap: false }),
    sourceAnalysis: { colorPrimaries: "bt2020", colorTransfer: "smpte2084", colorMatrix: "bt2020nc", colorRange: "tv" },
    spawnFn: (bin, args) => { capturedArgs = args; return fakeSpawnProcess({ exitCode: 0 }); },
  });
  const vfIndex = capturedArgs.indexOf("-vf");
  // pin=9 (bt2020), tin=16 (smpte2084), min=9 (bt2020nc), rin=0 (tv) — the exact
  // numeric values confirmed live against the real production FFmpeg build.
  assert.match(capturedArgs[vfIndex + 1], /zscale=pin=9:tin=16:min=9:rin=0:p=9:t=16:m=9:r=0/);
});

test("HLG uses its own confirmed transfer value (18), never collapsed into PQ's (16)", async () => {
  let capturedArgs = null;
  await encodeAv1Rendition({
    sourcePath: "/data/master.mov", outputDir: "/data/out",
    rendition: av1Rendition({ hdrMode: "hlg", bitDepth: 10, requiresToneMap: false }),
    sourceAnalysis: { colorPrimaries: "bt2020", colorTransfer: "arib-std-b67", colorMatrix: "bt2020nc", colorRange: "tv" },
    spawnFn: (bin, args) => { capturedArgs = args; return fakeSpawnProcess({ exitCode: 0 }); },
  });
  const vfIndex = capturedArgs.indexOf("-vf");
  assert.match(capturedArgs[vfIndex + 1], /tin=18.*t=18/);
});

test("a rendition marked requiresToneMap never gets the HDR tag filter here — that path is a separate stage, see hdr-tonemap.js", async () => {
  let capturedArgs = null;
  await encodeAv1Rendition({
    sourcePath: "/data/master.mov", outputDir: "/data/out",
    rendition: av1Rendition({ hdrMode: "sdr", requiresToneMap: true }),
    sourceAnalysis: { colorPrimaries: "bt2020", colorTransfer: "smpte2084", colorMatrix: "bt2020nc", colorRange: "tv" },
    spawnFn: (bin, args) => { capturedArgs = args; return fakeSpawnProcess({ exitCode: 0 }); },
  });
  const vfIndex = capturedArgs.indexOf("-vf");
  assert.doesNotMatch(capturedArgs[vfIndex + 1], /zscale/);
});

test("missing sourceAnalysis for an HDR rendition falls back to safe HDR10/BT.2020 defaults rather than throwing", async () => {
  let capturedArgs = null;
  await encodeAv1Rendition({
    sourcePath: "/data/master.mov", outputDir: "/data/out",
    rendition: av1Rendition({ hdrMode: "hdr10", bitDepth: 10, requiresToneMap: false }),
    spawnFn: (bin, args) => { capturedArgs = args; return fakeSpawnProcess({ exitCode: 0 }); },
  });
  const vfIndex = capturedArgs.indexOf("-vf");
  assert.match(capturedArgs[vfIndex + 1], /zscale=pin=9:tin=16:min=9:rin=0/);
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
