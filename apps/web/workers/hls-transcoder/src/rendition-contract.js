/**
 * Pure HLS rendition contract shared by the worker and its deterministic tests.
 * No environment variables, storage clients, or process side effects belong here.
 */

export const AUDIO_RENDITION_LABELS = Object.freeze(["320k", "160k", "96k"]);
export const AUDIO_SEGMENT_DURATION_SECONDS = 2;
export const VIDEO_SEGMENT_DURATION_SECONDS = 4;

export function segmentDurationForMediaKind(mediaKind) {
  if (mediaKind === "audio") return AUDIO_SEGMENT_DURATION_SECONDS;
  if (mediaKind === "video") return VIDEO_SEGMENT_DURATION_SECONDS;
  throw new Error(`Unsupported HLS media kind: ${mediaKind}`);
}

export const VIDEO_RENDITIONS = Object.freeze([
  Object.freeze({
    label: "4000k",
    maxWidth: 1920,
    maxHeight: 1080,
    videoKbps: 4000,
    audioKbps: 160,
    h264Level: "4.0",
    codec: "avc1.640028",
  }),
  Object.freeze({
    label: "2000k",
    maxWidth: 1280,
    maxHeight: 720,
    videoKbps: 2000,
    audioKbps: 160,
    h264Level: "3.1",
    codec: "avc1.64001f",
  }),
  Object.freeze({
    label: "1000k",
    maxWidth: 854,
    maxHeight: 480,
    videoKbps: 1000,
    audioKbps: 128,
    h264Level: "3.0",
    codec: "avc1.64001e",
  }),
  Object.freeze({
    label: "720k",
    maxWidth: 640,
    maxHeight: 360,
    videoKbps: 720,
    audioKbps: 96,
    h264Level: "3.0",
    codec: "avc1.64001e",
  }),
]);

const VIDEO_BY_LABEL = new Map(VIDEO_RENDITIONS.map((item) => [item.label, item]));

export function isVideoRenditionLabel(label) {
  return VIDEO_BY_LABEL.has(String(label || ""));
}

export function parseFrameRate(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  if (raw.includes("/")) {
    const [numerator, denominator] = raw.split("/").map(Number);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
    return numerator / denominator;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function normalizedVideoSource(probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream?.codec_type === "video");
  const audio = streams.find((stream) => stream?.codec_type === "audio");
  if (!video) return null;

  let width = Number(video.width) || 0;
  let height = Number(video.height) || 0;
  const rotation = Number(
    video.rotation ??
    video.tags?.rotate ??
    video.side_data_list?.find((item) => Number.isFinite(Number(item?.rotation)))?.rotation ??
    0
  );
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  if (width < 2 || height < 2) return null;

  const rawRate = video.avg_frame_rate || video.r_frame_rate || "";
  const measuredRate = parseFrameRate(rawRate) || 30;
  const frameRate = Math.max(1, Math.min(30, measuredRate));
  const frameRateExpression = measuredRate > 30
    ? "30"
    : rawRate && parseFrameRate(rawRate) > 0
      ? rawRate
      : String(Number(frameRate.toFixed(3)));

  return {
    width,
    height,
    frameRate,
    frameRateExpression,
    hasAudio: Boolean(audio),
    sourceVideoCodec: video.codec_name || null,
    sourceAudioCodec: audio?.codec_name || null,
  };
}

export function fitWithin(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const even = (value) => Math.max(2, Math.floor(value / 2) * 2);
  return {
    width: even(sourceWidth * scale),
    height: even(sourceHeight * scale),
  };
}

/**
 * Select a descending video ladder without upscaling or duplicate resolutions.
 * If a caller supplies no video labels, the complete canonical ladder is considered.
 */
export function selectVideoRenditions(source, requestedLabels = []) {
  if (!source?.width || !source?.height) return [];
  const requested = new Set(
    (Array.isArray(requestedLabels) ? requestedLabels : []).filter(isVideoRenditionLabel)
  );
  const candidates = requested.size
    ? VIDEO_RENDITIONS.filter((item) => requested.has(item.label))
    : VIDEO_RENDITIONS;

  // Walk low to high so duplicate source-sized outputs keep the least wasteful tier.
  const selectedAscending = [];
  const seenDimensions = new Set();
  for (const rendition of [...candidates].reverse()) {
    const dimensions = fitWithin(
      source.width,
      source.height,
      rendition.maxWidth,
      rendition.maxHeight
    );
    const identity = `${dimensions.width}x${dimensions.height}`;
    if (seenDimensions.has(identity)) continue;
    seenDimensions.add(identity);
    selectedAscending.push({ ...rendition, ...dimensions });
  }

  return selectedAscending.reverse();
}

export function buildVideoFfmpegArgs({
  inputPath,
  playlistPath,
  segmentPattern,
  keyInfoFile,
  rendition,
  source,
  segmentDuration,
}) {
  const frameRate = source.frameRateExpression || "30";
  const gopFrames = Math.max(1, Math.round(source.frameRate * segmentDuration));
  // Dimensions were already fitted without upscaling by selectVideoRenditions.
  // Encode those exact even dimensions so persisted RESOLUTION metadata cannot
  // drift from FFmpeg's output because of independent rounding decisions.
  const scale = `scale=w=${rendition.width}:h=${rendition.height}`;
  const filters = `${scale},setsar=1,fps=${frameRate},format=yuv420p`;

  const args = [
    "-y",
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-map_metadata", "-1",
    "-sn",
    "-dn",
    "-vf", filters,
    "-c:v", "libx264",
    "-preset", "medium",
    "-profile:v", "high",
    "-level:v", rendition.h264Level,
    "-crf", "20",
    "-maxrate", `${rendition.videoKbps}k`,
    "-bufsize", `${rendition.videoKbps * 2}k`,
    "-g", String(gopFrames),
    "-keyint_min", String(gopFrames),
    "-sc_threshold", "0",
    "-force_key_frames", `expr:gte(t,n_forced*${segmentDuration})`,
    "-c:a", "aac",
    "-profile:a", "aac_low",
    "-b:a", `${rendition.audioKbps}k`,
    "-ac", "2",
    "-ar", "48000",
    "-max_muxing_queue_size", "2048",
    "-shortest",
    "-f", "hls",
    "-hls_time", String(segmentDuration),
    "-hls_segment_filename", segmentPattern,
    "-hls_playlist_type", "vod",
    "-hls_flags", "independent_segments",
    "-hls_key_info_file", keyInfoFile,
    playlistPath,
  ];
  return args;
}

export function parseMediaPlaylist(playlistText) {
  const durations = [];
  let declaredTargetDuration = 0;
  for (const line of String(playlistText || "").split(/\r?\n/)) {
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      const value = Number.parseInt(line.slice("#EXT-X-TARGETDURATION:".length), 10);
      if (Number.isInteger(value) && value > 0) declaredTargetDuration = value;
    }
    if (!line.startsWith("#EXTINF:")) continue;
    const value = Number.parseFloat(line.slice("#EXTINF:".length).split(",")[0]);
    if (Number.isFinite(value) && value > 0) durations.push(value);
  }
  return {
    durations,
    durationSeconds: durations.reduce((total, value) => total + value, 0),
    targetDuration: declaredTargetDuration || (durations.length ? Math.ceil(Math.max(...durations)) : 0),
  };
}

export function measureBandwidth(segmentPaths, segmentDurations, statSync) {
  if (!segmentPaths.length || segmentPaths.length !== segmentDurations.length) {
    throw new Error("Segment files and EXTINF durations must have identical non-zero lengths");
  }
  let totalBytes = 0;
  let peakBandwidth = 0;
  let durationSeconds = 0;
  for (let index = 0; index < segmentPaths.length; index++) {
    const bytes = Number(statSync(segmentPaths[index]).size) || 0;
    const duration = segmentDurations[index];
    if (bytes <= 0 || duration <= 0) throw new Error(`Invalid HLS segment at index ${index}`);
    totalBytes += bytes;
    durationSeconds += duration;
    peakBandwidth = Math.max(peakBandwidth, Math.ceil((bytes * 8) / duration));
  }
  return {
    totalBytes,
    durationSeconds,
    averageBandwidth: Math.ceil((totalBytes * 8) / durationSeconds),
    peakBandwidth,
  };
}
