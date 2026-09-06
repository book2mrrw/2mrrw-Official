import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSceneComplexity,
  runSceneComplexityAnalyzer,
  escapeMovieFilterPath,
} from "../scene-complexity-analyzer.js";

// Frame-tag shape confirmed by actually running ffprobe against a real
// encoded file on the production video machine — not assumed from docs.
function frameTag(overrides = {}) {
  return {
    tags: {
      "lavfi.scd.mafd": "0.419",
      "lavfi.scd.score": "0.419",
      "lavfi.signalstats.YAVG": "126.034",
      "lavfi.signalstats.SATAVG": "87.9967",
      "lavfi.signalstats.YDIF": "0.971979",
      "lavfi.idet.multiple.current_frame": "progressive",
      "lavfi.cropdetect.x1": "0",
      "lavfi.cropdetect.y1": "0",
      "lavfi.cropdetect.x2": "1919",
      "lavfi.cropdetect.y2": "1079",
      "lavfi.cropdetect.w": "1920",
      "lavfi.cropdetect.h": "1080",
      ...overrides,
    },
  };
}

test("aggregates brightness/saturation/frame-difference means from real signalstats tag names", () => {
  const result = parseSceneComplexity({
    frames: [
      frameTag({ "lavfi.signalstats.YAVG": "100", "lavfi.signalstats.SATAVG": "50", "lavfi.signalstats.YDIF": "1" }),
      frameTag({ "lavfi.signalstats.YAVG": "200", "lavfi.signalstats.SATAVG": "70", "lavfi.signalstats.YDIF": "3" }),
    ],
  });
  assert.equal(result.frameCount, 2);
  assert.equal(result.brightnessMean, 150);
  assert.equal(result.saturationMean, 60);
  assert.equal(result.frameDifferenceMean, 2);
  assert.ok(result.brightnessStdDev > 0);
});

test("counts a scene cut only when lavfi.scd.score crosses the threshold, using the real 'scd' tag name (not 'scdet')", () => {
  const result = parseSceneComplexity({
    frames: [
      frameTag({ "lavfi.scd.score": "0.4" }),   // below threshold — not a cut
      frameTag({ "lavfi.scd.score": "45.0" }),  // above threshold — a real cut
      frameTag({ "lavfi.scd.score": "2.1" }),   // below threshold — not a cut
    ],
  });
  assert.equal(result.sceneCutCount, 1);
});

test("computes a real scene-cut-per-minute rate once duration is supplied by the caller", async () => {
  const fakeExec = async () =>
    JSON.stringify({
      frames: [
        frameTag({ "lavfi.scd.score": "45.0" }),
        frameTag({ "lavfi.scd.score": "50.0" }),
      ],
    });
  const result = await runSceneComplexityAnalyzer("/data/jobs/job-1/1/master.mov", { durationSeconds: 60, exec: fakeExec });
  assert.equal(result.sceneCutCount, 2);
  assert.equal(result.sceneCutRatePerMinute, 2); // 2 cuts in 60s = 2/min
});

test("sceneCutRatePerMinute is null when duration is unknown, never a divide-by-zero artifact", async () => {
  const fakeExec = async () => JSON.stringify({ frames: [frameTag()] });
  const result = await runSceneComplexityAnalyzer("/data/jobs/job-1/1/master.mov", { exec: fakeExec });
  assert.equal(result.sceneCutRatePerMinute, null);
});

test("interlace classification is a majority vote across frames using the real 'idet.multiple.current_frame' tag", () => {
  const progressive = parseSceneComplexity({
    frames: [
      frameTag({ "lavfi.idet.multiple.current_frame": "progressive" }),
      frameTag({ "lavfi.idet.multiple.current_frame": "progressive" }),
      frameTag({ "lavfi.idet.multiple.current_frame": "tff" }),
    ],
  });
  assert.equal(progressive.interlaceClassification, "progressive");

  const interlaced = parseSceneComplexity({
    frames: [
      frameTag({ "lavfi.idet.multiple.current_frame": "tff" }),
      frameTag({ "lavfi.idet.multiple.current_frame": "bff" }),
      frameTag({ "lavfi.idet.multiple.current_frame": "progressive" }),
    ],
  });
  assert.equal(interlaced.interlaceClassification, "interlaced");
});

test("crop-detect result uses the final (converged) frame's bounds, in the real w/h/x1/y1/x2/y2 tag shape", () => {
  const result = parseSceneComplexity({
    frames: [
      frameTag({ "lavfi.cropdetect.x2": "1919", "lavfi.cropdetect.w": "1920" }),
      frameTag({ "lavfi.cropdetect.x1": "10", "lavfi.cropdetect.x2": "1909", "lavfi.cropdetect.w": "1900" }),
    ],
  });
  assert.deepEqual(result.cropDetect, { x1: 10, y1: 0, x2: 1909, y2: 1079, width: 1900, height: 1080 });
});

test("no frames in the ffprobe output throws rather than returning fabricated zeros", () => {
  assert.throws(() => parseSceneComplexity({ frames: [] }), /no frames in ffprobe output/);
});

test("escapeMovieFilterPath escapes single quotes and colons that would otherwise break the lavfi filtergraph parser", () => {
  assert.equal(escapeMovieFilterPath("/data/jobs/it's-a-test/master.mov"), "/data/jobs/it\\'s-a-test/master.mov");
  assert.equal(escapeMovieFilterPath("C:/videos/master.mov"), "C\\:/videos/master.mov");
});

test("runSceneComplexityAnalyzer builds the movie= filter chain with the real filter names, in the confirmed working order", async () => {
  let capturedArgs = null;
  const fakeExec = async (bin, args) => {
    capturedArgs = args;
    return JSON.stringify({ frames: [frameTag()] });
  };
  await runSceneComplexityAnalyzer("/data/jobs/job-1/1/master.mov", { durationSeconds: 120, exec: fakeExec });
  const iIndex = capturedArgs.indexOf("-i");
  const filterArg = capturedArgs[iIndex + 1];
  assert.match(filterArg, /^movie='\/data\/jobs\/job-1\/1\/master\.mov',scdet,signalstats,idet,cropdetect$/);
  assert.ok(capturedArgs.includes("-f") && capturedArgs.includes("lavfi"));
  assert.ok(capturedArgs.includes("frame_tags"));
});
