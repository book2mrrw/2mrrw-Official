/**
 * HLS transcoder.
 *
 * Given a source audio stream from R2, produces AES-128 encrypted HLS segments
 * for three bitrate tiers (320k / 160k / 96k) using fMP4 (CMAF) containers.
 *
 * Pipeline per bitrate:
 *   R2 download stream → FFmpeg stdin → fMP4 segmenter → AES-128 key file + segments → R2
 *
 * All three bitrates are transcoded serially to avoid saturating the CPU
 * on a single Fly.io machine. Parallelising across machines is handled by
 * the job queue — separate jobs per track.
 *
 * FFmpeg flags:
 *   -hls_segment_type fmp4      → CMAF-compatible fMP4 segments (required for HLS v7)
 *   -hls_flags independent_segments → #EXT-X-INDEPENDENT-SEGMENTS for seek correctness
 *   -hls_key_info_file          → AES-128 encryption at the muxer level
 *   -hls_time 6                 → 6-second target segment duration (music streaming standard)
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import { logger } from "./logger.js";
import { downloadStream, upload } from "./r2.js";

const FFMPEG_BIN  = process.env.FFMPEG_PATH || "ffmpeg";
const SEG_DURATION = 6; // seconds

/**
 * Derive the AES-128 key and IV for a track.
 * Must match derive-key.js used by /api/library/hls/key.
 * Both use HMAC-SHA256(HLS_MASTER_SECRET, purpose)[0:16].
 */
function deriveKey(slug, trackSlug) {
  const secret  = process.env.HLS_MASTER_SECRET;
  if (!secret) throw new Error("HLS_MASTER_SECRET is required");

  const canonical  = trackSlug ? `${slug}:${trackSlug}` : slug;
  const keyInput   = `2mrrw:hls:${canonical}:key`;
  const ivInput    = `2mrrw:hls:${canonical}:iv`;

  const key = crypto.createHmac("sha256", secret).update(keyInput).digest().slice(0, 16);
  const iv  = crypto.createHmac("sha256", secret).update(ivInput).digest().slice(0, 16);
  return { key, iv };
}

/**
 * Write a temporary key-info file for FFmpeg's -hls_key_info_file flag.
 * Format (three lines):
 *   <key URI that hls.js will fetch>
 *   <local path to the raw key bytes>
 *   <IV as 32-char hex>
 *
 * The key URI is a placeholder — the actual URL is embedded in the playlist
 * by the variant manifest route, not by FFmpeg.
 */
async function writeKeyInfoFile(tmpDir, key, iv) {
  const keyFile    = path.join(tmpDir, "enc.key");
  const keyInfoFile = path.join(tmpDir, "enc.keyinfo");
  const ivHex      = iv.toString("hex");

  fs.writeFileSync(keyFile, key);
  // Key URI placeholder — the variant manifest route replaces this with the real signed URL
  fs.writeFileSync(keyInfoFile, `placeholder\n${keyFile}\n${ivHex}\n`);

  return keyInfoFile;
}

/**
 * Run FFmpeg for a single bitrate, segmenting into fMP4 chunks.
 * Returns { initPath, segmentPaths, durationSeconds }.
 */
async function transcodeOneBitrate({ sourceStream, bitrate, slug, trackSlug, tmpDir, keyInfoFile }) {
  const bitrateDir = path.join(tmpDir, bitrate);
  fs.mkdirSync(bitrateDir, { recursive: true });

  const segPattern  = path.join(bitrateDir, "seg_%05d.ts");
  const playlistPath = path.join(bitrateDir, "playlist.m3u8");

  const kbps = bitrate.replace("k", "");

  const ffmpegArgs = [
    // Input: piped from stdin (R2 download stream)
    "-i", "pipe:0",

    // Audio codec: AAC-LC, the universally compatible choice for HLS
    "-c:a", "aac",
    "-b:a", `${kbps}k`,
    "-ac", "2",           // stereo
    "-ar", "44100",       // 44.1 kHz — CD quality sample rate

    // Output: HLS with MPEG-TS segments (fMP4 AES-128 is not implemented in FFmpeg)
    "-f", "hls",
    "-hls_time", String(SEG_DURATION),
    "-hls_segment_filename", segPattern,
    "-hls_playlist_type", "vod",
    "-hls_flags", "independent_segments",

    // AES-128 encryption — supported for MPEG-TS
    "-hls_key_info_file", keyInfoFile,

    // Write playlist
    playlistPath,
  ];

  logger.info("ffmpeg start", { bitrate, slug, trackSlug });

  await new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, ffmpegArgs, { stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.stdout.on("data", () => {}); // unused but must drain

    // Pipe source audio into FFmpeg
    pipeline(sourceStream, proc.stdin).catch((err) => {
      // FFmpeg closes stdin when done — ignore EPIPE at end of stream
      if (err.code !== "EPIPE") {
        logger.warn("stdin pipeline error", { code: err.code, message: err.message });
      }
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        const tail = stderr.slice(-2000); // last 2000 chars of FFmpeg output
        logger.error("ffmpeg failed", { code, bitrate, tail });
        reject(new Error(`FFmpeg exited ${code} for bitrate ${bitrate}:\n${tail}`));
      } else {
        resolve();
      }
    });

    proc.on("error", reject);
  });

  // Parse duration from the generated playlist
  const playlistText  = fs.readFileSync(playlistPath, "utf8");
  const durationSeconds = parseDuration(playlistText);

  // Collect segment paths in order
  const entries = fs.readdirSync(bitrateDir)
    .filter((f) => f.endsWith(".ts"))
    .sort();
  const segmentPaths = entries.map((f) => path.join(bitrateDir, f));

  logger.info("ffmpeg done", { bitrate, segments: segmentPaths.length, durationSeconds });

  return { segmentPaths, durationSeconds };
}

/** Sum all #EXTINF durations from an HLS playlist string */
function parseDuration(playlistText) {
  let total = 0;
  for (const line of playlistText.split("\n")) {
    if (line.startsWith("#EXTINF:")) {
      const val = parseFloat(line.replace("#EXTINF:", "").replace(",", ""));
      if (!isNaN(val)) total += val;
    }
  }
  return total;
}

/**
 * Main entry point called by index.js per job.
 *
 * 1. Downloads source audio from R2 once per bitrate (three serial passes).
 * 2. Transcodes to fMP4 segments with AES-128 encryption.
 * 3. Uploads init.mp4 + all seg_XXXXX.m4s to R2.
 * 4. Returns manifest metadata for DB upsert.
 */
export async function transcode({ job }) {
  const { id: jobId, slug, track_slug: trackSlug, source_key: sourceKey,
          hls_prefix: prefix, bitrates = ["320k", "160k", "96k"] } = job;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hls-${jobId}-`));

  try {
    const { key, iv } = deriveKey(slug, trackSlug);
    const keyInfoFile = await writeKeyInfoFile(tmpDir, key, iv);

    const segmentCounts = {};
    let durationSeconds = 0;

    for (const bitrate of bitrates) {
      logger.info("transcode bitrate", { jobId, bitrate });

      // Fresh download per bitrate — streaming, not buffered
      const sourceStream = await downloadStream(sourceKey);

      const { segmentPaths, durationSeconds: dur } = await transcodeOneBitrate({
        sourceStream, bitrate, slug, trackSlug, tmpDir, keyInfoFile,
      });

      // Upload MPEG-TS segments
      for (let i = 0; i < segmentPaths.length; i++) {
        const segNum = String(i + 1).padStart(5, "0");
        const segKey = `${prefix}${bitrate}/seg_${segNum}.ts`;
        await upload(segKey, fs.readFileSync(segmentPaths[i]), "video/mp2t");
      }

      segmentCounts[bitrate] = segmentPaths.length;
      if (dur > durationSeconds) durationSeconds = dur; // use the longest (all should match)

      logger.info("bitrate uploaded", { bitrate, segments: segmentPaths.length });
    }

    // Manifest metadata returned to index.js for DB upsert
    return {
      slug,
      track_slug:            trackSlug ?? null,
      release_type:          job.release_type,
      hls_prefix:            prefix,
      bitrates,
      segment_duration_secs: SEG_DURATION,
      duration_seconds:      durationSeconds,
      segment_counts:        segmentCounts,
    };
  } finally {
    // Always clean up temp files — segments can be 50–200 MB per bitrate
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
