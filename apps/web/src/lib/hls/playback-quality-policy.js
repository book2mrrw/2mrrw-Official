/**
 * Canonical production HLS quality policy.
 *
 * These values describe media behavior rather than per-request preferences.
 * Keeping them in one module prevents the queue, player, and prefetcher from
 * drifting into incompatible startup assumptions as the catalog grows.
 */
export const AUDIO_SEGMENT_DURATION_SECONDS = 2;
export const VIDEO_SEGMENT_DURATION_SECONDS = 4;

export const AUDIO_STARTUP_BUFFER_SECONDS = 1.5;
export const AUDIO_PREFETCH_BUFFER_SECONDS = 6;
export const AUDIO_FORWARD_BUFFER_SECONDS = 30;
export const AUDIO_MAX_FORWARD_BUFFER_SECONDS = 45;
export const AUDIO_MAX_BUFFER_BYTES = 8 * 1000 * 1000;

// This selects the middle AAC rendition on an unmeasured connection. hls.js
// upgrades after the first fragment using actual throughput.
export const AUDIO_INITIAL_BANDWIDTH_ESTIMATE = 250_000;

const VIDEO_SOURCE_EXTENSION = /\.(?:mp4|mov|webm|m4v)(?:$|[?#])/i;

export function isLikelyVideoSourceKey(sourceKey) {
  return VIDEO_SOURCE_EXTENSION.test(String(sourceKey || ""));
}

export function segmentDurationForSourceKey(sourceKey) {
  return isLikelyVideoSourceKey(sourceKey)
    ? VIDEO_SEGMENT_DURATION_SECONDS
    : AUDIO_SEGMENT_DURATION_SECONDS;
}
