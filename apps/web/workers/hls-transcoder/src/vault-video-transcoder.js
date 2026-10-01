/**
 * Vault video transcoder — the job_type='vault_video' dispatch target.
 *
 * Deliberately NOT video-transcoder.js. That one is the Audio Visualz
 * pipeline: it requires an asset_version_id, loads audio_visual_asset_versions
 * and audio_visuals, writes audio_visual_renditions, and promotes a version.
 * Vault content has none of those rows. It also produces fMP4 keyed by UUIDs,
 * while the Vault's playback routes read AES-128 MPEG-TS keyed by the content
 * slug.
 *
 * So this file is modelled on transcoder.js (the audio lane) instead: same
 * encrypted-MPEG-TS output, same slug-derived key, same hls_manifests
 * completion record — with video encoding in place of audio-only. Matching the
 * consumer is what lets /api/vault/video/{manifest,variant,key} work with no
 * changes at all.
 *
 * Ladder values are duplicated from src/lib/vault/vault-video-contract.js by
 * hand, for the same reason derive-key.js duplicates the app's key derivation:
 * the web app and this worker are separate deployables with no shared module
 * path. Keep the two copies in sync if either changes.
 */

import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { spawn } from "node:child_process";
import { pipeline } from "stream/promises";
import { logger } from "./logger.js";
import { downloadStream, upload } from "./r2.js";
import { markJobComplete } from "./db.js";
import { ladderForSourceHeight, SEGMENT_SECONDS } from "./vault-video-ladder.js";

const SEG_DURATION = SEGMENT_SECONDS;
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

/**
 * Must match apps/web/src/lib/hls/derive-key.js exactly -- the key route
 * derives the same bytes from the same slug, and a mismatch decrypts to noise.
 */
function deriveKey(slug) {
  const secret = process.env.HLS_MASTER_SECRET;
  if (!secret) throw new Error("HLS_MASTER_SECRET is required");
  const key = crypto.createHmac("sha256", secret).update(`2mrrw:hls:${slug}:key`).digest().slice(0, 16);
  const iv = crypto.createHmac("sha256", secret).update(`2mrrw:hls:${slug}:iv`).digest().slice(0, 16);
  return { key, iv };
}

function writeKeyInfoFile(tmpDir, key, iv) {
  const keyFile = path.join(tmpDir, "enc.key");
  const keyInfoFile = path.join(tmpDir, "enc.keyinfo");
  fs.writeFileSync(keyFile, key);
  // The URI is a placeholder; the variant route substitutes the real signed
  // key URL when it builds the playlist it serves.
  fs.writeFileSync(keyInfoFile, `placeholder\n${keyFile}\n${iv.toString("hex")}\n`);
  return keyInfoFile;
}

function run(binary, args, { timeoutMs = 6 * 60 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr = (stderr + d.toString()).slice(-8000); });
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error(`${binary} timed out`)); }, timeoutMs);
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${binary} exited ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

/** Height, duration and frame rate. The ladder and the GOP length both depend
 *  on the source, so this runs before any encoding. */
async function probeSource(sourcePath) {
  const { stdout } = await run(FFPROBE, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=height,width,r_frame_rate",
    "-show_entries", "format=duration",
    "-of", "json", sourcePath,
  ], { timeoutMs: 5 * 60 * 1000 });

  const probe = JSON.parse(stdout);
  const stream = probe?.streams?.[0];
  if (!stream) {
    const err = new Error("vault video source has no video stream");
    err.failureCategory = "PROBE_FAILURE";
    throw err;
  }
  const [num, den] = String(stream.r_frame_rate || "30/1").split("/").map(Number);
  const fps = den > 0 && num > 0 ? num / den : 30;
  return {
    height: Number(stream.height) || 0,
    width: Number(stream.width) || 0,
    fps: Math.min(Math.max(fps, 1), 120),
    durationSeconds: Number(probe?.format?.duration) || 0,
  };
}

/** Encode one rung to encrypted MPEG-TS and report what it produced. */
async function encodeRung({ sourcePath, rung, tmpDir, keyInfoFile, fps, slug }) {
  const dir = path.join(tmpDir, rung.bitrate);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  // One keyframe every segment, so every segment starts independently
  // decodable and a player can switch rungs at any boundary.
  const gop = Math.max(2, Math.round(fps * SEG_DURATION));

  await run(FFMPEG, [
    "-hide_banner", "-nostats", "-xerror", "-y",
    "-i", sourcePath,
    // -2 keeps the width even and preserves the source aspect, so vertical
    // phone video ladders down correctly instead of being letterboxed to 16:9.
    "-vf", `scale=-2:${rung.encodeHeight}`,
    "-c:v", "libx264",
    "-profile:v", "main",
    "-preset", "veryfast",
    "-crf", "21",
    "-b:v", rung.bitrate,
    "-maxrate", rung.maxrate,
    "-bufsize", rung.bufsize,
    "-g", String(gop),
    "-keyint_min", String(gop),
    "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", rung.audio, "-ac", "2", "-ar", "44100",
    "-f", "hls",
    "-hls_time", String(SEG_DURATION),
    "-hls_playlist_type", "vod",
    "-hls_flags", "independent_segments",
    "-hls_segment_filename", path.join(dir, "seg_%05d.ts"),
    "-hls_key_info_file", keyInfoFile,
    path.join(dir, "playlist.m3u8"),
  ]);

  const playlist = fs.readFileSync(path.join(dir, "playlist.m3u8"), "utf8");
  const segments = playlist
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!segments.length) {
    const err = new Error(`rung ${rung.bitrate} produced no segments`);
    err.failureCategory = "OUTPUT_VALIDATION_FAILURE";
    throw err;
  }
  const durationSeconds = (playlist.match(/#EXTINF:([\d.]+)/g) || [])
    .reduce((t, m) => t + parseFloat(m.slice(8)), 0);

  logger.info("vault video rung encoded", { slug, bitrate: rung.bitrate, height: rung.encodeHeight, segments: segments.length });
  return { dir, segments, durationSeconds };
}

/**
 * @param {object} job a claimed hls_transcode_jobs row (job_type='vault_video')
 */
export async function processVaultVideoJob(job) {
  const { id: jobId, slug, source_key: sourceKey, hls_prefix: prefix } = job;
  if (!slug) {
    const err = new Error(`vault video job ${jobId} has no slug`);
    err.failureCategory = "VALIDATION_FAILURE";
    throw err;
  }
  if (!prefix?.startsWith("hls/vault/")) {
    // Guards the upload target: anything else would write segments into a
    // release's tree.
    const err = new Error(`vault video job ${jobId} has a non-vault hls_prefix: ${prefix}`);
    err.failureCategory = "VALIDATION_FAILURE";
    throw err;
  }

  const tmpDir = fs.mkdtempSync(path.join(process.env.SCRATCH_DIR || os.tmpdir(), `vault-video-${jobId}-`));
  try {
    const sourcePath = path.join(tmpDir, "source");
    await pipeline(
      await downloadStream(sourceKey),
      fs.createWriteStream(sourcePath),
      { signal: AbortSignal.timeout(60 * 60 * 1000) }
    );

    const source = await probeSource(sourcePath);
    const rungs = ladderForSourceHeight(source.height);
    logger.info("vault video source probed", { slug, ...source, rungs: rungs.map((r) => r.bitrate) });

    const { key, iv } = deriveKey(slug);
    const keyInfoFile = writeKeyInfoFile(tmpDir, key, iv);

    // Encode everything before uploading anything: a half-uploaded ladder is a
    // manifest advertising rungs that 404.
    const encoded = [];
    for (const rung of rungs) {
      encoded.push({ rung, ...(await encodeRung({ sourcePath, rung, tmpDir, keyInfoFile, fps: source.fps, slug })) });
    }

    const segmentCounts = {};
    const bitrates = [];
    let durationSeconds = 0;
    for (const { rung, dir, segments, durationSeconds: dur } of encoded) {
      for (let i = 0; i < segments.length; i++) {
        const name = `seg_${String(i + 1).padStart(5, "0")}.ts`;
        await upload(`${prefix}${rung.bitrate}/${name}`, fs.readFileSync(path.join(dir, segments[i])), "video/mp2t");
      }
      segmentCounts[rung.bitrate] = segments.length;
      bitrates.push(rung.bitrate);
      durationSeconds = Math.max(durationSeconds, dur);
    }

    // hls_manifests is exactly what the Vault's playback routes read. The
    // release_type marks the row as this pipeline's, which is what lets those
    // routes refuse a manifest that is not ours.
    await markJobComplete(job, {
      slug,
      track_slug: null,
      release_type: "vault",
      hls_prefix: prefix,
      bitrates,
      segment_duration_secs: SEG_DURATION,
      duration_seconds: durationSeconds || source.durationSeconds,
      segment_counts: segmentCounts,
    });

    logger.info("vault video complete", { jobId, slug, rungs: bitrates, durationSeconds });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
