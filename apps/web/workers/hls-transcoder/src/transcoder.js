/**
 * Production HLS transcoder.
 *
 * The source object is downloaded exactly once, probed, and routed into one of
 * two explicit pipelines:
 *   audio -> AAC-LC MPEG-TS renditions
 *   video -> source-aware H.264/AAC MPEG-TS renditions
 *
 * The video ladder never upscales and never creates duplicate resolutions.
 * Every rendition is measured after encoding so the manifest API can advertise
 * real bandwidth, resolution, frame rate, and codec metadata.
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import { logger } from "./logger.js";
import { downloadStream, upload } from "./r2.js";
import {
  AUDIO_RENDITION_LABELS,
  buildVideoFfmpegArgs,
  measureBandwidth,
  normalizedVideoSource,
  parseMediaPlaylist,
  segmentDurationForMediaKind,
  selectVideoRenditions,
} from "./rendition-contract.js";

const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_PATH || "ffprobe";
function deriveKey(slug, trackSlug) {
  const secret = process.env.HLS_MASTER_SECRET;
  if (!secret) throw new Error("HLS_MASTER_SECRET is required");

  const canonical = trackSlug ? `${slug}:${trackSlug}` : slug;
  const key = crypto.createHmac("sha256", secret)
    .update(`2mrrw:hls:${canonical}:key`).digest().slice(0, 16);
  const iv = crypto.createHmac("sha256", secret)
    .update(`2mrrw:hls:${canonical}:iv`).digest().slice(0, 16);
  return { key, iv };
}

async function writeKeyInfoFile(tmpDir, key, iv) {
  const keyFile = path.join(tmpDir, "enc.key");
  const keyInfoFile = path.join(tmpDir, "enc.keyinfo");
  fs.writeFileSync(keyFile, key);
  fs.writeFileSync(keyInfoFile, `placeholder\n${keyFile}\n${iv.toString("hex")}\n`);
  return keyInfoFile;
}

async function runProcess(command, args, label) {
  await new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stdout.on("data", () => {});
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited ${code}:\n${stderr.slice(-4000)}`));
    });
  });
}

async function probeSource(sourcePath) {
  const args = ["-v", "error", "-show_streams", "-show_format", "-of", "json", sourcePath];
  const output = await new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffprobe exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("ffprobe returned invalid JSON");
  }
  if (!Array.isArray(parsed.streams) || parsed.streams.length === 0) {
    throw new Error("Source contains no decodable media streams");
  }
  return parsed;
}

function collectSegments(bitrateDir) {
  return fs.readdirSync(bitrateDir)
    .filter((file) => /^seg_\d{5}\.ts$/.test(file))
    .sort()
    .map((file) => path.join(bitrateDir, file));
}

function encodedRenditionResult({ bitrateDir, playlistPath }) {
  const playlist = parseMediaPlaylist(fs.readFileSync(playlistPath, "utf8"));
  const segmentPaths = collectSegments(bitrateDir);
  const bandwidth = measureBandwidth(segmentPaths, playlist.durations, fs.statSync);
  return { ...playlist, ...bandwidth, segmentPaths };
}

async function encodeAudioRendition({
  sourcePath, bitrate, tmpDir, keyInfoFile, segmentDuration, slug, trackSlug,
}) {
  const bitrateDir = path.join(tmpDir, bitrate);
  fs.mkdirSync(bitrateDir, { recursive: true });
  const segmentPattern = path.join(bitrateDir, "seg_%05d.ts");
  const playlistPath = path.join(bitrateDir, "playlist.m3u8");
  const kbps = Number.parseInt(bitrate.replace("k", ""), 10);
  if (!AUDIO_RENDITION_LABELS.includes(bitrate) || !Number.isFinite(kbps)) {
    throw new Error(`Unsupported audio rendition: ${bitrate}`);
  }

  const args = [
    "-y", "-i", sourcePath,
    "-map", "0:a:0", "-map_metadata", "-1", "-vn", "-sn", "-dn",
    "-c:a", "aac", "-profile:a", "aac_low", "-b:a", `${kbps}k`,
    "-ac", "2", "-ar", "44100",
    "-f", "hls", "-hls_time", String(segmentDuration),
    "-hls_segment_filename", segmentPattern,
    "-hls_playlist_type", "vod", "-hls_flags", "independent_segments",
    "-hls_key_info_file", keyInfoFile, playlistPath,
  ];

  logger.info("ffmpeg audio start", { bitrate, slug, trackSlug });
  await runProcess(FFMPEG_BIN, args, `ffmpeg audio ${bitrate}`);
  return encodedRenditionResult({ bitrateDir, playlistPath });
}

async function encodeVideoRendition({
  sourcePath, rendition, source, tmpDir, keyInfoFile, segmentDuration, slug,
}) {
  const bitrateDir = path.join(tmpDir, rendition.label);
  fs.mkdirSync(bitrateDir, { recursive: true });
  const segmentPattern = path.join(bitrateDir, "seg_%05d.ts");
  const playlistPath = path.join(bitrateDir, "playlist.m3u8");
  const args = buildVideoFfmpegArgs({
    inputPath: sourcePath,
    playlistPath,
    segmentPattern,
    keyInfoFile,
    rendition,
    source,
    segmentDuration,
  });

  logger.info("ffmpeg video start", {
    bitrate: rendition.label,
    slug,
    width: rendition.width,
    height: rendition.height,
    frameRate: source.frameRate,
  });
  await runProcess(FFMPEG_BIN, args, `ffmpeg video ${rendition.label}`);
  return encodedRenditionResult({ bitrateDir, playlistPath });
}

async function uploadSegments(prefix, bitrate, segmentPaths) {
  for (let index = 0; index < segmentPaths.length; index++) {
    const segmentNumber = String(index + 1).padStart(5, "0");
    await upload(
      `${prefix}${bitrate}/seg_${segmentNumber}.ts`,
      fs.readFileSync(segmentPaths[index]),
      "video/mp2t"
    );
  }
}

function audioLabelsForJob(job) {
  const requested = Array.isArray(job?.bitrates)
    ? job.bitrates.filter((label) => AUDIO_RENDITION_LABELS.includes(label))
    : [];
  return requested.length ? requested : [...AUDIO_RENDITION_LABELS];
}

/** Main worker entry point. */
export async function transcode({ job }) {
  const {
    id: jobId,
    slug,
    track_slug: trackSlug,
    source_key: sourceKey,
    hls_prefix: prefix,
  } = job;
  if (!jobId || !slug || !sourceKey || !prefix) {
    throw new Error("Transcode job is missing id, slug, source_key, or hls_prefix");
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hls-${jobId}-`));
  const sourcePath = path.join(tmpDir, "source-media");
  try {
    const sourceStream = await downloadStream(sourceKey);
    await pipeline(sourceStream, fs.createWriteStream(sourcePath));

    const probe = await probeSource(sourcePath);
    const videoSource = normalizedVideoSource(probe);
    const hasAudio = probe.streams.some((stream) => stream?.codec_type === "audio");
    if (!videoSource && !hasAudio) {
      throw new Error("Source contains neither a video stream nor an audio stream");
    }

    const mediaKind = videoSource ? "video" : "audio";
    // The worker is the final authority because it probes the actual source.
    // Queue metadata cannot force pathological segment sizes.
    const segmentDuration = segmentDurationForMediaKind(mediaKind);
    const { key, iv } = deriveKey(slug, trackSlug);
    const keyInfoFile = await writeKeyInfoFile(tmpDir, key, iv);
    const segmentCounts = {};
    const segmentDurations = {};
    const renditionMetadata = {};
    let durationSeconds = 0;
    let targetDuration = segmentDuration;
    let outputBitrates = [];

    if (videoSource) {
      const renditions = selectVideoRenditions(videoSource, job.bitrates);
      if (!renditions.length) throw new Error("No compatible video renditions selected");
      outputBitrates = renditions.map((rendition) => rendition.label);

      for (const rendition of renditions) {
        const result = await encodeVideoRendition({
          sourcePath, rendition, source: videoSource, tmpDir, keyInfoFile,
          segmentDuration, slug,
        });
        await uploadSegments(prefix, rendition.label, result.segmentPaths);
        segmentCounts[rendition.label] = result.segmentPaths.length;
        segmentDurations[rendition.label] = result.durations;
        durationSeconds = Math.max(durationSeconds, result.durationSeconds);
        targetDuration = Math.max(targetDuration, result.targetDuration);
        renditionMetadata[rendition.label] = {
          media_kind: "video",
          width: rendition.width,
          height: rendition.height,
          frame_rate: Number(videoSource.frameRate.toFixed(3)),
          video_codec: "h264",
          audio_codec: videoSource.hasAudio ? "aac" : null,
          codecs: videoSource.hasAudio ? `${rendition.codec},mp4a.40.2` : rendition.codec,
          video_bitrate_kbps: rendition.videoKbps,
          audio_bitrate_kbps: videoSource.hasAudio ? rendition.audioKbps : null,
          average_bandwidth: result.averageBandwidth,
          peak_bandwidth: result.peakBandwidth,
          total_bytes: result.totalBytes,
        };
      }
    } else {
      outputBitrates = audioLabelsForJob(job);
      for (const bitrate of outputBitrates) {
        const result = await encodeAudioRendition({
          sourcePath, bitrate, tmpDir, keyInfoFile, segmentDuration, slug, trackSlug,
        });
        await uploadSegments(prefix, bitrate, result.segmentPaths);
        segmentCounts[bitrate] = result.segmentPaths.length;
        segmentDurations[bitrate] = result.durations;
        durationSeconds = Math.max(durationSeconds, result.durationSeconds);
        targetDuration = Math.max(targetDuration, result.targetDuration);
        const kbps = Number.parseInt(bitrate, 10);
        renditionMetadata[bitrate] = {
          media_kind: "audio",
          audio_codec: "aac",
          codecs: "mp4a.40.2",
          sample_rate: 44100,
          channels: 2,
          audio_bitrate_kbps: kbps,
          average_bandwidth: result.averageBandwidth,
          peak_bandwidth: result.peakBandwidth,
          total_bytes: result.totalBytes,
        };
      }
    }

    logger.info("transcode complete", {
      jobId, slug, trackSlug, mediaKind, bitrates: outputBitrates, durationSeconds,
    });

    return {
      slug,
      track_slug: trackSlug ?? null,
      release_type: job.release_type,
      hls_prefix: prefix,
      bitrates: outputBitrates,
      segment_duration_secs: targetDuration,
      duration_seconds: durationSeconds,
      segment_counts: segmentCounts,
      segment_durations: segmentDurations,
      media_kind: mediaKind,
      rendition_metadata: renditionMetadata,
      source_metadata: videoSource
        ? {
            width: videoSource.width,
            height: videoSource.height,
            frame_rate: Number(videoSource.frameRate.toFixed(3)),
            video_codec: videoSource.sourceVideoCodec,
            audio_codec: videoSource.sourceAudioCodec,
            has_audio: videoSource.hasAudio,
          }
        : {
            audio_codec: probe.streams.find((stream) => stream?.codec_type === "audio")?.codec_name || null,
          },
      transcode_profile_version: 3,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
