/**
 * Ingest-time poster extraction for animated video artwork.
 *
 * Runs at admin/ingest time ONLY — never during user requests.
 * Requires ffmpeg on PATH or FFMPEG_PATH env (same requirement as stream-transcode.js).
 *
 * Pipeline:
 *   R2 video object
 *   → download first SAMPLE_BYTES to /tmp
 *   → ffmpeg -ss {timestamp} -i {tmpFile} -vframes 1 -q:v 2 {posterFile}
 *   → upload JPEG to R2 at images/{releaseType}/{slug}/{slug}-poster.jpeg
 *   → return { posterKey, url }
 *
 * Frame selection:
 *   - Target: 10 % of duration (or 10s for very long content, whichever is smaller).
 *   - Floor: 5s minimum offset to skip any black opening frame.
 *   - Override: explicit positionSeconds in options.
 *
 * Failure policy (spec §3E):
 *   If extraction fails, throw — caller must NOT publish the animated asset
 *   without a static representation. The route marks status "needs_poster" in DB.
 */

import { tmpdir } from "os";
import { join } from "path";
import { createWriteStream, readFileSync, rmSync } from "fs";
import { spawn } from "child_process";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET, getPublicR2Url } from "@/lib/storage/r2";

/** Bytes downloaded before poster extraction (first ~5 MB covers most opening frames). */
const SAMPLE_BYTES = 5 * 1024 * 1024;

/** Minimum frame offset in seconds — avoids black opening frames. */
const MIN_OFFSET_S = 5;

/** Maximum frame offset in seconds — don't seek too far into long content. */
const MAX_OFFSET_S = 60;

function resolveFfmpegBinary() {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

/** Check ffmpeg availability (reuses logic from stream-transcode.js). */
export async function isFfmpegAvailable() {
  return new Promise((resolve) => {
    const child = spawn(resolveFfmpegBinary(), ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function runFfmpegPosterExtract(inputPath, outputPath, offsetSeconds) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-ss", String(offsetSeconds),
      "-i", inputPath,
      "-vframes", "1",
      "-q:v", "2",         // JPEG quality 2 = high quality
      "-vf", "scale='min(1280,iw)':-2",  // cap at 1280px wide, preserve aspect
      outputPath,
    ];
    const child = spawn(resolveFfmpegBinary(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (c) => { stderr += String(c); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg poster extract failed (code ${code}): ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Extract and upload a static poster frame from a self-hosted R2 video.
 *
 * @param {{
 *   r2Key: string,
 *   slug: string,
 *   releaseType: string,
 *   positionSeconds?: number,
 *   durationSeconds?: number,
 * }} params
 * @returns {Promise<{ posterKey: string, url: string }>}
 */
export async function extractAndUploadPoster({
  r2Key,
  slug,
  releaseType,
  positionSeconds,
  durationSeconds,
}) {
  if (!R2_BUCKET) throw new Error("R2_BUCKET not configured");

  const safeSlug = String(slug || "").replace(/[^a-z0-9-]/g, "-");
  const safeType = String(releaseType || "singles").replace(/[^a-z0-9-]/g, "-");
  const posterKey = `images/${safeType}/${safeSlug}/${safeSlug}-poster.jpeg`;

  // Determine seek offset
  let offsetSeconds = positionSeconds != null
    ? Math.max(MIN_OFFSET_S, Number(positionSeconds))
    : null;

  if (offsetSeconds == null && durationSeconds) {
    const tenPct = Math.max(MIN_OFFSET_S, Math.min(durationSeconds * 0.10, MAX_OFFSET_S));
    offsetSeconds = tenPct;
  }

  offsetSeconds = offsetSeconds ?? MIN_OFFSET_S;

  const tmpBase = join(tmpdir(), `poster-${Date.now()}-${safeSlug}`);
  const tmpVideo = `${tmpBase}.mp4`;
  const tmpPoster = `${tmpBase}-poster.jpg`;

  try {
    // Download a limited portion of the video (avoid fetching full multi-GB files)
    const getCmd = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Range: `bytes=0-${SAMPLE_BYTES - 1}`,
    });
    const { Body } = await r2Client.send(getCmd);
    if (!Body) throw new Error(`R2 object empty or not found: ${r2Key}`);

    // Write sample to disk
    const writeStream = createWriteStream(tmpVideo);
    await pipeline(Body instanceof Readable ? Body : Readable.from(Body), writeStream);

    // Extract poster frame
    await runFfmpegPosterExtract(tmpVideo, tmpPoster, offsetSeconds);

    // Read and upload JPEG
    const posterBuffer = readFileSync(tmpPoster);
    await r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: posterKey,
      Body: posterBuffer,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }));

    return { posterKey, url: getPublicR2Url(posterKey) };
  } finally {
    // Always clean up tmp files — never leave video chunks on disk
    try { rmSync(tmpVideo, { force: true }); } catch {}
    try { rmSync(tmpPoster, { force: true }); } catch {}
  }
}
