import assert from "node:assert/strict";
import test from "node:test";
import { planRenditions } from "../rendition-planner.js";

function sdrSource(overrides = {}) {
  return { width: 3840, height: 2160, frameRate: 23.976023976023978, hdrMode: "sdr", ...overrides };
}

test("never upscales — a 1080p source produces no rung above 1080p", () => {
  const renditions = planRenditions({ sourceAnalysis: sdrSource({ width: 1920, height: 1080 }) });
  const labels = new Set(renditions.map((r) => r.resolutionLabel));
  assert.ok(!labels.has("2160p"));
  assert.ok(labels.has("1080p"));
});

test("a 4K source gets the full ladder down to 480p", () => {
  const renditions = planRenditions({ sourceAnalysis: sdrSource(), codecFamilies: ["avc"] });
  const labels = renditions.map((r) => r.resolutionLabel);
  assert.deepEqual(labels, ["2160p", "1080p", "720p", "480p"]);
});

test("a source shorter than the smallest rung (480p) gets exactly one native-height rendition, never upscaled to 480p", () => {
  const renditions = planRenditions({ sourceAnalysis: sdrSource({ width: 640, height: 360 }), codecFamilies: ["avc"] });
  assert.equal(renditions.length, 1);
  assert.equal(renditions[0].resolutionLabel, "360p");
  assert.equal(renditions[0].height, 360);
});

test("AVC renditions are always SDR/8-bit, even for a genuinely HDR source", () => {
  const hdrSource = sdrSource({ hdrMode: "hdr10" });
  const renditions = planRenditions({ sourceAnalysis: hdrSource, codecFamilies: ["avc"] });
  for (const r of renditions) {
    assert.equal(r.hdrMode, "sdr");
    assert.equal(r.bitDepth, 8);
    assert.equal(r.requiresToneMap, false);
  }
});

test("AV1 for an SDR source produces exactly one SDR rendition per resolution, no tone-map duplication", () => {
  const renditions = planRenditions({ sourceAnalysis: sdrSource(), codecFamilies: ["av1"] });
  assert.equal(renditions.length, 4); // one per resolution rung, 2160p..480p
  for (const r of renditions) {
    assert.equal(r.hdrMode, "sdr");
    assert.equal(r.requiresToneMap, false);
  }
});

test("AV1 for a genuinely HDR source produces BOTH a native HDR rendition and a tone-map-derived SDR rendition per resolution", () => {
  const hdrSource = sdrSource({ hdrMode: "hdr10" });
  const renditions = planRenditions({ sourceAnalysis: hdrSource, codecFamilies: ["av1"] });
  assert.equal(renditions.length, 8); // 2 variants x 4 resolutions

  const at2160 = renditions.filter((r) => r.resolutionLabel === "2160p");
  assert.equal(at2160.length, 2);
  const hdrVariant = at2160.find((r) => r.hdrMode === "hdr10");
  const sdrVariant = at2160.find((r) => r.hdrMode === "sdr");
  assert.ok(hdrVariant && sdrVariant);
  assert.equal(hdrVariant.bitDepth, 10);
  assert.equal(hdrVariant.requiresToneMap, false);
  assert.equal(sdrVariant.bitDepth, 8);
  assert.equal(sdrVariant.requiresToneMap, true);
});

test("HLG sources are preserved as HLG, not collapsed into HDR10", () => {
  const hlgSource = sdrSource({ hdrMode: "hlg" });
  const renditions = planRenditions({ sourceAnalysis: hlgSource, codecFamilies: ["av1"] });
  const hlgVariant = renditions.find((r) => r.resolutionLabel === "2160p" && r.hdrMode !== "sdr");
  assert.equal(hlgVariant.hdrMode, "hlg");
});

test("CRF baselines differ per codec family and per resolution, never a single shared number", () => {
  const renditions = planRenditions({ sourceAnalysis: sdrSource() });
  const avc1080 = renditions.find((r) => r.codecFamily === "avc" && r.resolutionLabel === "1080p");
  const av11080 = renditions.find((r) => r.codecFamily === "av1" && r.resolutionLabel === "1080p" && r.hdrMode === "sdr");
  const avc480 = renditions.find((r) => r.codecFamily === "avc" && r.resolutionLabel === "480p");
  assert.notEqual(avc1080.crf, av11080.crf, "AVC and AV1 must not share a CRF scale");
  assert.notEqual(avc1080.crf, avc480.crf, "different resolutions must not share the identical CRF");
});

test("high motion/frame-difference lowers CRF (more bits); very static content raises it slightly — within a bounded, documented range", () => {
  const baseline = planRenditions({ sourceAnalysis: sdrSource(), codecFamilies: ["avc"] })
    .find((r) => r.resolutionLabel === "1080p").crf;

  const highMotion = planRenditions({
    sourceAnalysis: sdrSource(),
    complexityAnalysis: { frameDifferenceMean: 5, sceneCutRatePerMinute: 30 },
    codecFamilies: ["avc"],
  }).find((r) => r.resolutionLabel === "1080p").crf;

  const static_ = planRenditions({
    sourceAnalysis: sdrSource(),
    complexityAnalysis: { frameDifferenceMean: 0.1, sceneCutRatePerMinute: 0 },
    codecFamilies: ["avc"],
  }).find((r) => r.resolutionLabel === "1080p").crf;

  assert.ok(highMotion < baseline, "high motion must lower CRF (more bits) relative to baseline");
  assert.ok(static_ > baseline, "very static content must raise CRF (fewer bits) relative to baseline");
  assert.ok(Math.abs(highMotion - baseline) <= 3, "adjustment must stay within the documented bound");
});

test("frame rate is preserved exactly as the source's, never normalized to a round number", () => {
  const renditions = planRenditions({ sourceAnalysis: sdrSource({ frameRate: 29.97002997002997 }), codecFamilies: ["avc"] });
  for (const r of renditions) {
    assert.equal(r.frameRate, 29.97002997002997);
  }
});

test("scaled width preserves aspect ratio and is always even", () => {
  const renditions = planRenditions({ sourceAnalysis: sdrSource({ width: 3840, height: 2160 }), codecFamilies: ["avc"] });
  const at1080 = renditions.find((r) => r.resolutionLabel === "1080p");
  assert.equal(at1080.width, 1920); // exact 16:9 halving
  assert.equal(at1080.width % 2, 0);
});

test("a non-16:9 source scales width proportionally and rounds to an even number", () => {
  // 4:3 source at 1440x1080 (source height itself is 1080, so only 1080p/720p/480p apply)
  const renditions = planRenditions({ sourceAnalysis: sdrSource({ width: 1440, height: 1080 }), codecFamilies: ["avc"] });
  const at720 = renditions.find((r) => r.resolutionLabel === "720p");
  assert.equal(at720.width % 2, 0);
  assert.equal(at720.width, Math.round((1440 * 720) / 1080 / 2) * 2);
});

test("planRenditions rejects a source with no usable dimensions rather than silently planning zero-size renditions", () => {
  assert.throws(() => planRenditions({ sourceAnalysis: { hdrMode: "sdr" } }), /must include width and height/);
});
