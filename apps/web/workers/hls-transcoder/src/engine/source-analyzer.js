/**
 * SourceAnalyzer — one ffprobe pass, parsed into the canonical
 * source_analysis shape (matches audio_visual_asset_versions.source_analysis
 * jsonb exactly). Pure data extraction only — no judgment calls about
 * whether the source is acceptable; that's SourceQualityControl's job.
 *
 * parseSourceAnalysis is a pure function over an already-decoded ffprobe
 * JSON object, fully unit-testable with fixture data — no ffprobe binary
 * needed. runSourceAnalyzer is the thin wrapper that actually invokes
 * ffprobe; its `exec` dependency is injectable so callers can test the full
 * invoke-then-parse path without a real ffprobe binary too.
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function parseFraction(value) {
  if (!value || typeof value !== "string") return null;
  const [num, den] = value.split("/").map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

/** pix_fmt names encode bit depth as a numeric suffix (yuv420p10le -> 10); no suffix means 8-bit. */
function parseBitDepth(pixFmt) {
  if (!pixFmt) return 8;
  const match = pixFmt.match(/p(\d+)(le|be)?$/);
  return match ? Number(match[1]) : 8;
}

function parseChromaFormat(pixFmt) {
  if (!pixFmt) return null;
  if (pixFmt.startsWith("yuv444") || pixFmt.startsWith("yuvj444")) return "4:4:4";
  if (pixFmt.startsWith("yuv422") || pixFmt.startsWith("yuvj422")) return "4:2:2";
  if (pixFmt.startsWith("yuv420") || pixFmt.startsWith("yuvj420")) return "4:2:0";
  return null;
}

function findSideData(stream, type) {
  return (stream.side_data_list || []).find((sd) => sd.side_data_type === type) || null;
}

/** Genuine HDR signaling only — BT.2020 primaries plus a PQ or HLG transfer function. Never inferred from filename. */
function isHdrSignaled({ colorPrimaries, colorTransfer }) {
  const isPq = colorTransfer === "smpte2084";
  const isHlg = colorTransfer === "arib-std-b67";
  const isBt2020 = colorPrimaries === "bt2020";
  return Boolean(isBt2020 && (isPq || isHlg));
}

function hdrModeFromSignaling(signaling) {
  if (!isHdrSignaled(signaling)) return "sdr";
  return signaling.colorTransfer === "arib-std-b67" ? "hlg" : "hdr10";
}

/** Parse raw ffprobe JSON (already-decoded object, not a string) into the canonical source_analysis shape. */
export function parseSourceAnalysis(ffprobeJson) {
  const streams = ffprobeJson?.streams || [];
  const format = ffprobeJson?.format || {};
  const videoStream = streams.find((s) => s.codec_type === "video");
  const audioStream = streams.find((s) => s.codec_type === "audio");

  if (!videoStream) {
    throw new Error("parseSourceAnalysis: no video stream found in ffprobe output");
  }

  const rFrameRate = parseFraction(videoStream.r_frame_rate);
  const avgFrameRate = parseFraction(videoStream.avg_frame_rate);
  const frameRate = avgFrameRate || rFrameRate;
  // A meaningfully different r_frame_rate vs avg_frame_rate is the standard
  // ffprobe-based heuristic for variable frame timing — an approximation,
  // documented as such, not a certainty.
  const frameRateMode =
    rFrameRate && avgFrameRate && Math.abs(rFrameRate - avgFrameRate) > 0.01 ? "variable" : "constant";

  const colorPrimaries = videoStream.color_primaries || null;
  const colorTransfer = videoStream.color_transfer || null;

  const masteringSideData = findSideData(videoStream, "Mastering display metadata");
  const contentLightSideData = findSideData(videoStream, "Content light level metadata");
  const rotationSideData = findSideData(videoStream, "Displaymatrix");

  const durationSeconds = Number(videoStream.duration ?? format.duration) || null;
  const rotationTag = Number(videoStream.tags?.rotate);

  return {
    container: format.format_name || null,
    videoCodec: videoStream.codec_name || null,
    profile: videoStream.profile || null,
    level: videoStream.level ?? null,
    width: videoStream.width ?? null,
    height: videoStream.height ?? null,
    displayAspectRatio: videoStream.display_aspect_ratio || null,
    pixelAspectRatio: videoStream.sample_aspect_ratio || null,
    frameRate,
    frameRateMode,
    durationSeconds,
    bitDepth: parseBitDepth(videoStream.pix_fmt),
    pixelFormat: videoStream.pix_fmt || null,
    chromaFormat: parseChromaFormat(videoStream.pix_fmt),
    colorPrimaries,
    colorTransfer,
    colorMatrix: videoStream.color_space || null,
    colorRange: videoStream.color_range || null,
    hdrMode: hdrModeFromSignaling({ colorPrimaries, colorTransfer }),
    masteringMetadata: masteringSideData ? { ...masteringSideData } : null,
    maxCLL: contentLightSideData?.max_content ?? null,
    maxFALL: contentLightSideData?.max_average ?? null,
    rotationDegrees: rotationSideData?.rotation ?? (Number.isFinite(rotationTag) ? rotationTag : 0),
    audioCodec: audioStream?.codec_name || null,
    audioSampleRate: audioStream ? Number(audioStream.sample_rate) || null : null,
    audioChannels: audioStream?.channels ?? null,
  };
}

async function defaultExec(bin, args) {
  const { stdout } = await execFileAsync(bin, args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

/** Invoke ffprobe against a real file/stream and parse its output. `exec` is injectable for tests. */
export async function runSourceAnalyzer(inputPath, { exec = defaultExec } = {}) {
  const stdout = await exec(process.env.FFPROBE_PATH || "ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ]);
  return parseSourceAnalysis(JSON.parse(stdout));
}
