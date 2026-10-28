/**
 * Phase 5.2 Stage 3 — Server-side AAC-LC transcode for stream renditions.
 * Requires ffmpeg on PATH or FFMPEG_PATH env.
 */

import { spawn } from "child_process";
import { STREAM_BITRATE_KBPS } from "@/lib/media/stream-asset-schema";
import { runAudioFfmpeg, measureTruePeak, initialHeadroomGain, nextHeadroomGain,
  MAX_HEADROOM_PASSES } from '../../../workers/hls-transcoder/src/audio-headroom.js';

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
  const sourcePeak = await measureTruePeak(inputPath);
  let gainDb = initialHeadroomGain(sourcePeak);
  for (let pass = 0; pass < MAX_HEADROOM_PASSES; pass++) {
    // Preserve the master's dynamics. A loudnorm pre-encode TP setting does
    // not constrain AAC reconstruction peaks or its internal upsampled rate.
    await runAudioFfmpeg(['-hide_banner', '-nostats', '-xerror', '-y',
      '-i', inputPath, '-map', '0:a:0', '-vn',
      '-af', `volume=${gainDb}dB:precision=double`,
      '-c:a', 'aac', '-b:a', `${bitrateKbps}k`, '-ac', '2', '-ar', '44100',
      '-movflags', '+faststart', outputPath]);
    const decodedPeak = await measureTruePeak(outputPath);
    const nextGain = nextHeadroomGain(gainDb, [decodedPeak]);
    if (nextGain === null) return { gainDb, decodedPeak };
    gainDb = nextGain;
  }
  throw new Error('Progressive AAC exceeds decoded true-peak ceiling after bounded headroom passes');
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
