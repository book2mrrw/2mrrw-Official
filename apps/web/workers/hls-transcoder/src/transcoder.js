/**
 * Audio-only AAC-LC / encrypted MPEG-TS worker.
 * Snapshot source once, encode every tier with common static attenuation,
 * verify decoded true peaks, then upload the entire accepted ladder.
 *
 * Keyless (lane-transfers.js): the master's read link, write links under the
 * job's own versioned prefix and the song's content key — the key
 * /api/library/hls/key serves its listeners — come from the website for this
 * job's lease. The host holds no storage key and no master secret.
 */

import path from "path";
import fs from "fs";
import crypto from "crypto";
import { runAudioFfmpeg, measureTruePeak, initialHeadroomGain, nextHeadroomGain, TRUE_PEAK_CEILING_DBTP, MAX_HEADROOM_PASSES } from "./audio-headroom.js";
import { measureAudioRendition } from "./audio-rendition-metadata.js";
import { logger } from "./logger.js";
import { createJobWorkDir, cleanupJobWorkDir } from "./engine/scratch-workspace.js";

/**
 * The audio profile this encoder produces: the headroom-verified AAC ladder
 * with rendition metadata v1 — what production's manifests record as 3, and
 * what the audio successor declares too. A job asking for a newer profile is
 * refused rather than published under a profile it did not get.
 */
export const AUDIO_PROFILE_VERSION = 3;

const SEG_DURATION = 6; // seconds

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Write a temporary key-info file for FFmpeg's -hls_key_info_file flag.
 * Format (three lines):
 *   <key URI that hls.js will fetch>
 *   <local path to the raw key bytes>
 *   <IV as 32-char hex>
 *
 * The key URI is a placeholder — the actual URL is embedded in the playlist
 * by the variant manifest route, not by FFmpeg.
 */
async function writeKeyInfoFile(tmpDir, key, iv) {
  const keyFile    = path.join(tmpDir, "enc.key");
  const keyInfoFile = path.join(tmpDir, "enc.keyinfo");
  const ivHex      = iv.toString("hex");

  fs.writeFileSync(keyFile, key);
  // Key URI placeholder — the variant manifest route replaces this with the real signed URL
  fs.writeFileSync(keyInfoFile, `placeholder\n${keyFile}\n${ivHex}\n`);

  return keyInfoFile;
}

/**
 * Encode and measure one encrypted MPEG-TS rendition without publishing it.
 */
async function transcodeOneBitrate({ sourcePath, gainDb, bitrate, slug, trackSlug, tmpDir, keyInfoFile }) {
  const bitrateDir = path.join(tmpDir, bitrate);
  fs.rmSync(bitrateDir, { recursive: true, force: true });
  fs.mkdirSync(bitrateDir, { recursive: true });

  const segPattern  = path.join(bitrateDir, "seg_%05d.ts");
  const playlistPath = path.join(bitrateDir, "playlist.m3u8");

  const kbps = bitrate.replace("k", "");

  const ffmpegArgs = [
    // Every tier/pass reads the same immutable local source snapshot.
    "-hide_banner", "-nostats", "-xerror", "-y",
    "-i", sourcePath,
    "-map", "0:a:0", "-vn",
    "-af", `volume=${gainDb}dB:precision=double`,

    // Audio codec: AAC-LC, the universally compatible choice for HLS
    "-c:a", "aac",
    "-b:a", `${kbps}k`,
    "-ac", "2",           // stereo
    "-ar", "44100",       // 44.1 kHz — CD quality sample rate

    // Output: HLS with MPEG-TS segments (fMP4 AES-128 is not implemented in FFmpeg)
    "-f", "hls",
    "-hls_time", String(SEG_DURATION),
    "-hls_segment_filename", segPattern,
    "-hls_playlist_type", "vod",
    "-hls_flags", "independent_segments",

    // AES-128 encryption — supported for MPEG-TS
    "-hls_key_info_file", keyInfoFile,

    // Write playlist
    playlistPath,
  ];

  logger.info("ffmpeg start", { bitrate, slug, trackSlug });

  await runAudioFfmpeg(ffmpegArgs);

  const playlistText = fs.readFileSync(playlistPath, "utf8");
  const { segments, metadata } = measureAudioRendition(playlistText,
    (name) => fs.statSync(path.join(bitrateDir, name)).size);
  const segmentPaths = segments.map(({ name }) => path.join(bitrateDir, name));
  const durationSeconds = segments.reduce((total, segment) => total + segment.duration, 0);
  logger.info("ffmpeg done", { bitrate, segments: segmentPaths.length, durationSeconds });
  // The published playlist substitutes a signed key URI. Locally use the same key bytes.
  const verificationPath = path.join(bitrateDir, "verify.m3u8");
  fs.writeFileSync(verificationPath, playlistText.replace('URI="placeholder"', 'URI="../enc.key"'));
  const decodedPeak = await measureTruePeak(verificationPath, { encrypted: true });
  return { segmentPaths, durationSeconds, metadata, decodedPeak };
}

/** Encode and verify before returning metadata for publication. */
export async function transcode({ job, lane }) {
  const { id: jobId, slug, track_slug: trackSlug, source_key: sourceKey, claim_token: claimToken,
          hls_prefix: prefix, bitrates = ["320k", "160k", "96k", "64k"] } = job;
  if (Number(job.target_profile_version || AUDIO_PROFILE_VERSION) > AUDIO_PROFILE_VERSION) {
    const err = new Error(`audio profile ${job.target_profile_version} is newer than this encoder's ${AUDIO_PROFILE_VERSION}`);
    err.failureCategory = "VALIDATION_FAILURE";
    throw err;
  }

  // This lease's prefix and the song's content key, from the website (a refused lease is LeaseLost).
  const opened = await lane.open();
  if (opened.prefix !== prefix) throw new Error(`audio job ${jobId}: the website's prefix ${opened.prefix} is not the job's ${prefix}`);

  // One scratch directory per lease (media-lane.js sweeps dead ones at boot).
  const tmpDir = createJobWorkDir(jobId, claimToken);

  try {
    const key = Buffer.from(opened.encryption.key, "hex");
    const iv = Buffer.from(opened.encryption.iv, "hex");
    const keyInfoFile = await writeKeyInfoFile(tmpDir, key, iv);

    // Download once: retries and tiers must encode identical bytes, never a changing source.
    const sourcePath = path.join(tmpDir, "source");
    await lane.downloadSource(sourcePath, { timeoutMs: 30 * 60 * 1000 });
    const sourceSha256 = await sha256File(sourcePath);
    const sourcePeak = await measureTruePeak(sourcePath);
    let gainDb = initialHeadroomGain(sourcePeak);
    let verified = null;
    for (let pass = 1; pass <= MAX_HEADROOM_PASSES; pass++) {
      const ladder = [];
      for (const bitrate of bitrates) {
        const output = await transcodeOneBitrate({ sourcePath, gainDb, bitrate, slug, trackSlug, tmpDir, keyInfoFile });
        ladder.push({ bitrate, ...output });
      }
      const nextGain = nextHeadroomGain(gainDb, ladder.map(r => r.decodedPeak));
      if (nextGain === null) { verified = ladder; break; }
      logger.info("audio headroom retry", { jobId, pass, gainDb, nextGain });
      gainDb = nextGain;
    }
    if (!verified) throw new Error("Decoded audio exceeds true-peak ceiling after bounded headroom passes");

    const segmentCounts = {};
    const renditionMetadata = {};
    const uploads = [];
    let durationSeconds = 0;
    // No upload begins until every rendition passes the decoded peak gate.
    for (const { bitrate, segmentPaths, durationSeconds: dur, metadata, decodedPeak } of verified) {
      for (let i = 0; i < segmentPaths.length; i++) {
        const segNum = String(i + 1).padStart(5, "0");
        uploads.push({ key: `${prefix}${bitrate}/seg_${segNum}.ts`, file: segmentPaths[i], contentType: "video/mp2t" });
      }
      renditionMetadata[bitrate] = { ...metadata, headroom: {
        version: 1, gain_db: gainDb, ceiling_dbtp: TRUE_PEAK_CEILING_DBTP,
        source_peak_dbtp: Number.isFinite(sourcePeak) ? sourcePeak : null,
        decoded_peak_dbtp: Number.isFinite(decodedPeak) ? decodedPeak : null,
        digital_silence: decodedPeak === -Infinity,
      } };
      segmentCounts[bitrate] = segmentPaths.length;
      durationSeconds = Math.max(durationSeconds, dur);
      logger.info("verified bitrate", { bitrate, gainDb, decodedPeak, segments: segmentPaths.length });
    }
    await lane.uploadFiles(uploads);
    logger.info("verified ladder uploaded", { jobId, gainDb, segments: uploads.length });

    // The manifest audio-worker.js publishes through hls_commit_transcode_job.
    return {
      slug,
      track_slug:            trackSlug ?? null,
      release_type:          job.release_type,
      hls_prefix:            prefix,
      bitrates,
      segment_duration_secs: SEG_DURATION,
      duration_seconds:      durationSeconds,
      segment_counts:        segmentCounts,
      rendition_metadata:    renditionMetadata,
      segment_durations:     Object.fromEntries(Object.entries(renditionMetadata).map(([br, m]) => [br, m.segment_durations])),
      source_metadata:       { source_key: sourceKey, sha256: sourceSha256 },
      transcode_profile_version: AUDIO_PROFILE_VERSION,
    };
  } finally {
    // Always clean up temp files — segments can be 50–200 MB per bitrate
    cleanupJobWorkDir(jobId, claimToken);
  }
}
