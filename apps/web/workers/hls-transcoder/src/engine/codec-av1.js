/**
 * CodecEngine — AV1 path (libsvtav1). Encodes one rendition to UNENCRYPTED
 * fMP4/CMAF HLS segments, mirroring codec-avc.js's shape. Encryption is a
 * separate, later stage (PackagingEngine).
 *
 * HDR color metadata (primaries/transfer/matrix/range) is tagged via a
 * `zscale` metadata pass, NOT via plain `-color_primaries`/`-color_trc`/
 * `-colorspace` output flags — confirmed live that those flags alone do not
 * reliably stamp output metadata (ffprobe read back "unknown" for
 * primaries/transfer despite passing them directly to libx264), while an
 * explicit zscale in/out tag pass (matching input/output values, so it's a
 * metadata stamp rather than an actual conversion) correctly produced
 * `color_primaries=bt2020`, `color_transfer=smpte2084`,
 * `color_space=bt2020nc` on a real AV1-encoded file.
 *
 * HDR->SDR tone-mapping is NOT implemented here — see hdr-tonemap.js, which
 * handles `requiresToneMap: true` renditions via libplacebo instead (this
 * file's zscale metadata-tag approach was never usable for tone-mapping
 * itself; only for stamping HDR metadata, which is all genuine HDR-preserving
 * encoding — this file's job — ever needed).
 */
import { spawn } from "child_process";
import path from "path";

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";

// Confirmed live via `ffmpeg -h filter=zscale` against the production build —
// these are the filter's own real enum values, not assumed from docs.
const ZSCALE_PRIMARIES = { bt709: 1, bt2020: 9 };
const ZSCALE_TRANSFER = { bt709: 1, smpte2084: 16, "arib-std-b67": 18 };
const ZSCALE_MATRIX = { bt709: 1, bt2020nc: 9, bt2020c: 10 };
const ZSCALE_RANGE = { tv: 0, pc: 1 };

function zscaleValue(table, name, fallback) {
  return name && table[name] !== undefined ? table[name] : fallback;
}

/**
 * Build the zscale metadata-tag filter segment for a genuine HDR rendition.
 * Input and output are set to the SAME values (a stamp, not a conversion) —
 * deterministic regardless of what FFmpeg's own container-metadata
 * auto-detection might otherwise guess.
 */
function hdrTagFilter(sourceAnalysis) {
  const primaries = zscaleValue(ZSCALE_PRIMARIES, sourceAnalysis?.colorPrimaries, ZSCALE_PRIMARIES.bt2020);
  const transfer = zscaleValue(ZSCALE_TRANSFER, sourceAnalysis?.colorTransfer, ZSCALE_TRANSFER.smpte2084);
  const matrix = zscaleValue(ZSCALE_MATRIX, sourceAnalysis?.colorMatrix, ZSCALE_MATRIX.bt2020nc);
  const range = zscaleValue(ZSCALE_RANGE, sourceAnalysis?.colorRange, ZSCALE_RANGE.tv);

  return `zscale=pin=${primaries}:tin=${transfer}:min=${matrix}:rin=${range}:p=${primaries}:t=${transfer}:m=${matrix}:r=${range}`;
}

/**
 * @param {object} params
 * @param {string} params.sourcePath
 * @param {string} params.outputDir
 * @param {object} params.rendition - one entry from RenditionPlanner.planRenditions (codecFamily must be "av1")
 * @param {object} [params.sourceAnalysis] - SourceAnalyzer output; required to tag real HDR color metadata correctly
 * @param {number} [params.segmentDurationSeconds]
 * @param {Function} [params.spawnFn] - injectable for tests
 */
export async function encodeAv1Rendition({
  sourcePath, outputDir, rendition, sourceAnalysis, segmentDurationSeconds = 6, spawnFn = spawn,
}) {
  if (rendition.codecFamily !== "av1") {
    throw new Error(`encodeAv1Rendition: expected codecFamily "av1", got "${rendition.codecFamily}"`);
  }
  const isHdr = Boolean(rendition.hdrMode && rendition.hdrMode !== "sdr" && !rendition.requiresToneMap);

  const playlistPath = path.join(outputDir, "playlist.m3u8");
  const gopFrames = Math.max(1, Math.round(rendition.frameRate * segmentDurationSeconds));
  const pixelFormat = rendition.bitDepth === 10 ? "yuv420p10le" : "yuv420p";

  const videoFilters = [`scale=${rendition.width}:${rendition.height}`];
  if (isHdr) videoFilters.push(hdrTagFilter(sourceAnalysis));

  const args = [
    "-hide_banner", "-loglevel", "error",
    "-i", sourcePath,
    "-vf", videoFilters.join(","),
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
