/**
 * Cover art renditions: silent looping H.264 MP4s of one animated cover.
 *
 * - square-1080 / square-720 / square-480: the centre square, never upscaled
 *   (a 720 source gets 720 and 480 only). What the website and app cards play.
 * - tall: the centre 3:4 (at most 810x1080), the iPhone lock screen's animated
 *   artwork shape, so the app no longer exports it on the phone.
 *
 * Every rendition drops the audio track (covers always play muted, and on
 * iPhone a muted video's audio pipeline still costs the media daemon), keeps
 * the source frame rate up to 30 fps, and puts the index first (faststart) so
 * playback starts from the first bytes. No rendition carries more data per
 * pixel than its source: re-encoding a lightly encoded cover with more bits
 * only makes a bigger file of the same picture.
 *
 * Changing these settings? Bump COVER_ART_RECIPE in
 * src/lib/cover-art/delivery.js so existing covers are made again.
 */

import { spawn } from "node:child_process";

const SQUARES = [
  { id: "square-1080", size: 1080, crf: 22, maxrate: "3000k" },
  { id: "square-720", size: 720, crf: 23, maxrate: "1600k" },
  { id: "square-480", size: 480, crf: 24, maxrate: "800k" },
];
const TALL = { id: "tall", height: 1080, crf: 22, maxrate: "2600k" };
const MAX_FPS = 30;
const MIN_KBPS = 120;

const even = (value) => Math.floor(value / 2) * 2;

/**
 * Which renditions a source of this size gets, with their exact output sizes
 * and bitrate ceilings (never above the source's own bitrate for that share
 * of its pixels).
 */
export function planRenditions({ width, height, bitRate = 0 }) {
  const side = even(Math.min(width, height));
  if (side < 2) throw new Error(`unusable source size ${width}x${height}`);
  const plan = SQUARES.filter(({ size }) => size <= side).map((r) => ({ ...r, width: r.size, height: r.size }));
  // A source smaller than 480 still gets one square at its own size.
  if (!plan.length) plan.push({ ...SQUARES.at(-1), id: `square-${side}`, width: side, height: side });
  const tallHeight = even(Math.min(TALL.height, side));
  plan.push({ ...TALL, width: even((tallHeight * 3) / 4), height: tallHeight });
  const sourceKbps = bitRate / 1000;
  return plan.map((r) => {
    if (!sourceKbps) return r;
    const share = Math.min(1, (r.width * r.height) / (width * height));
    const ceiling = Math.max(MIN_KBPS, Math.round(sourceKbps * share));
    return { ...r, maxrate: `${Math.min(parseInt(r.maxrate, 10), ceiling)}k` };
  });
}

/** ffmpeg arguments for one rendition: centre crop to its shape, scale, silent H.264, faststart. */
export function renditionArgs(rendition, { input, output, fps }) {
  const ratio = rendition.width / rendition.height;
  // Centre crop to the rendition's aspect from the source, then scale.
  const crop = `crop='min(iw,ih*${ratio})':'min(ih,iw/${ratio})'`;
  const filters = [crop, `scale=${rendition.width}:${rendition.height}:flags=lanczos`, "setsar=1"];
  if (fps > MAX_FPS) filters.push(`fps=${MAX_FPS}`);
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-map", "0:v:0", "-an", "-sn", "-dn",
    "-vf", filters.join(","),
    "-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-crf", String(rendition.crf), "-maxrate", rendition.maxrate, "-bufsize", `${parseInt(rendition.maxrate, 10) * 2}k`,
    "-tag:v", "avc1", "-movflags", "+faststart",
    "-map_metadata", "-1",
    output,
  ];
}

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${binary} exited ${code}: ${stderr.trim().slice(-400)}`));
    });
  });
}

/** The first video stream's size, frame rate and bitrate (0 when unknown). */
export async function probe(file, { ffprobe = "ffprobe" } = {}) {
  const out = await run(ffprobe, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,bit_rate", "-of", "json", file,
  ]);
  const stream = JSON.parse(out).streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error("the cover has no video stream");
  const [num, den] = String(stream.avg_frame_rate || "30/1").split("/").map(Number);
  return { width: stream.width, height: stream.height, fps: den ? num / den : 30, bitRate: Number(stream.bit_rate) || 0 };
}

/** Encode every rendition of `input` into `outputDir`; returns the plan with each file path. */
export async function transcodeCover(input, outputDir, { ffmpeg = "ffmpeg", ffprobe = "ffprobe" } = {}) {
  const source = await probe(input, { ffprobe });
  const plan = planRenditions(source);
  const made = [];
  for (const rendition of plan) {
    const output = `${outputDir}/${rendition.id}.mp4`;
    await run(ffmpeg, renditionArgs(rendition, { input, output, fps: source.fps }));
    made.push({ id: rendition.id, width: rendition.width, height: rendition.height, file: output });
  }
  return { source, renditions: made };
}
