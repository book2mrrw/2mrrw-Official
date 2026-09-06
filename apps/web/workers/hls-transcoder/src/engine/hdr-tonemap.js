/**
 * HDR -> SDR tone-map path (Part D.6). Produces the "tone-map-derived SDR AV1
 * ladder" that RenditionPlanner marks `requiresToneMap: true` for a genuinely
 * HDR source, mirroring codec-av1.js's own encode shape exactly (same
 * spawnFn injection, same fMP4/CMAF HLS output, same failure-categorization
 * convention) so a future orchestrator can dispatch to this exactly like any
 * other codec engine.
 *
 * ============================================================
 * WHY THIS USES libplacebo, NOT zscale+tonemap
 * ============================================================
 * The textbook zscale-based chain —
 *   zscale=t=linear:npl=<peak>, format=gbrpf32le, zscale=p=bt709,
 *   tonemap=tonemap=hable:desat=0, zscale=t=bt709:m=bt709:r=tv, format=yuv420p
 * — was CONFIRMED BLOCKED on the mwader/static-ffmpeg:7.1 image this worker
 * used previously: every attempt to reach `t=linear` (the required first
 * step) failed identically with `code 3074: no path between colorspaces`,
 * isolated via 7 systematic tests against the real production video machine
 * (ruled out: input color-metadata tagging, source bit depth, and the
 * specific primaries/matrix combination — see git history on this file for
 * the full original evidence trail). Root cause was never fully diagnosed
 * (would have required inspecting that image's exact bundled libzimg
 * build), and no non-linear-input mode or hardware fallback existed in that
 * image either (`tonemap_opencl` — "Unknown filter").
 *
 * Rather than chase a libzimg patch, this switches the whole tone-map path
 * to `libplacebo`, which never needs a linear-transfer zscale conversion at
 * all — it does its own colorspace handling internally and tone-maps
 * directly, sidestepping that bug class entirely rather than depending on
 * it being fixed. It's also the actively-recommended modern approach
 * (ITU-R BT.2390 curve, dynamic peak detection, better gamut mapping than
 * the old zscale+tonemap=hable chain).
 *
 * ============================================================
 * INFRASTRUCTURE THIS REQUIRES (see this worker's Dockerfile)
 * ============================================================
 * mwader/static-ffmpeg does NOT build libplacebo at all (confirmed against
 * its own README — listed under "possible things to add", not shipped in
 * any tag). The Dockerfile now pulls a BtbN/FFmpeg-Builds `linux64-gpl`
 * static release instead — confirmed for real by downloading that exact
 * release asset and running `strings` on the binary: its embedded configure
 * string includes `--enable-libplacebo --enable-vulkan --enable-libzimg`
 * plus every codec this worker already depends on (libx264, libx265,
 * libsvtav1, libaom, libdav1d, libvmaf). The runtime stage installs
 * `libvulkan1` (the loader ffmpeg dlopens — confirmed via `objdump -p` that
 * it is NOT a link-time dependency of the ffmpeg binary, so it must be
 * present as a system package) and `mesa-vulkan-drivers` (the lavapipe
 * software ICD — these Fly machines have no GPU, so tone-mapping runs on a
 * CPU-backed Vulkan device; slower than real hardware, but correct).
 *
 * ============================================================
 * NOT YET CONFIRMED LIVE
 * ============================================================
 * Everything above about the BtbN binary's enabled libraries was verified
 * directly (downloaded the real release asset, inspected it with `strings`/
 * `objdump`). The actual ffmpeg invocation below — Vulkan device
 * initialization against lavapipe, and the libplacebo filter chain itself —
 * has NOT been run against a real machine yet (no Docker/Linux runtime was
 * available to do that from where this was written). Before trusting this
 * in production: rebuild the image, run it against a real HDR source on the
 * actual Fly video machine (or locally with Docker), and confirm (a) the
 * Vulkan device actually initializes on lavapipe, (b) ffprobe on the output
 * reads back real SDR-tagged (bt709) metadata, and (c) the image is not
 * washed out / crushed. Per this project's own standing policy, do not
 * assume this works from documentation alone — confirm it live, the same
 * way every other engine in this pipeline was confirmed.
 */
import { spawn } from "child_process";
import path from "path";

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";

// bt.2390 is libplacebo's own recommended default tone-mapping curve (the
// ITU broadcast standard) — a safer default than hand-picking hable/mobius/
// reinhard without a real reference display to judge against.
const TONEMAPPING_CURVE = "bt.2390";

/**
 * @param {object} params
 * @param {string} params.sourcePath
 * @param {string} params.outputDir
 * @param {object} params.rendition - one entry from RenditionPlanner.planRenditions; must have codecFamily "av1" and requiresToneMap true
 * @param {number} [params.segmentDurationSeconds]
 * @param {Function} [params.spawnFn] - injectable for tests
 */
export async function tonemapHdrToSdr({
  sourcePath, outputDir, rendition, segmentDurationSeconds = 6, spawnFn = spawn,
}) {
  if (rendition.codecFamily !== "av1") {
    throw new Error(`tonemapHdrToSdr: expected codecFamily "av1", got "${rendition.codecFamily}"`);
  }
  if (!rendition.requiresToneMap) {
    throw new Error("tonemapHdrToSdr: rendition.requiresToneMap must be true — this is the HDR->SDR tone-map path, not a plain encode");
  }

  const playlistPath = path.join(outputDir, "playlist.m3u8");
  const gopFrames = Math.max(1, Math.round(rendition.frameRate * segmentDurationSeconds));
  const pixelFormat = rendition.bitDepth === 10 ? "yuv420p10le" : "yuv420p";

  const videoFilters = [
    `scale=${rendition.width}:${rendition.height}`,
    `libplacebo=tonemapping=${TONEMAPPING_CURVE}:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=${pixelFormat}`,
  ];

  const args = [
    "-hide_banner", "-loglevel", "error",
    "-init_hw_device", "vulkan=vk0",
    "-filter_hw_device", "vk0",
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
        const err = new Error(`FFmpeg exited ${code} tone-mapping ${rendition.resolutionLabel} (av1): ${stderrOutput.slice(-2000)}`);
        // Vulkan/lavapipe failing to initialize is a distinct, actionable
        // infrastructure problem (missing mesa-vulkan-drivers, no ICD
        // registered, etc.) — worth surfacing separately from an ordinary
        // encode failure rather than burying it in one generic bucket.
        err.failureCategory = /vulkan/i.test(stderrOutput) ? "TONEMAP_VULKAN_UNAVAILABLE" : "FFMPEG_FAILURE";
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
