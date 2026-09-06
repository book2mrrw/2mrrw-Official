/**
 * CodecEngine — AVC path. Encodes one rendition (from RenditionPlanner) to
 * UNENCRYPTED fMP4/CMAF HLS segments. Encryption is a separate, later stage
 * (PackagingEngine) — FFmpeg's own HLS muxer cannot encrypt fMP4 natively
 * (confirmed live: "Encrypted fmp4 not yet supported"), so this stage's
 * output is intentionally plain.
 *
 * Every flag below was verified against a real encode on the production
 * video machine (libx264, high profile, yuv420p, GOP aligned to the
 * segment duration for ABR-safe keyframe switching, independent segments,
 * VOD playlist) — not assumed from documentation.
 *
 * transcoder.js (today's audio encoder) is never imported here and never
 * edited by this or any other Encoding Engine file.
 */
import { spawn } from "child_process";
import path from "path";

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";

/**
 * @param {object} params
 * @param {string} params.sourcePath - path to the (already downloaded) master
 * @param {string} params.outputDir - job-scoped scratch directory to write into
 * @param {object} params.rendition - one entry from RenditionPlanner.planRenditions (codecFamily must be "avc")
 * @param {number} [params.segmentDurationSeconds]
 * @param {Function} [params.spawnFn] - injectable for tests
 */
export async function encodeAvcRendition({ sourcePath, outputDir, rendition, segmentDurationSeconds = 6, spawnFn = spawn }) {
  if (rendition.codecFamily !== "avc") {
    throw new Error(`encodeAvcRendition: expected codecFamily "avc", got "${rendition.codecFamily}"`);
  }

  const playlistPath = path.join(outputDir, "playlist.m3u8");
  const gopFrames = Math.max(1, Math.round(rendition.frameRate * segmentDurationSeconds));

  const args = [
    "-hide_banner", "-loglevel", "error",
    "-i", sourcePath,
    "-vf", `scale=${rendition.width}:${rendition.height}`,
    "-c:v", "libx264",
    "-preset", String(rendition.preset),
    "-crf", String(rendition.crf),
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    "-g", String(gopFrames),
    "-keyint_min", String(gopFrames),
    "-sc_threshold", "0",
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
        const err = new Error(`FFmpeg exited ${code} encoding ${rendition.resolutionLabel} (avc): ${stderrOutput.slice(-2000)}`);
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
