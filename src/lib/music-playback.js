import { withR2CatalogMedia } from "@/lib/media/r2-catalog-media";
import { resolvePlaybackSrc, resolveTrackAccess } from "@/lib/music-access";
import {
  getCanonicalReleaseBySlug,
  getCanonicalTrack,
  mergeCanonicalMetadata,
} from "@/lib/media/canonical-catalog";
import { getCachedAvailability } from "@/lib/media/availability-cache";
import { isUpcomingReleaseDate } from "@/lib/media/release-date";
import {
  catalogCoverUrl,
  catalogMotionVideoUrl,
  catalogPreviewAudioUrl,
  catalogPublicMediaUrl,
  catalogVisualMediaUrl,
} from "@/lib/media-urls";

/** Known storefront title → product slug (album rows that match singles/features). */
const TITLE_SLUG_ALIASES = {
  "hour glass": "hour-glass",
  "w.2.d": "w2d",
  w2d: "w2d",
  artificial: "artificial",
  artifical: "artificial",
  "turnt me 2 dis": "turnt-me-2-dis",
};

function resolveCsMediaUrl(path) {
  if (!path) return null;
  const normalized = String(path).replace(/^\//, "");
  return catalogPublicMediaUrl(normalized) || path;
}

export function normalizeTitleKey(title) {
  return String(title || "")
    .trim()
    .toLowerCase();
}

export function titleToCatalogSlug(title) {
  const key = normalizeTitleKey(title);
  if (TITLE_SLUG_ALIASES[key]) return TITLE_SLUG_ALIASES[key];
  return key
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** R2-resolve cover/preview/video paths — same shape singles use before playTrack. */
export function normalizeCatalogItemForPlayback(item) {
  if (!item) return item;
  const next = withR2CatalogMedia(mergeCanonicalMetadata({ ...item }));
  const previewPath =
    next.preview_path || next.previewPath || next.preview || null;
  if (previewPath) {
    next.preview_path = next.preview_path || next.previewPath || previewPath;
    next.previewPath = next.preview_path;
    next.preview = next.preview || next.preview_path;
  }
  if (!next.slug && next.title) {
    next.slug = titleToCatalogSlug(next.title);
  }
  return next;
}

/** @typedef {{ bySlug: Map<string, object>, byTitle: Map<string, object> }} CatalogPlaybackLookup */

export function buildCatalogPlaybackLookup(items = []) {
  const bySlug = new Map();
  const byTitle = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item?.slug) return;
    const norm = normalizeCatalogItemForPlayback(item);
    bySlug.set(item.slug, norm);
    if (item.title) byTitle.set(normalizeTitleKey(item.title), norm);
  });
  return { bySlug, byTitle };
}

export function resolveCatalogPlaybackItem(item, catalogLookup) {
  const normalized = normalizeCatalogItemForPlayback(item);
  if (!catalogLookup || !normalized) return normalized;

  const slug = normalized.slug || titleToCatalogSlug(normalized.title);
  const fromSlug = slug ? catalogLookup.bySlug?.get(slug) : null;
  if (fromSlug) {
    return normalizeCatalogItemForPlayback({
      ...fromSlug,
      ...normalized,
      slug: fromSlug.slug || slug,
      title: normalized.title || fromSlug.title,
      cover: normalized.cover || fromSlug.cover,
      preview_path: fromSlug.preview_path || normalized.preview_path || fromSlug.preview,
      preview: fromSlug.preview || normalized.preview,
    });
  }

  const fromTitle = normalized.title
    ? catalogLookup.byTitle?.get(normalizeTitleKey(normalized.title))
    : null;
  if (fromTitle) {
    return normalizeCatalogItemForPlayback({
      ...fromTitle,
      ...normalized,
      slug: fromTitle.slug,
      title: normalized.title || fromTitle.title,
      cover: normalized.cover || fromTitle.cover,
      preview_path: fromTitle.preview_path || normalized.preview_path || fromTitle.preview,
      preview: fromTitle.preview || normalized.preview,
    });
  }

  return normalized;
}

/** Album/EP stream entitlement uses the release product slug; trackSlug is passed separately. */
function resolveAlbumTrackStreamSlug(albumSlug) {
  return albumSlug || null;
}

export function resolveAlbumTrackPlaybackItem(album, track, index, catalogLookup) {
  const albumNorm = normalizeCatalogItemForPlayback(album);
  const albumSlug = albumNorm.slug || album.slug;
  const streamSlug = resolveAlbumTrackStreamSlug(albumSlug);

  if (typeof track === "string") {
    const title = track;
    const canonicalTrack = getCanonicalTrack(albumSlug, titleToCatalogSlug(title));
    const catalogItem = catalogLookup?.byTitle?.get(normalizeTitleKey(title));
    const base = canonicalTrack
      ? {
          slug: streamSlug,
          title: canonicalTrack.title,
          storage_path: canonicalTrack.storage_path,
          cover: albumNorm.cover,
          preview: canonicalTrack.preview || albumNorm.preview,
          audio: albumNorm.audio,
          artist: albumNorm.artist || "2MRRW",
        }
      : catalogItem
        ? { ...catalogItem, title, slug: streamSlug }
        : {
            slug: streamSlug,
            title,
            cover: albumNorm.cover,
            preview: albumNorm.preview,
            audio: albumNorm.audio,
            artist: albumNorm.artist || "2MRRW",
          };
    return normalizeCatalogItemForPlayback({
      ...base,
      albumSlug,
      release_type: albumNorm.release_type || album.release_type,
      trackIndex: index,
      type: base.type || "album_track",
    });
  }

  const trackSlug = track.slug || track.id;
  const canonicalTrack = getCanonicalTrack(albumSlug, trackSlug);
  const catalogItem = trackSlug ? catalogLookup?.bySlug?.get(trackSlug) : null;
  const canonicalRelease = getCanonicalReleaseBySlug(trackSlug);
  return normalizeCatalogItemForPlayback({
    ...(catalogItem || {}),
    ...track,
    slug: streamSlug,
    trackSlug,
    title: canonicalTrack?.title || canonicalRelease?.title || track.title,
    storage_path: canonicalTrack?.storage_path || track.storage_path,
    albumSlug,
    release_type: albumNorm.release_type || album.release_type,
    trackIndex: index,
    cover: track.cover || albumNorm.cover,
    preview: track.preview || canonicalTrack?.preview || catalogItem?.preview || albumNorm.preview,
    audio: track.audio || catalogItem?.audio || albumNorm.audio,
    artist: track.artist || albumNorm.artist || "2MRRW",
  });
}

export function normalizeTrackForPlayback(item, accountState, source = "library", overrides = {}) {
  const normalized = normalizeCatalogItemForPlayback(item);
  const access = resolveTrackAccess(normalized, accountState);
  const userId = accountState?.userId || overrides.userId;
  const csAudioRaw = normalized?.csAudio || normalized?.cs_audio || null;
  const csCoverRaw = normalized?.csCover || normalized?.cs_cover || normalized?.csCoverArt || null;
  const visualRaw = normalized?.visual || null;
  const motionRaw =
    normalized?.motion_cover_url || normalized?.motionCoverUrl || normalized?.video || null;
  const coverArtType =
    normalized?.coverArtType || normalized?.cover_art_type || (motionRaw || visualRaw ? "video" : "image");
  const csCoverType = normalized?.csCoverType || normalized?.cs_cover_type || "image";
  const coverRaw =
    normalized?.cover_art_url ||
    normalized?.coverArtUrl ||
    normalized?.cover ||
    normalized?.coverArt ||
    null;
  const videoRaw = motionRaw || visualRaw;
  const cover =
    visualRaw
      ? catalogVisualMediaUrl(String(visualRaw).replace(/^\//, ""))
      : coverArtType === "video" && videoRaw
        ? catalogMotionVideoUrl(String(videoRaw).replace(/^\//, ""))
        : coverRaw
          ? catalogCoverUrl(String(coverRaw).replace(/^\//, ""))
          : null;
  const previewPath =
    normalized?.preview_path || normalized?.previewPath || normalized?.preview || null;
  const playbackSrc = resolvePlaybackSrc(normalized, access, { userId, accountState });
  const previewSrc = previewPath ? catalogPreviewAudioUrl(previewPath) : null;

  return {
    id: normalized?.slug || normalized?.id,
    slug: normalized?.slug,
    preview: previewPath,
    preview_path: normalized?.preview_path || normalized?.previewPath || previewPath,
    title: normalized?.title || "Untitled",
    artist: normalized?.artist || "2MRRW",
    cover,
    coverArtType,
    src: playbackSrc,
    csAudio: csAudioRaw ? resolveCsMediaUrl(csAudioRaw) : null,
    csCover: csCoverRaw ? catalogCoverUrl(csCoverRaw) : null,
    csCoverType,
    source,
    metadata: {
      access,
      previewSrc,
      price: normalized?.price,
      albumSlug: normalized?.albumSlug || overrides.albumSlug,
      trackSlug: normalized?.trackSlug || overrides.trackSlug || null,
      ...overrides,
    },
  };
}

export function toPlaybackTrack(item, accountState, source = "library", overrides = {}) {
  return normalizeTrackForPlayback(item, accountState, source, overrides);
}

/** First-track catalog item for inline album card play — matches modal start index 0. */
export function albumCardPlaybackItem(album, catalogLookup) {
  if (!album) return album;
  const trackList = album.tracks || album.trackTitles || [];
  const first = trackList[0];
  if (!first) return normalizeCatalogItemForPlayback(album);
  return resolveAlbumTrackPlaybackItem(album, first, 0, catalogLookup);
}

export function isQueueTrackPlayable(track) {
  if (!track) return false;
  if (track.playbackStatus === "unavailable" || track.metadata?.playbackStatus === "unavailable") {
    return false;
  }
  if (track.src) return true;
  const previewPath = track.preview || track.preview_path || track.metadata?.previewSrc;
  return Boolean(previewPath);
}

/** Mark playbackStatus and drop tracks with no stream or preview path. */
export function filterPlayableQueueItems(items = [], accountState) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const access = resolveTrackAccess(item, accountState);
      const previewPath = item.preview || item.preview_path || item.previewPath || item.metadata?.previewSrc;
      const hasSrc = Boolean(item.src);
      const hasPreview = Boolean(previewPath);
      const comingSoon =
        item.release_date && isUpcomingReleaseDate(item.release_date);
      let playbackStatus = "ready";
      if (comingSoon) playbackStatus = "coming_soon";
      else if (!hasSrc && !hasPreview && !access?.canStream) playbackStatus = "unavailable";
      else if (!hasSrc && (hasPreview || access?.previewOnly)) playbackStatus = "preview_only";

      return {
        ...item,
        playbackStatus,
        metadata: {
          ...(item.metadata || {}),
          playbackStatus,
          previewUnavailable: playbackStatus === "unavailable",
        },
      };
    })
    .filter((t) => isQueueTrackPlayable(t));
}

/**
 * Safe play button state for cards and track rows (no layout changes).
 * @returns {{ label: 'Play'|'Unavailable'|'Coming Soon'|'Preview Not Ready', disabled: boolean, canAttemptPlay: boolean }}
 */
export function getPlayButtonState(track, accountState) {
  if (!track) {
    return { label: "Unavailable", disabled: true, canAttemptPlay: false };
  }

  const cached = getCachedAvailability(
    track.slug,
    track.metadata?.trackSlug || track.trackSlug,
    track.metadata?.albumSlug || track.albumSlug
  );
  if (cached?.status === "coming_soon") {
    return { label: "Coming Soon", disabled: true, canAttemptPlay: false };
  }
  if (cached?.status === "unavailable") {
    return { label: "Unavailable", disabled: true, canAttemptPlay: false };
  }

  const status = track.playbackStatus || track.metadata?.playbackStatus || cached?.status;
  if (status === "coming_soon" || (track.release_date && isUpcomingReleaseDate(track.release_date))) {
    return { label: "Coming Soon", disabled: true, canAttemptPlay: false };
  }
  if (status === "unavailable" || track.metadata?.previewUnavailable) {
    return { label: "Unavailable", disabled: true, canAttemptPlay: false };
  }
  const access = resolveTrackAccess(track, accountState);
  const previewPath = track.preview || track.preview_path || track.previewPath || track.metadata?.previewSrc;
  const hasPlayableSrc = Boolean(track.src) || Boolean(previewPath);
  if (!hasPlayableSrc && !access?.canStream) {
    return { label: "Preview Not Ready", disabled: true, canAttemptPlay: false };
  }
  return { label: "Play", disabled: false, canAttemptPlay: true };
}

/** Map every release track in catalog order — full tracklist for queue construction and UI. */
export function mapAlbumTracksForPlayback(album, accountState, source = "album", catalogLookup) {
  const trackList = album?.tracks || album?.trackTitles || [];
  const albumSlug = album?.slug || "";
  return trackList.map((track, index) => {
    const trackSlug =
      typeof track === "string" ? titleToCatalogSlug(track) : track?.slug || track?.id || `t${index + 1}`;
    const item = resolveAlbumTrackPlaybackItem(album, track, index, catalogLookup);
    const playback = toPlaybackTrack(item, accountState, source, {
      trackIndex: index,
      albumSlug,
      trackSlug,
    });
    const access = playback.metadata?.access;
    const previewPath = item.preview || item.preview_path || item.previewPath;
    const hasPreview = Boolean(previewPath);
    const queueId = albumSlug ? `${albumSlug}:${trackSlug}` : playback.id;

    if (!access?.canStream && !hasPreview && !playback.src) {
      return {
        ...playback,
        id: queueId,
        src: "",
        playbackStatus: "unavailable",
        metadata: {
          ...playback.metadata,
          playbackStatus: "unavailable",
          access: { ...access, previewOnly: true },
          previewUnavailable: true,
        },
      };
    }
    return {
      ...playback,
      id: queueId,
      playbackStatus: playback.src ? "ready" : "preview_only",
      metadata: {
        ...playback.metadata,
        playbackStatus: playback.src ? "ready" : "preview_only",
      },
    };
  });
}

/** Playable subset for AudioContext queue — preserves release order and trackIndex metadata. */
export function playableReleaseQueue(tracks = [], accountState) {
  return filterPlayableQueueItems(tracks, accountState).filter((t) => Boolean(t.src));
}

/**
 * Resolve queue start index from a release tracklist tap (0-based release position).
 * Album tracks share the release stream slug; trackIndex is the stable discriminator.
 */
export function resolveReleaseQueueStartIndex(playableTracks, releaseTrackIndex) {
  if (!Array.isArray(playableTracks) || !playableTracks.length) return 0;
  const idx = Number(releaseTrackIndex);
  if (!Number.isFinite(idx) || idx < 0) return 0;
  const exact = playableTracks.findIndex((t) => t.metadata?.trackIndex === idx);
  if (exact >= 0) return exact;
  const nextAtOrAfter = playableTracks.findIndex((t) => {
    const trackIdx = t.metadata?.trackIndex;
    return Number.isFinite(trackIdx) && trackIdx > idx;
  });
  if (nextAtOrAfter >= 0) return nextAtOrAfter;
  return 0;
}

export function albumTracksForPlayback(album, accountState, source = "album", catalogLookup) {
  return mapAlbumTracksForPlayback(album, accountState, source, catalogLookup);
}
