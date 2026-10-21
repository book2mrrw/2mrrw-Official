import { creditRows, normalizeCredits } from "@/lib/credits/contract";

export function getReleaseEditorial(release) {
  const rows = creditRows(release);
  const byRole = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return {
    writtenBy: byRole.songwriter || null,
    producedBy: byRole.producer || null,
    featuredArtists: byRole.featured_artist || null,
    mixingEngineer: byRole.mixing_engineer || null,
    masteringEngineer: byRole.mastering_engineer || null,
    recordLabel: byRole.label || null,
    releaseDate: release?.releaseDate || release?.release_date || release?.date || null,
    genre: release?.genre || release?.metadata?.genre || null,
    creditRows: rows,
    credits: normalizeCredits(release),
  };
}
export function getCreditsDisplayRows(editorial) { return editorial?.creditRows || []; }
export const EDITORIAL_ROWS = [];

/** Empty saved text is an explicit clear; absent fields may use an older scoped source. */
export function lyricsFromSource(source) {
  for (const value of [source?.lyricsLrc, source?.lyrics_lrc, source?.lrc, source?.lyrics, source?.lyricsText, source?.lyrics_text, source?.metadata?.lyrics]) {
    if (typeof value === "string") return value;
  }
  return null;
}
export function recordingEditorial(release, track) {
  if (!track) return null;
  return release?.tracks?.find(row =>
    (track.track_id != null && row.id === track.track_id) ||
    (track.id != null && (row.id === track.id || row.catalog_track_id === track.id)) ||
    (track.slug && row.slug === track.slug)
  ) || null;
}
