/**
 * SceneComplexityAnalyzer — one ffprobe pass over scdet/signalstats/idet/
 * cropdetect, aggregated into a cheap proxy for encoding difficulty (scene-
 * cut rate, brightness/saturation/frame-difference stats, interlace
 * classification, crop bounds). All native FFmpeg filters, confirmed
 * available and confirmed working on the live production video machine —
 * no external ML dependency for this first implementation.
 *
 * The exact frame-tag names below (lavfi.scd.score, lavfi.signalstats.YAVG,
 * etc.) were verified by actually running ffprobe against a real encoded
 * file on the production machine, not assumed from documentation — FFmpeg's
 * scene-cut filter tag is genuinely named "scd", not "scdet" as the filter
 * itself is. ffprobe's own `-i file -vf ...` does NOT populate frame_tags at
 * all (confirmed empty output); the working invocation requires the lavfi
 * pseudo-demuxer's `movie=` source filter, confirmed against a real file.
 *
 * parseSceneComplexity is a pure function over already-decoded ffprobe JSON,
 * fully unit-testable with fixture data. runSceneComplexityAnalyzer is the
 * thin wrapper that actually invokes ffprobe; `exec` is injectable.
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// lavfi.scd.score is roughly 0-100; this is a starting threshold, not a
// final one — calibrate against real representative masters (Part H).
const SCENE_CUT_SCORE_THRESHOLD = 30;

/** Escape a path for safe embedding inside an ffmpeg lavfi movie= filter argument. */
export function escapeMovieFilterPath(inputPath) {
  return String(inputPath).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

/** Parse raw ffprobe frame_tags JSON (already-decoded object) into aggregated complexity stats. */
export function parseSceneComplexity(ffprobeJson) {
  const frames = ffprobeJson?.frames || [];
  if (frames.length === 0) {
    throw new Error("parseSceneComplexity: no frames in ffprobe output");
  }

  let sceneCutCount = 0;
  let yAvgSum = 0;
  let yAvgSumSq = 0;
  let satAvgSum = 0;
  let yDifSum = 0;
  let yDifCount = 0;
  let progressiveCount = 0;
  let interlacedCount = 0;
  let undeterminedCount = 0;
  let lastCropDetect = null;

  for (const frame of frames) {
    const tags = frame?.tags || {};

    const scdScore = Number(tags["lavfi.scd.score"]);
    if (Number.isFinite(scdScore) && scdScore >= SCENE_CUT_SCORE_THRESHOLD) sceneCutCount += 1;

    const yavg = Number(tags["lavfi.signalstats.YAVG"]);
    if (Number.isFinite(yavg)) {
      yAvgSum += yavg;
      yAvgSumSq += yavg * yavg;
    }

    const satavg = Number(tags["lavfi.signalstats.SATAVG"]);
    if (Number.isFinite(satavg)) satAvgSum += satavg;

    const ydif = Number(tags["lavfi.signalstats.YDIF"]);
    if (Number.isFinite(ydif)) {
      yDifSum += ydif;
      yDifCount += 1;
    }

    const idetFrame = tags["lavfi.idet.multiple.current_frame"];
    if (idetFrame === "progressive") progressiveCount += 1;
    else if (idetFrame === "tff" || idetFrame === "bff") interlacedCount += 1;
    else undeterminedCount += 1;

    if (tags["lavfi.cropdetect.x1"] !== undefined) {
      lastCropDetect = {
        x1: Number(tags["lavfi.cropdetect.x1"]),
        y1: Number(tags["lavfi.cropdetect.y1"]),
        x2: Number(tags["lavfi.cropdetect.x2"]),
        y2: Number(tags["lavfi.cropdetect.y2"]),
        width: Number(tags["lavfi.cropdetect.w"]),
        height: Number(tags["lavfi.cropdetect.h"]),
      };
    }
  }

  const frameCount = frames.length;
  const brightnessMean = yAvgSum / frameCount;
  const brightnessVariance = yAvgSumSq / frameCount - brightnessMean * brightnessMean;

  return {
    frameCount,
    sceneCutCount,
    brightnessMean,
    brightnessStdDev: Math.sqrt(Math.max(0, brightnessVariance)),
    saturationMean: satAvgSum / frameCount,
    frameDifferenceMean: yDifCount > 0 ? yDifSum / yDifCount : 0,
    interlaceClassification:
      interlacedCount > progressiveCount && interlacedCount > undeterminedCount
        ? "interlaced"
        : progressiveCount >= undeterminedCount
        ? "progressive"
        : "undetermined",
    cropDetect: lastCropDetect,
  };
}

async function defaultExec(bin, args) {
  const { stdout } = await execFileAsync(bin, args, { maxBuffer: 50 * 1024 * 1024 });
  return stdout;
}

/**
 * Invoke ffprobe against a real file and parse its output. `durationSeconds`
 * (from SourceAnalyzer) converts the raw scene-cut count into a rate; passing
 * it in here (rather than computing it inside parseSceneComplexity) keeps
 * the pure parser free of any fps/duration assumption. `exec` is injectable
 * for tests.
 */
export async function runSceneComplexityAnalyzer(inputPath, { durationSeconds, exec = defaultExec } = {}) {
  const filterChain = `movie='${escapeMovieFilterPath(inputPath)}',scdet,signalstats,idet,cropdetect`;
  const stdout = await exec(process.env.FFPROBE_PATH || "ffprobe", [
    "-v", "quiet",
    "-f", "lavfi",
    "-i", filterChain,
    "-show_entries", "frame_tags",
    "-of", "json",
  ]);
  const parsed = parseSceneComplexity(JSON.parse(stdout));
  const sceneCutRatePerMinute =
    Number.isFinite(durationSeconds) && durationSeconds > 0 ? (parsed.sceneCutCount / durationSeconds) * 60 : null;

  return { ...parsed, sceneCutRatePerMinute };
}
