import { withR2CatalogMedia } from "@/lib/media/r2-catalog-media";

function absoluteMediaUrl(value, origin) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return new URL(raw.replace(/^\/?/, "/"), origin).href;
}

function toMobileTrack(track, release, origin) {
  return {
    id: track.id || track.slug,
    slug: track.slug,
    title: track.title,
    artist: track.artist || release.artist || "2MRRW",
    trackNumber: track.trackNumber ?? track.track_number ?? track.position ?? null,
    duration: track.duration ?? track.duration_seconds ?? null,
    preview: absoluteMediaUrl(track.preview, origin),
    src: absoluteMediaUrl(track.src || track.stream, origin),
    cover: absoluteMediaUrl(
      track.baseCover || track.cover || release.baseCover || release.cover,
      origin
    ),
    gainDb: track.gainDb ?? track.gain_db ?? null,
    metadata: track.metadata,
  };
}

function toMobileRelease(release, origin) {
  const resolved = withR2CatalogMedia(release);
  const staticCover =
    resolved.baseCover ||
    resolved.legacy_cover ||
    (resolved.coverArtType !== "video" ? resolved.cover : null);
  const video = resolved.coverArtType === "video" ? resolved.video : null;

  return {
    id: resolved.id || resolved.slug,
    slug: resolved.slug,
    title: resolved.title,
    artist: resolved.artist || "2MRRW",
    // Native image components must receive a real image, never an animated MP4.
    // The companion `video` field carries the original full-quality animation.
    cover: absoluteMediaUrl(staticCover, origin),
    baseCover: absoluteMediaUrl(staticCover, origin),
    video: absoluteMediaUrl(video, origin),
    coverArtType: video ? "video" : "image",
    type: resolved.type || resolved.release_type || "single",
    releaseDate: resolved.releaseDate || resolved.release_date || null,
    tracks: (Array.isArray(resolved.tracks) ? resolved.tracks : []).map((track) =>
      toMobileTrack(track, resolved, origin)
    ),
    metadata: resolved.metadata,
  };
}

/**
 * Produce the complete native catalog in one stable projection. Web singles
 * pagination remains a separate contract and does not pay for this full read.
 */
export function toMobileCatalogReleases(catalog, origin) {
  const groups = [
    catalog?.singles,
    catalog?.features,
    catalog?.albums,
    catalog?.mixtapes,
  ];
  const seen = new Set();
  const releases = [];

  for (const group of groups) {
    for (const release of Array.isArray(group) ? group : []) {
      if (!release?.slug || seen.has(release.slug)) continue;
      seen.add(release.slug);
      releases.push(toMobileRelease(release, origin));
    }
  }

  return releases;
}
