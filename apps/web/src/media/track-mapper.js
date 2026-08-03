/**
 * Pure track shape conversion utilities — no React, no AudioContext imports.
 * Extracted here to break the AudioContext ↔ useMediaEngine circular dependency.
 */

/**
 * Maps AudioContext track shape to subscription-layer track fields.
 */
export function mapContextTrackToMediaTrack(track) {
  if (!track) return null;
  return {
    id: track.id ?? track.slug ?? null,
    slug: track.slug ?? track.id ?? null,
    title: track.title ?? "Untitled",
    artist: track.artist ?? "2MRRW",
    artwork: track.cover ?? track.baseCover ?? null,
    audioUrl: track.src ?? track.baseSrc ?? null,
    metadata: track.metadata ?? null,
  };
}

/**
 * Maps subscription play() payload to AudioContext playTrack input.
 */
export function mapMediaTrackToPlayInput(track = {}) {
  const id = track.id ?? track.slug;
  const audioUrl = track.audioUrl ?? track.src ?? track.audio ?? track.url ?? "";
  return {
    id,
    slug: track.slug ?? id,
    src: audioUrl,
    audio: audioUrl,
    title: track.title,
    artist: track.artist,
    cover: track.artwork ?? track.cover,
    gainDb: track.gainDb ?? track.gain_db ?? null,
    metadata: track.metadata,
    source: track.source,
  };
}
