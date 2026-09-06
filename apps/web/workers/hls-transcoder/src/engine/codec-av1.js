/**
 * CodecEngine — AV1 path (libsvtav1). Encodes one rendition to UNENCRYPTED
 * fMP4/CMAF HLS segments, mirroring codec-avc.js's shape. Encryption is a
 * separate, later stage (PackagingEngine).
 *
 * Scope note: this stage handles standard AV1 encoding (8-bit SDR and,
 * pixel-format-wise, 10-bit) — genuine HDR color-metadata passthrough and
 * the HDR->SDR tone-map filter chain are a separate, later stage (Part D.6)
 * and not yet implemented here. pix_fmt is selected from rendition.bitDepth
 * (8 -> yuv420p, 10 -> yuv420p10le) so this function is already correct for
 * when that later stage starts producing real 10-bit rendition entries.
 *
 * Flags verified against a real encode on the production video machine:
 * SVT-AV1 accepted preset 6/crf 34 (with a benign internal remap warning,
 * "Preset M6 is mapped to M7" — non-fatal, SVT-AV1's own normalization, not
 * a bug in this code) and separately confirmed genuine 10-bit output
 * (`pix_fmt=yuv420p10le`) with preset 8.
 */
import { spawn } from "child_process";
import path from "path";

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";

/**
 * @param {object} params
 * @param {string} params.sourcePath
 * @param {string} params.outputDir
 * @param {object} params.rendition - one entry from RenditionPlanner.planRenditions (codecFamily must be "av1")
 * @param {number} [params.segmentDurationSeconds]
 * @param {Function} [params.spawnFn] - injectable for tests
 */
export async function encodeAv1Rendition({ sourcePath, outputDir, rendition, segmentDurationSeconds = 6, spawnFn = spawn }) {
  if (rendition.codecFamily !== "av1") {
    throw new Error(`encodeAv1Rendition: expected codecFamily "av1", got "${rendition.codecFamily}"`);
  }

  const playlistPath = path.join(outputDir, "playlist.m3u8");
  const gopFrames = Math.max(1, Math.round(rendition.frameRate * segmentDurationSeconds));
  const pixelFormat = rendition.bitDepth === 10 ? "yuv420p10le" : "yuv420p";

  const args = [
    "-hide_banner", "-loglevel", "error",
    "-i", sourcePath,
    "-vf", `scale=${rendition.width}:${rendition.height}`,
    "-c:v", "libsvtav1",
    "-preset", String(rendition.preset),
    "-crf", String(rendition.crf),
    "-pix_fmt", pixelFormat,
    "-g", String(gopFrames),
    "-keyint_min", String(gopFrames),
    "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    "-f", "hls",
    "-hls_time", String(segmentDurationSeconds),
    "-hls_segment_type", "fmp4",
    "-hls_fmp4_init_filename", "init.mp4",
    "-hls_segment_filename", path.join(outputDir, "seg_%05d.m4s"),
    "-hls_flags", "independent_segments",
    "-hls_playlist_type", "vod",
    playlistPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawnFn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrOutput = "";
    proc.stderr?.on("data", (chunk) => {
      stderrOutput += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        const err = new Error(`FFmpeg exited ${code} encoding ${rendition.resolutionLabel} (av1): ${stderrOutput.slice(-2000)}`);
        err.failureCategory = "FFMPEG_FAILURE";
        reject(err);
        return;
      }
      resolve({ playlistPath, outputDir, args });
    });
    proc.on("error", (err) => {
      err.failureCategory = "FFMPEG_FAILURE";
      reject(err);
    });
  });
}
