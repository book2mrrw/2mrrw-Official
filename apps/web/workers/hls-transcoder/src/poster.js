/**
 * Poster frame extraction for vault video and animated cover art.
 *
 * Called automatically by index.js after every successful video transcode
 * (jobs with video bitrates: 4000k / 2000k / 1000k / 720k).
 *
 * Pipeline:
 *   R2 range download (first 5 MB of source video)
 *   → write tmp file
 *   → ffmpeg -ss {offset} -vframes 1 → JPEG
 *   → upload to R2 at images/{releaseType}/{slug}/{slug}-poster.jpeg
 *
 * Frame offset: max(5s, min(duration * 10%, 60s))
 * Fails non-fatally — video plays fine without a poster.
 */

import { spawn }                                         from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join }                                          from "path";
import { tmpdir }                                        from "os";
import { logger }                                        from "./logger.js";
import { downloadPartialBuffer, upload }                 from "./r2.js";

const FFMPEG_BIN   = process.env.FFMPEG_PATH || "ffmpeg";
const SAMPLE_BYTES = 5 * 1024 * 1024; // 5 MB — enough to cover opening frames
const MIN_OFFSET   = 5;
const MAX_OFFSET   = 60;

function computeOffset(durationSeconds) {
  if (!durationSeconds) return MIN_OFFSET;
  return Math.max(MIN_OFFSET, Math.min(durationSeconds * 0.10, MAX_OFFSET));
}

function runFfmpegPoster(inputPath, outputPath, offsetSeconds) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, [
      "-y",
      "-ss", String(offsetSeconds),
      "-i",  inputPath,
      "-vframes", "1",
      "-q:v", "2",
      "-vf", "scale='min(1280,iw)':-2",
      outputPath,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg poster exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Extract a static poster frame from a video stored in R2 and upload it.
 *
 * @param {{ sourceKey: string, slug: string, releaseType: string, durationSeconds?: number }} opts
 * @returns {Promise<string>} R2 key of the uploaded poster JPEG
 */
export async function extractPoster({ sourceKey, slug, releaseType, durationSeconds }) {
  const safeSlug = slug.replace(/[^a-z0-9-]/g, "-");
  const safeType = (releaseType || "vault").replace(/[^a-z0-9-]/g, "-");
  const posterKey = `images/${safeType}/${safeSlug}/${safeSlug}-poster.jpeg`;
  const offset    = computeOffset(durationSeconds);

  const tmpDir    = mkdtempSync(join(tmpdir(), `poster-${safeSlug}-`));
  const tmpVideo  = join(tmpDir, "sample.mp4");
  const tmpPoster = join(tmpDir, "poster.jpg");

  try {
    logger.info("poster extract start", { slug, sourceKey, offset });

    const buf = await downloadPartialBuffer(sourceKey, SAMPLE_BYTES);
    writeFileSync(tmpVideo, buf);

    await runFfmpegPoster(tmpVideo, tmpPoster, offset);

    const jpeg = readFileSync(tmpPoster);
    await upload(posterKey, jpeg, "image/jpeg", {
      CacheControl: "public, max-age=31536000, immutable",
    });

    logger.info("poster uploaded", { slug, posterKey, bytes: jpeg.length });
    return posterKey;
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
