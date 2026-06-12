/**
 * Phase 5.2 Stage 3 — Server-side AAC-LC transcode for stream renditions.
 * Requires ffmpeg on PATH or FFMPEG_PATH env.
 */

import { spawn } from "child_process";
import { STREAM_BITRATE_KBPS } from "@/lib/media/stream-asset-schema";

/** Default upload transcode bitrate (kbps) — AAC-LC with +faststart. */
export const STREAM_UPLOAD_BITRATE_KBPS = STREAM_BITRATE_KBPS.hq;

function resolveFfmpegBinary() {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<void>}
 */
function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

/**
 * Transcode a local master file to AAC-LC .m4a with moov atom at front.
 *
 * @param {string} inputPath — local filesystem path to master audio
 * @param {string} outputPath — local filesystem path for stream output
 * @param {{ bitrateKbps?: number }} [options]
 */
export async function transcodeMasterToStreamFile(inputPath, outputPath, options = {}) {
  const bitrateKbps = options.bitrateKbps ?? STREAM_UPLOAD_BITRATE_KBPS;
  const ffmpeg = resolveFfmpegBinary();

  await runCommand(ffmpeg, [
    "-y",
    "-i",
    inputPath,
    "-c:a",
    "aac",
    "-b:a",
    `${bitrateKbps}k`,
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

/**
 * @returns {Promise<boolean>}
 */
export async function isFfmpegAvailable() {
  try {
    await runCommand(resolveFfmpegBinary(), ["-version"]);
    return true;
  } catch {
    return false;
  }
}
