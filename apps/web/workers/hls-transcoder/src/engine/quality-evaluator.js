/**
 * QualityEvaluator — VMAF + CAMBI + SSIM scoring via libvmaf, wired into a
 * bounded accept/retry loop. Codec-agnostic: takes an injectable encodeFn
 * and never branches on codecFamily itself (that stays inside codec-avc.js/
 * codec-av1.js, per this engine's own "media policy lives in its own
 * module" rule).
 *
 * Confirmed live against the production video machine:
 *  - `ffmpeg -i <distorted> -i <reference> -lavfi
 *    "libvmaf=feature=name=cambi|name=float_ssim:log_path=<f>:log_fmt=json"
 *    -f null -` produces a real JSON report at pooled_metrics.{vmaf,cambi,
 *    float_ssim}.mean (exit 0, both features registered and computing).
 *  - FFmpeg's own HLS demuxer reads a fMP4/CMAF `playlist.m3u8` directly as
 *    the distorted input — no separate flat-file re-mux needed to evaluate
 *    a CodecEngine rendition's actual packaged output.
 *
 * CAMBI is a banding-defect score where LOWER is better (0 = none); VMAF and
 * SSIM are conventional higher-is-better scores — thresholds reflect that
 * asymmetry explicitly (minVmaf/minSsim floors, a maxCambi ceiling), never a
 * single "higher always wins" comparison.
 */
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";

/**
 * @param {object} params
 * @param {string} params.referencePath - decodable reference (usually the source master)
 * @param {string} params.distortedPath - decodable encoded output; a fMP4/HLS playlist.m3u8 works directly
 * @param {string} params.logPath - where FFmpeg writes the libvmaf JSON report
 * @param {Function} [params.spawnFn] - injectable for tests
 * @param {Function} [params.readFileFn] - injectable for tests
 */
export async function evaluateRenditionQuality({
  referencePath, distortedPath, logPath, spawnFn = spawn, readFileFn = fs.readFile,
}) {
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-i", distortedPath,
    "-i", referencePath,
    "-lavfi", `libvmaf=feature=name=cambi|name=float_ssim:log_path=${logPath}:log_fmt=json`,
    "-f", "null", "-",
  ];

  await new Promise((resolve, reject) => {
    const proc = spawnFn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrOutput = "";
    proc.stderr?.on("data", (chunk) => {
      stderrOutput += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        const err = new Error(`FFmpeg exited ${code} evaluating quality: ${stderrOutput.slice(-2000)}`);
        err.failureCategory = "FFMPEG_FAILURE";
        reject(err);
        return;
      }
      resolve();
    });
    proc.on("error", (err) => {
      err.failureCategory = "FFMPEG_FAILURE";
      reject(err);
    });
  });

  let raw;
  try {
    raw = JSON.parse(await readFileFn(logPath, "utf8"));
  } catch (parseErr) {
    const err = new Error(`libvmaf JSON log at ${logPath} could not be read/parsed: ${parseErr.message}`);
    err.failureCategory = "OUTPUT_VALIDATION_FAILURE";
    throw err;
  }

  const pooled = raw.pooled_metrics || {};
  if (typeof pooled.vmaf?.mean !== "number") {
    const err = new Error("libvmaf JSON log missing pooled_metrics.vmaf.mean — malformed quality report");
    err.failureCategory = "OUTPUT_VALIDATION_FAILURE";
    throw err;
  }

  return {
    vmaf: pooled.vmaf.mean,
    cambi: typeof pooled.cambi?.mean === "number" ? pooled.cambi.mean : null,
    ssim: typeof pooled.float_ssim?.mean === "number" ? pooled.float_ssim.mean : null,
    raw,
  };
}

/**
 * @param {object} scores - { vmaf, cambi, ssim }
 * @param {object} thresholds - { minVmaf, maxCambi, minSsim } — an omitted
 *   threshold is simply not checked (lets a caller gate on VMAF alone).
 */
export function meetsQualityThresholds(scores, thresholds = {}) {
  if (typeof thresholds.minVmaf === "number" && scores.vmaf < thresholds.minVmaf) return false;
  if (typeof thresholds.maxCambi === "number" && typeof scores.cambi === "number" && scores.cambi > thresholds.maxCambi) return false;
  if (typeof thresholds.minSsim === "number" && typeof scores.ssim === "number" && scores.ssim < thresholds.minSsim) return false;
  return true;
}

// Lower CRF = higher quality on both libx264's and libsvtav1's own numeric
// scales, even though the two scales' absolute ranges differ (AVC ~18-28,
// AV1 0-63) — this direction holds regardless of codec family, so it's a
// safe generic default. A caller with codec-specific retry policy (e.g. also
// stepping preset) should pass its own adjustSettingsForRetry instead.
function defaultAdjustSettingsForRetry(rendition) {
  return { ...rendition, crf: Math.max(0, rendition.crf - 4) };
}

/**
 * Bounded accept/retry loop: encode -> evaluate -> accept, or adjust
 * settings and retry, up to maxAttempts. Never loops unboundedly. Throws
 * OUTPUT_VALIDATION_FAILURE if no attempt meets the thresholds within the
 * cap — the last attempt's encode result/rendition/scores are attached to
 * the thrown error for logging, never silently discarded.
 *
 * @param {object} params
 * @param {object} params.rendition - starting rendition plan (RenditionPlanner output)
 * @param {string} params.sourcePath
 * @param {string} params.referencePath - decodable reference for VMAF/SSIM comparison (usually the source itself)
 * @param {string} params.outputDir
 * @param {Function} params.encodeFn - ({ sourcePath, outputDir, rendition }) => { playlistPath, ... }
 * @param {Function} [params.evaluateQualityFn]
 * @param {object} params.thresholds
 * @param {number} [params.maxAttempts]
 * @param {Function} [params.adjustSettingsForRetry] - (rendition, attemptNumber, scores) => rendition
 * @param {Function} [params.logPathFn] - (attemptNumber) => path for the libvmaf JSON log
 */
export async function runQualityGatedEncode({
  rendition, sourcePath, referencePath, outputDir, encodeFn,
  evaluateQualityFn = evaluateRenditionQuality, thresholds = {},
  maxAttempts = 3, adjustSettingsForRetry = defaultAdjustSettingsForRetry,
  logPathFn = (attempt) => path.join(outputDir, `quality-log-attempt-${attempt}.json`),
}) {
  let currentRendition = rendition;
  let lastEncodeResult = null;
  let lastScores = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const encodeResult = await encodeFn({ sourcePath, outputDir, rendition: currentRendition });
    const scores = await evaluateQualityFn({
      referencePath,
      distortedPath: encodeResult.playlistPath,
      logPath: logPathFn(attempt),
    });

    lastEncodeResult = encodeResult;
    lastScores = scores;

    if (meetsQualityThresholds(scores, thresholds)) {
      return { encodeResult, scores, rendition: currentRendition, attempts: attempt };
    }

    if (attempt < maxAttempts) {
      currentRendition = adjustSettingsForRetry(currentRendition, attempt, scores);
    }
  }

  const err = new Error(
    `Rendition ${rendition.resolutionLabel} (${rendition.codecFamily}) failed to meet quality thresholds ` +
    `after ${maxAttempts} attempt(s): last scores vmaf=${lastScores?.vmaf} cambi=${lastScores?.cambi} ssim=${lastScores?.ssim}`
  );
  err.failureCategory = "OUTPUT_VALIDATION_FAILURE";
  err.lastEncodeResult = lastEncodeResult;
  err.lastScores = lastScores;
  err.lastRendition = currentRendition;
  throw err;
}
