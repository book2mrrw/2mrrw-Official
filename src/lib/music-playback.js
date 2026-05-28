import { withR2CatalogMedia } from "@/components/home/catalogMedia";
import { resolvePlaybackSrc, resolveTrackAccess } from "@/lib/music-access";
import { catalogCoverUrl, catalogMotionVideoUrl, catalogPreviewAudioUrl, catalogPublicMediaUrl } from "@/lib/media-urls";

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
  const next = withR2CatalogMedia({ ...item });
  const preview = next.preview || next.preview_path || next.previewPath || null;
  if (preview) {
    next.preview = preview;
    next.preview_path = next.preview_path || next.previewPath || preview;
    next.previewPath = next.preview_path;
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
      preview: normalized.preview || fromSlug.preview,
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
      preview: normalized.preview || fromTitle.preview,
    });
  }

  return normalized;
}

export function resolveAlbumTrackPlaybackItem(album, track, index, catalogLookup) {
  const albumNorm = normalizeCatalogItemForPlayback(album);
  if (typeof track === "string") {
    const title = track;
    const derivedSlug = titleToCatalogSlug(title);
    const catalogItem =
      catalogLookup?.bySlug?.get(derivedSlug) ||
      catalogLookup?.byTitle?.get(normalizeTitleKey(title));
    const base = catalogItem
      ? { ...catalogItem, title, slug: catalogItem.slug }
      : {
          slug: derivedSlug,
          title,
          cover: albumNorm.cover,
          preview: albumNorm.preview,
          audio: albumNorm.audio,
          artist: albumNorm.artist || "2MRRW",
        };
    return normalizeCatalogItemForPlayback({
      ...base,
      albumSlug: album.slug,
      type: base.type || "album_track",
    });
  }

  const slug = track.slug || titleToCatalogSlug(track.title);
  const catalogItem = catalogLookup?.bySlug?.get(slug);
  return normalizeCatalogItemForPlayback({
    ...(catalogItem || {}),
    ...track,
    slug: catalogItem?.slug || slug,
    albumSlug: album.slug,
    cover: track.cover || albumNorm.cover,
    preview: track.preview || catalogItem?.preview || albumNorm.preview,
    audio: track.audio || catalogItem?.audio || albumNorm.audio,
    artist: track.artist || albumNorm.artist || "2MRRW",
  });
}

export function toPlaybackTrack(item, accountState, source = "library", overrides = {}) {
  const normalized = normalizeCatalogItemForPlayback(item);
  const access = resolveTrackAccess(normalized, accountState);
  const userId = accountState?.userId || overrides.userId;
  const csAudioRaw = normalized?.csAudio || normalized?.cs_audio || null;
  const csCoverRaw = normalized?.csCover || normalized?.cs_cover || normalized?.csCoverArt || null;
  const motionRaw = normalized?.motion_cover_url || normalized?.motionCoverUrl || normalized?.video || null;
  const coverArtType = normalized?.coverArtType || normalized?.cover_art_type || (motionRaw ? "video" : "image");
  const csCoverType = normalized?.csCoverType || normalized?.cs_cover_type || "image";
  const coverRaw =
    normalized?.cover_art_url || normalized?.coverArtUrl || normalized?.cover || normalized?.coverArt || null;
  const videoRaw = motionRaw;
  const cover =
    coverArtType === "video" && videoRaw
      ? catalogMotionVideoUrl(String(videoRaw).replace(/^\//, ""))
      : coverRaw
        ? catalogCoverUrl(String(coverRaw).replace(/^\//, ""))
        : null;
  const previewPath =
    normalized?.preview || normalized?.preview_path || normalized?.previewPath || null;
  const playbackSrc = resolvePlaybackSrc(normalized, access, { userId });
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
      ...overrides,
    },
  };
}

/** Alias for callers that name the normalization step explicitly. */
export const normalizeTrackForPlayback = normalizeCatalogItemForPlayback;

/** First-track catalog item for inline album card play — matches modal start index 0. */
export function albumCardPlaybackItem(album, catalogLookup) {
  if (!album) return album;
  const trackList = album.tracks || album.trackTitles || [];
  const first = trackList[0];
  if (!first) return normalizeCatalogItemForPlayback(album);
  return resolveAlbumTrackPlaybackItem(album, first, 0, catalogLookup);
}

export function albumTracksForPlayback(album, accountState, source = "album", catalogLookup) {
  const trackList = album?.tracks || album?.trackTitles || [];
  return trackList
    .map((track, index) => {
      const item = resolveAlbumTrackPlaybackItem(album, track, index, catalogLookup);
      return toPlaybackTrack(item, accountState, source, {
        trackIndex: index,
        albumSlug: album.slug,
      });
    })
    .filter((t) => t.src);
}
