/**
 * RenditionPlanner — decides the rendition ladder for one asset version,
 * given its SourceAnalyzer output (source ceiling, HDR signaling, frame
 * rate) and SceneComplexityAnalyzer output (encoding-difficulty proxy).
 * Pure decision logic — no FFmpeg/ffprobe invocation here.
 *
 * Hard rules, never violated:
 *   - never upscale — a rung whose nominal height exceeds the source's own
 *     height is excluded outright, not clamped/scaled up to it.
 *   - source frame rate is always preserved as-is, never normalized.
 *   - AVC renditions are always SDR/8-bit, regardless of source HDR — 8-bit
 *     H.264 HDR isn't real-world practiced; this is a deliberate design
 *     choice (AVC stays the broad-compatibility SDR path), not a limitation.
 *   - AV1 renditions inherit the source's real HDR mode when genuinely
 *     HDR-signaled; a genuinely HDR source ALSO gets a tone-map-derived SDR
 *     AV1 ladder at the same resolutions (requiresToneMap: true), so SDR
 *     displays always have a validated fallback.
 *
 * CRF/preset baselines below are a documented starting policy, not final —
 * Part H calibrates these against real representative masters. The
 * complexity-informed adjustment is deliberately small and clamped so a bad
 * complexity read can never produce a wildly wrong quality target.
 */

// Must stay in sync with apps/web/src/lib/hls/video-renditions.js's
// VIDEO_RENDITIONS — kept as a local constant since this worker package has
// no import path into the main app's src/ tree.
const RESOLUTION_LADDER = [
  { label: "2160p", height: 2160 },
  { label: "1080p", height: 1080 },
  { label: "720p", height: 720 },
  { label: "480p", height: 480 },
];

// AVC: 0-51 typical usable range ~18-28. AV1 (SVT-AV1): 0-63, confirmed via
// `ffmpeg -h encoder=libsvtav1` on the live production machine — an
// entirely different scale from AVC's, never shared.
const BASE_CRF = {
  avc: { "2160p": 20, "1080p": 21, "720p": 22, "480p": 23 },
  av1: { "2160p": 30, "1080p": 32, "720p": 34, "480p": 36 },
};

const BASE_PRESET = {
  avc: "slow", // VOD is encoded once, played many times — quality-oriented, not real-time.
  av1: 6,      // SVT-AV1 numeric preset, lower = slower/better; a common "high quality, still practical" VOD starting point.
};

function complexityAdjustment(complexity) {
  if (!complexity) return 0;
  let adjustment = 0;
  if (complexity.frameDifferenceMean > 3) adjustment -= 2;
  else if (complexity.frameDifferenceMean > 1.5) adjustment -= 1;
  else if (complexity.frameDifferenceMean < 0.3) adjustment += 1;

  if (complexity.sceneCutRatePerMinute != null && complexity.sceneCutRatePerMinute > 20) adjustment -= 1;

  return Math.max(-3, Math.min(2, adjustment));
}

/** Preserve aspect ratio; width must be even (required by yuv420-family pixel formats). */
function scaleDimensions(sourceWidth, sourceHeight, targetHeight) {
  const targetWidth = Math.round((sourceWidth * targetHeight) / sourceHeight / 2) * 2;
  return { width: targetWidth, height: targetHeight };
}

function baseCrfFor(codecFamily, resolutionLabel) {
  return BASE_CRF[codecFamily]?.[resolutionLabel] ?? BASE_CRF[codecFamily]["1080p"];
}

/**
 * @param {object} params
 * @param {ReturnType<import("./source-analyzer.js").parseSourceAnalysis>} params.sourceAnalysis
 * @param {ReturnType<import("./scene-complexity-analyzer.js").parseSceneComplexity>} [params.complexityAnalysis]
 * @param {Array<"avc"|"av1">} [params.codecFamilies]
 * @returns {Array<object>} one entry per planned rendition
 */
export function planRenditions({ sourceAnalysis, complexityAnalysis, codecFamilies = ["avc", "av1"] }) {
  if (!sourceAnalysis?.width || !sourceAnalysis?.height) {
    throw new Error("planRenditions: sourceAnalysis must include width and height");
  }

  let eligibleRungs = RESOLUTION_LADDER.filter((rung) => rung.height <= sourceAnalysis.height);
  if (eligibleRungs.length === 0) {
    // Source is shorter than even the smallest rung — one native-height
    // rendition, never upscaled to a taller nominal rung.
    eligibleRungs = [{ label: `${sourceAnalysis.height}p`, height: sourceAnalysis.height }];
  }

  const sourceIsHdr = Boolean(sourceAnalysis.hdrMode && sourceAnalysis.hdrMode !== "sdr");
  const adjustment = complexityAdjustment(complexityAnalysis);
  const renditions = [];

  for (const codecFamily of codecFamilies) {
    for (const rung of eligibleRungs) {
      const { width, height } = scaleDimensions(sourceAnalysis.width, sourceAnalysis.height, rung.height);
      const crf = baseCrfFor(codecFamily, rung.label) + adjustment;
      const preset = BASE_PRESET[codecFamily];
      const common = { codecFamily, resolutionLabel: rung.label, width, height, frameRate: sourceAnalysis.frameRate, crf, preset };

      if (codecFamily === "avc") {
        renditions.push({ ...common, bitDepth: 8, hdrMode: "sdr", requiresToneMap: false });
        continue;
      }

      if (sourceIsHdr) {
        renditions.push({ ...common, bitDepth: 10, hdrMode: sourceAnalysis.hdrMode, requiresToneMap: false });
        renditions.push({ ...common, bitDepth: 8, hdrMode: "sdr", requiresToneMap: true });
      } else {
        renditions.push({ ...common, bitDepth: 8, hdrMode: "sdr", requiresToneMap: false });
      }
    }
  }

  return renditions;
}
