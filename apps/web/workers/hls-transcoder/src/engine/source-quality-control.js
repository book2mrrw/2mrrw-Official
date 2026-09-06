/**
 * SourceQualityControl — reject a broken source BEFORE expensive compute is
 * spent on it. Two layers:
 *
 *   validateSourceAnalysis — pure, over an already-parsed source_analysis
 *   object (from source-analyzer.js). No process spawn, fully unit-testable.
 *
 *   runDecodeSanityCheck — actually decodes a few seconds with FFmpeg to
 *   catch corruption/truncation that clean metadata alone can't reveal.
 *   `spawnFn` is injectable so the full check is testable without a real
 *   FFmpeg binary.
 */
import { spawn } from "child_process";

const VALID_ROTATIONS = new Set([0, 90, 180, 270, -90, -180, -270]);

/**
 * @param {ReturnType<import("./source-analyzer.js").parseSourceAnalysis>} analysis
 * @returns {{ passed: boolean, failures: Array<{ code: string, message: string }> }}
 */
export function validateSourceAnalysis(analysis) {
  const failures = [];

  if (!analysis.durationSeconds || analysis.durationSeconds <= 0) {
    failures.push({ code: "INVALID_DURATION", message: "Source has no positive duration" });
  }
  if (!analysis.width || !analysis.height) {
    failures.push({ code: "MISSING_VIDEO_DIMENSIONS", message: "Source has no usable video stream dimensions" });
  }
  if (!analysis.frameRate || analysis.frameRate <= 0) {
    failures.push({ code: "INVALID_FRAME_RATE", message: "Source has no usable frame rate" });
  }
  if (!analysis.videoCodec) {
    failures.push({ code: "MISSING_VIDEO_CODEC", message: "Source has no identifiable video codec" });
  }
  if (analysis.rotationDegrees && !VALID_ROTATIONS.has(analysis.rotationDegrees)) {
    failures.push({ code: "INVALID_ROTATION_METADATA", message: `Unexpected rotation value: ${analysis.rotationDegrees}` });
  }
  // Audio is optional — a video-only asset is legitimate — but if present it must be well-formed.
  if (analysis.audioCodec && (!analysis.audioSampleRate || !analysis.audioChannels)) {
    failures.push({ code: "MALFORMED_AUDIO_STREAM", message: "Audio stream present but missing sample rate or channel count" });
  }

  return { passed: failures.length === 0, failures };
}

function defaultSpawn(bin, args) {
  return spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
}

/**
 * Decode-sanity check: attempt to decode the first `probeDurationSeconds` of
 * the source with FFmpeg's null muxer. A clean decode with no stderr output
 * and exit code 0 means the file isn't truncated/corrupt in a way that
 * metadata alone wouldn't reveal.
 */
export function runDecodeSanityCheck(inputPath, { probeDurationSeconds = 5, spawnFn = defaultSpawn } = {}) {
  return new Promise((resolve) => {
    const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";
    const args = ["-v", "error", "-t", String(probeDurationSeconds), "-i", inputPath, "-f", "null", "-"];
    const proc = spawnFn(ffmpegBin, args);

    let stderrOutput = "";
    proc.stderr?.on("data", (chunk) => {
      stderrOutput += chunk.toString();
    });
    proc.on("close", (code) => {
      resolve({ passed: code === 0 && stderrOutput.trim().length === 0, exitCode: code, stderrOutput: stderrOutput.trim() });
    });
    proc.on("error", (err) => {
      resolve({ passed: false, exitCode: null, stderrOutput: err.message });
    });
  });
}
