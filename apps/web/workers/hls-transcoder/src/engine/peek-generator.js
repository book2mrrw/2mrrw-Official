/**
 * PeekGenerator — a short (5-12s, admin-configurable), muted derivative
 * from the canonical master, sized for card display. Never a slice of the
 * full source resolution/bitrate — this is a small, fast-loading preview,
 * not an alternate rendition.
 *
 * Encoded with -an (no audio stream in the container at all) as defense-
 * in-depth beyond the <video muted> HTML attribute alone, per the Peek
 * Audio Authority design: even a future UI bug that removed `muted` could
 * never make Peek audible, since there is no audio track to unmute. This
 * matches the existing motion-cover convention already used elsewhere in
 * this codebase (silent-by-construction looping video), not a new idea.
 *
 * Duration bounds (5-12s) mirror audio_visuals.peek_duration_seconds's own
 * CHECK constraint (Part C schema) — validated here too, before ever
 * invoking FFmpeg, so a bad value fails fast with a clear message instead
 * of a confusing downstream FFmpeg error or a DB constraint violation
 * after wasted encode time.
 */
import { spawn } from "child_process";

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";

const MIN_PEEK_DURATION_SECONDS = 5;
const MAX_PEEK_DURATION_SECONDS = 12;
const PEEK_MAX_WIDTH = 720; // card-optimized — never upscaled past this or past the source's own width

/**
 * @param {object} params
 * @param {string} params.sourcePath - the canonical master (or an already-downloaded local copy of it)
 * @param {string} params.outputPath
 * @param {number} params.startSeconds - admin-curated start offset into the master
 * @param {number} params.durationSeconds - must be within [5, 12]
 * @param {number} params.sourceWidth - real source width (SourceAnalyzer output) — never upscaled past this
 * @param {number} params.sourceHeight
 * @param {Function} [params.spawnFn] - injectable for tests
 */
export async function generatePeekClip({
  sourcePath, outputPath, startSeconds, durationSeconds, sourceWidth, sourceHeight, spawnFn = spawn,
}) {
  if (!(Number.isFinite(startSeconds) && startSeconds >= 0)) {
    throw new Error(`generatePeekClip: startSeconds must be a real number >= 0, got ${startSeconds}`);
  }
  if (!(Number.isFinite(durationSeconds) && durationSeconds >= MIN_PEEK_DURATION_SECONDS && durationSeconds <= MAX_PEEK_DURATION_SECONDS)) {
    throw new Error(
      `generatePeekClip: durationSeconds must be between ${MIN_PEEK_DURATION_SECONDS} and ${MAX_PEEK_DURATION_SECONDS}, got ${durationSeconds}`
    );
  }
  if (!(sourceWidth > 0 && sourceHeight > 0)) {
    throw new Error("generatePeekClip: sourceWidth/sourceHeight must be known, real positive numbers");
  }

  const targetWidth = Math.min(sourceWidth, PEEK_MAX_WIDTH);
  const evenWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1;

  const args = [
    "-hide_banner", "-loglevel", "error",
    "-ss", String(startSeconds),
    "-i", sourcePath,
    "-t", String(durationSeconds),
    "-an",
    "-vf", `scale=${evenWidth}:-2`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "26",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawnFn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrOutput = "";
    proc.stderr?.on("data", (chunk) => {
      stderrOutput += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        const err = new Error(`FFmpeg exited ${code} generating Peek clip: ${stderrOutput.slice(-2000)}`);
        err.failureCategory = "FFMPEG_FAILURE";
        reject(err);
        return;
      }
      resolve({ outputPath, args });
    });
    proc.on("error", (err) => {
      err.failureCategory = "FFMPEG_FAILURE";
      reject(err);
    });
  });
}
