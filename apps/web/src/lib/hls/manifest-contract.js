/**
 * Canonical persisted HLS manifest contract used by every playlist route.
 *
 * Keep database field selection and defensive normalization here so a cache
 * entry populated by one route is a complete entry for every other route.
 */

export const HLS_MANIFEST_SELECT_FIELDS = [
  "bitrates",
  "segment_duration_secs",
  "duration_seconds",
  "hls_prefix",
  "segment_counts",
  "poster_key",
  "vtt_key",
  "media_kind",
  "segment_durations",
  "rendition_metadata",
  "source_metadata",
  "transcode_profile_version",
].join(", ");

export function positiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

export function positiveFrameRate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(3) : null;
}

export function safeCodecs(value, fallback) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate && /^[A-Za-z0-9.,-]+$/.test(candidate) ? candidate : fallback;
}

/**
 * Prefer measurements from completed encoded files. BANDWIDTH is never lower
 * than AVERAGE-BANDWIDTH even if persisted metadata is malformed.
 */
export function getRenditionStreamMetadata(
  manifest,
  bitrate,
  { fallbackBandwidth, fallbackCodecs }
) {
  const metadata = manifest?.rendition_metadata?.[bitrate] || {};
  const averageBandwidth = positiveInteger(metadata.average_bandwidth);
  const measuredPeak = positiveInteger(metadata.peak_bandwidth);
  const bandwidth = Math.max(measuredPeak || 0, averageBandwidth || 0)
    || fallbackBandwidth;

  return {
    metadata,
    bandwidth,
    averageBandwidth,
    codecs: safeCodecs(metadata.codecs, fallbackCodecs),
  };
}

/**
 * Return exact EXTINF values only when the rendition has one valid duration
 * per persisted segment. Callers otherwise retain the legacy duration model.
 */
export function getExactSegmentDurations(manifest, bitrate, segmentCount) {
  const durations = manifest?.segment_durations?.[bitrate];
  if (!Array.isArray(durations) || durations.length !== segmentCount) return null;

  const normalized = durations.map(Number);
  return normalized.every((duration) => Number.isFinite(duration) && duration > 0)
    ? normalized
    : null;
}
