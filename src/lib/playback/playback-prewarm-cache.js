import {
  albumCardPlaybackItem,
  normalizeCatalogItemForPlayback,
  resolveAlbumTrackPlaybackItem,
  toPlaybackTrack,
} from "@/lib/music-playback";
import { resolveTrackAccess, libraryStreamRedirectSrc } from "@/lib/music-access";
import { catalogPreviewAudioUrl } from "@/lib/media-urls";

const MAX_ENTRIES = 96;
/** @type {Map<string, object>} */
const cache = new Map();

export function playbackPrewarmKey({ releaseSlug, trackSlug, trackIndex = 0 } = {}) {
  const release = String(releaseSlug || "unknown");
  const track = trackSlug ? String(trackSlug) : String(trackIndex ?? 0);
  return `${release}:${track}`;
}

export function getPlaybackPrewarmEntry(key) {
  if (!key) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function trimCache() {
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
    else break;
  }
}

export function setPlaybackPrewarmEntry(key, entry) {
  if (!key || !entry) return null;
  cache.set(key, { ...entry, warmedAt: Date.now() });
  trimCache();
  return entry;
}

/** Lightweight queue row — no signed URLs, no byte fetch. */
function queueDescriptorFromTrack(track, index) {
  const trackSlug =
    typeof track === "string"
      ? track
      : track?.slug || track?.id || track?.trackSlug || `t${index + 1}`;
  return {
    trackIndex: index,
    trackSlug,
    title: typeof track === "string" ? track : track?.title || null,
  };
}

/** Safe URL shape only — entitled stream uses same-origin redirect; preview uses CDN or discovery API. */
export function buildPlaybackUrlDescriptor(normalizedItem, access, { userId, accountState } = {}) {
  const previewPath =
    normalizedItem?.preview || normalizedItem?.preview_path || normalizedItem?.previewPath || null;
  const previewSrc = previewPath ? catalogPreviewAudioUrl(previewPath) : null;
  const trackSlug =
    normalizedItem?.trackSlug ||
    normalizedItem?.track_slug ||
    normalizedItem?.metadata?.trackSlug ||
    null;
  const streamSlug = normalizedItem?.slug || normalizedItem?.albumSlug || null;
  const canStream =
    access?.canStream &&
    userId &&
    accountState?.user?.id &&
    accountState.user.id === userId;
  const streamPath =
    canStream && streamSlug
      ? libraryStreamRedirectSrc(streamSlug, { trackSlug })
      : null;
  return {
    previewPath,
    previewSrc,
    streamPath,
    releaseSlug: streamSlug,
    trackSlug,
    releaseType: normalizedItem?.release_type || normalizedItem?.releaseType || null,
    trackIndex: normalizedItem?.trackIndex ?? 0,
    accessSnapshot: {
      canStream: Boolean(access?.canStream),
      previewOnly: Boolean(access?.previewOnly),
    },
  };
}

/**
 * Prepare first-track + queue metadata for a visible release card.
 * Does not fetch audio bytes or signed R2 URLs.
 */
export function buildReleasePrewarmBundle(
  releaseItem,
  {
    catalogLookup = null,
    accountState = {},
    userId = null,
    source = "home_card",
    playItem = null,
    isAlbumCard = false,
  } = {}
) {
  if (!releaseItem) return null;

  const normalizedRelease = normalizeCatalogItemForPlayback(releaseItem);
  const firstItem = isAlbumCard
    ? playItem || albumCardPlaybackItem(releaseItem, catalogLookup)
    : playItem || normalizedRelease;
  const normalizedFirst = normalizeCatalogItemForPlayback(firstItem);
  if (!normalizedFirst?.slug && !normalizedFirst?.title) return null;

  const access = resolveTrackAccess(normalizedFirst, { ...accountState, userId });
  const trackSlug =
    normalizedFirst.trackSlug ||
    normalizedFirst.track_slug ||
    (typeof (releaseItem.tracks || releaseItem.trackTitles || [])[0] === "string"
      ? null
      : (releaseItem.tracks || releaseItem.trackTitles || [])[0]?.slug) ||
    normalizedFirst.slug;
  const releaseSlug =
    normalizedFirst.albumSlug ||
    normalizedRelease.slug ||
    normalizedFirst.slug;
  const key = playbackPrewarmKey({
    releaseSlug,
    trackSlug,
    trackIndex: normalizedFirst.trackIndex ?? 0,
  });

  const trackList = releaseItem?.tracks || releaseItem?.trackTitles || [];
  const queueDescriptors = trackList.length
    ? trackList.map((track, index) => queueDescriptorFromTrack(track, index))
    : [
        {
          trackIndex: 0,
          trackSlug: trackSlug || normalizedFirst.slug,
          title: normalizedFirst.title || null,
        },
      ];

  const urlDescriptor = buildPlaybackUrlDescriptor(normalizedFirst, access, {
    userId,
    accountState,
  });

  const firstTrackPlayback = toPlaybackTrack(normalizedFirst, { ...accountState, userId }, source, {
    trackIndex: normalizedFirst.trackIndex ?? 0,
    albumSlug: normalizedFirst.albumSlug || releaseSlug,
    trackSlug,
  });

  return {
    key,
    releaseSlug,
    trackSlug,
    releaseType: urlDescriptor.releaseType,
    trackIndex: urlDescriptor.trackIndex,
    normalizedFirst,
    firstTrackPlayback,
    urlDescriptor,
    queueDescriptors,
    source,
  };
}

export function warmReleasePrewarmBundle(bundle) {
  if (!bundle?.key) return null;
  return setPlaybackPrewarmEntry(bundle.key, bundle);
}

/** Album tracklist tap — warm a specific track without network. */
export function warmAlbumTrackDescriptor(album, track, index, catalogLookup, accountState, userId, source) {
  const item = resolveAlbumTrackPlaybackItem(album, track, index, catalogLookup);
  const bundle = buildReleasePrewarmBundle(album, {
    catalogLookup,
    accountState,
    userId,
    source,
    playItem: item,
    isAlbumCard: true,
  });
  return warmReleasePrewarmBundle(bundle);
}

/** Dev-only cache stats. */
export function playbackPrewarmCacheStats() {
  return { size: cache.size, max: MAX_ENTRIES };
}
