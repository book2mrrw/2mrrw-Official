const LEGACY_BANDWIDTH = {'320k':360000,'160k':180000,'96k':108000,'64k':72000};

/** All readers accept the same complete, versioned record or use the legacy path. */
export function measuredRendition(manifest, bitrate) {
  const m = manifest.rendition_metadata?.[bitrate];
  if (!m || m.version !== 1 || !Number.isSafeInteger(m.bandwidth) || m.bandwidth <= 0 ||
      !Number.isSafeInteger(m.average_bandwidth) || m.average_bandwidth <= 0 ||
      !Number.isSafeInteger(m.target_duration) || m.target_duration <= 0 ||
      !Array.isArray(m.segment_durations) || !m.segment_durations.length ||
      m.segment_durations.length !== manifest.segment_counts?.[bitrate] ||
      !m.segment_durations.every(d=>Number.isFinite(d) && d>0 && Math.round(d)<=m.target_duration)) return null;
  return m;
}

export function renditionBandwidthAttributes(manifest, bitrate) {
  const measured = measuredRendition(manifest,bitrate);
  return measured
    ? `BANDWIDTH=${measured.bandwidth},AVERAGE-BANDWIDTH=${measured.average_bandwidth}`
    : `BANDWIDTH=${LEGACY_BANDWIDTH[bitrate] ?? 160000}`;
}
