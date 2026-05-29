import {
  legacyCoverPublicPath,
  legacyVideoPublicPath,
  previewDiscoveryUrl,
  resolveArtworkPath,
  resolvePreviewPath,
  resolveStoragePath,
  resolveVideoPath,
  storagePathForProductRow,
  visualDiscoveryUrl,
} from "@/lib/media/canonical-paths";

/** Singles — ordered by release_date DESC when exported. */
export const CANONICAL_SINGLES = [
  {
    slug: "hour-glass",
    title: "Hour Glass",
    release_type: "single",
    release_date: "2026-08-15",
    price_cents: 299,
    preview_ext: "mp3",
    legacy_cover_stem: "hourglass",
    legacy_video_stem: "hourglass",
    preview_legacy: "audio/singles/hour-glass/hourglass-preview.mp3",
  },
  {
    slug: "turnt-me-2-dis",
    title: "Turnt Me 2 Dis",
    release_type: "single",
    release_date: "2026-08-01",
    price_cents: 299,
    preview_ext: "mp3",
    legacy_cover_stem: "turnt",
    legacy_video_stem: "turntme2dis",
    preview_legacy: "audio/singles/turnt-me-2-dis/turntme2dis-preview.mp3",
  },
  {
    slug: "w2d",
    title: "W.2.D",
    release_type: "single",
    release_date: "2024-06-01",
    price_cents: 299,
    preview_ext: "mp3",
    preview_legacy: "audio/singles/w2d/w2d-preview.mp3",
  },
  {
    slug: "artificial",
    title: "ArTiFiCiAL",
    release_type: "single",
    release_date: "2022-07-07",
    price_cents: 299,
    preview_ext: "mp3",
    preview_legacy: "audio/singles/artificial/artificial-preview.mp3",
  },
];

/** Features — slug MUST stay ASCII (i-dont-believe-you). */
export const CANONICAL_FEATURES = [
  {
    slug: "i-dont-believe-you",
    title: "I Don't Believe You",
    release_type: "feature",
    release_date: "2024-01-15",
    price_cents: 299,
    preview_ext: "wav",
    preview_legacy: "previews/i-dont-believe-you-preview.wav",
  },
  {
    slug: "2-heavy",
    title: "2 Heavy",
    release_type: "feature",
    release_date: "2024-02-01",
    price_cents: 299,
    preview_ext: "wav",
    preview_legacy: "previews/2-heavy-preview.wav",
  },
];

/** Albums / EPs / mixtapes — release slug is canonical product slug. */
export const CANONICAL_ALBUMS = [
  {
    slug: "love-hz-vol-1",
    title: "Love Hz Vol. 1",
    release_type: "ep",
    release_category: "EP",
    release_date: "2026-08-01",
    price_cents: 1299,
    legacy_cover: "/images/albums/lovehz.jpg",
  },
  {
    slug: "ad",
    title: "2MRRW: (A.D)",
    release_type: "mixtape",
    release_category: "Mixtape",
    release_date: "2024-03-24",
    price_cents: 999,
    legacy_cover: "/images/albums/ad.jpg",
  },
  {
    slug: "tbh",
    title: "T.B.H",
    release_type: "mixtape",
    release_category: "Mixtape",
    release_date: "2022-07-07",
    price_cents: 999,
    legacy_cover: "/images/albums/tbh.jpg",
  },
];

export const CANONICAL_TRACKS = [
  { album_slug: "love-hz-vol-1", track_number: 1, slug: "01-roll-call", title: "Roll Call" },
  { album_slug: "love-hz-vol-1", track_number: 2, slug: "02-w-2-d", title: "W.2.D" },
  { album_slug: "love-hz-vol-1", track_number: 3, slug: "03-guarded-heart", title: "Guarded Heart" },
  { album_slug: "love-hz-vol-1", track_number: 4, slug: "04-all-love-it", title: "All Love It" },
  { album_slug: "love-hz-vol-1", track_number: 5, slug: "05-like-u-do", title: "Like U Do" },
  { album_slug: "love-hz-vol-1", track_number: 6, slug: "06-tell-me", title: "Tell Me" },
  { album_slug: "love-hz-vol-1", track_number: 7, slug: "07-stayed-2-long", title: "Stayed 2 Long" },
  { album_slug: "love-hz-vol-1", track_number: 8, slug: "08-knock-on-wood", title: "Knock On Wood" },
  { album_slug: "love-hz-vol-1", track_number: 9, slug: "09-hour-glass", title: "Hour Glass" },
  { album_slug: "love-hz-vol-1", track_number: 10, slug: "10-turnt-me-2-dis", title: "Turnt Me 2 Dis" },
  { album_slug: "ad", track_number: 1, slug: "01-2mrrws-ntro", title: "2mrrw's Ntro" },
  { album_slug: "ad", track_number: 2, slug: "02-here-i-come", title: "Here I Come" },
  { album_slug: "ad", track_number: 3, slug: "03-said-n-done", title: "Said N' Done" },
  { album_slug: "ad", track_number: 4, slug: "04-a-d-d", title: "A.D.D" },
  { album_slug: "ad", track_number: 5, slug: "05-perspective", title: "Perspective" },
  { album_slug: "ad", track_number: 6, slug: "06-grand-scheme", title: "Grand Scheme" },
  { album_slug: "ad", track_number: 7, slug: "07-a2b", title: "A2B" },
  { album_slug: "ad", track_number: 8, slug: "08-life-changes-ft-gwendolyn", title: "Life Changes ft. Gwendolyn" },
  { album_slug: "ad", track_number: 9, slug: "09-itself", title: "Itself" },
  { album_slug: "ad", track_number: 10, slug: "10-wastin-time", title: "Wastin' Time" },
  { album_slug: "ad", track_number: 11, slug: "11-like-me-or-not", title: "Like Me or Not" },
  { album_slug: "tbh", track_number: 1, slug: "01-glass-full", title: "Glass Full" },
  { album_slug: "tbh", track_number: 2, slug: "02-up-2-me", title: "Up 2 Me" },
  { album_slug: "tbh", track_number: 3, slug: "03-unxpcted", title: "Unxpcted" },
  { album_slug: "tbh", track_number: 4, slug: "04-all-yours", title: "All Yours" },
  { album_slug: "tbh", track_number: 5, slug: "05-locomotive", title: "Locomotive" },
  { album_slug: "tbh", track_number: 6, slug: "06-left", title: "LEFT (interlude)" },
  { album_slug: "tbh", track_number: 7, slug: "07-was-wrong", title: "Was Wrong" },
  { album_slug: "tbh", track_number: 8, slug: "08-2late", title: "2Late?" },
  { album_slug: "tbh", track_number: 9, slug: "09-artificial", title: "ArTiFiCiAL" },
];

export const CANONICAL_SLUG_ALIASES = {
  "love-hz": "love-hz-vol-1",
};

function enrichRelease(raw) {
  if (!raw?.slug) return null;
  const releaseType = raw.release_type || "single";
  const storage_path = resolveStoragePath(releaseType, raw.slug);
  const artwork_path = resolveArtworkPath(releaseType, raw.slug);
  const preview_path = resolvePreviewPath(releaseType, raw.slug);
  const preview_legacy = raw.preview_legacy || null;
  const video_path = resolveVideoPath(releaseType, raw.slug);
  const legacyImage =
    raw.legacy_cover ||
    legacyCoverPublicPath(releaseType, raw.slug, raw.legacy_cover_stem);
  const legacyVideo =
    releaseType === "single"
      ? raw.legacy_video ||
        legacyVideoPublicPath(raw.slug, raw.legacy_video_stem)
      : undefined;
  const visual = visualDiscoveryUrl(releaseType, raw.slug, {
    legacyVideo,
    legacyImage,
  });

  return {
    ...raw,
    display_title: raw.title,
    storage_path,
    artwork_path,
    preview_path,
    preview_legacy,
    video_path,
    visual,
    cover: visual,
    preview: previewDiscoveryUrl(preview_path, preview_legacy),
    video: releaseType === "single" ? visual : undefined,
    coverArtType: releaseType === "single" ? "video" : "image",
  };
}

function enrichTrack(raw) {
  const album = CANONICAL_ALBUMS.find((a) => a.slug === raw.album_slug);
  const releaseType = album?.release_type || "album";
  return {
    ...raw,
    display_title: raw.title,
    storage_path: resolveStoragePath(releaseType, raw.album_slug, raw.slug),
    albumSlug: raw.album_slug,
  };
}

const _releasesBySlug = new Map();
const _tracksByAlbum = new Map();
const _tracksBySlug = new Map();

function indexCatalog() {
  if (_releasesBySlug.size) return;
  [...CANONICAL_SINGLES, ...CANONICAL_FEATURES, ...CANONICAL_ALBUMS].forEach((r) => {
    const enriched = enrichRelease(r);
    _releasesBySlug.set(r.slug, enriched);
  });
  Object.entries(CANONICAL_SLUG_ALIASES).forEach(([alias, canonical]) => {
    const hit = _releasesBySlug.get(canonical);
    if (hit) _releasesBySlug.set(alias, hit);
  });
  CANONICAL_TRACKS.forEach((t) => {
    const enriched = enrichTrack(t);
    _tracksBySlug.set(`${t.album_slug}:${t.slug}`, enriched);
    _tracksBySlug.set(t.slug, enriched);
    if (!_tracksByAlbum.has(t.album_slug)) _tracksByAlbum.set(t.album_slug, []);
    _tracksByAlbum.get(t.album_slug).push(enriched);
  });
  _tracksByAlbum.forEach((list) => list.sort((a, b) => a.track_number - b.track_number));
}

export function getCanonicalReleaseBySlug(slug) {
  indexCatalog();
  const key = CANONICAL_SLUG_ALIASES[slug] || slug;
  return _releasesBySlug.get(key) || null;
}

export function getCanonicalTracksForAlbum(albumSlug) {
  indexCatalog();
  const key = CANONICAL_SLUG_ALIASES[albumSlug] || albumSlug;
  return _tracksByAlbum.get(key) || [];
}

export function getCanonicalTrack(albumSlug, trackSlug) {
  indexCatalog();
  const key = CANONICAL_SLUG_ALIASES[albumSlug] || albumSlug;
  return _tracksBySlug.get(`${key}:${trackSlug}`) || _tracksBySlug.get(trackSlug) || null;
}

export function getStorefrontSingles() {
  indexCatalog();
  return [...CANONICAL_SINGLES]
    .map((r) => _releasesBySlug.get(r.slug))
    .sort((a, b) => String(b.release_date).localeCompare(String(a.release_date)));
}

export function getStorefrontFeatures() {
  indexCatalog();
  return CANONICAL_FEATURES.map((r) => _releasesBySlug.get(r.slug));
}

export function getStorefrontAlbums() {
  indexCatalog();
  return [...CANONICAL_ALBUMS]
    .map((album) => {
      const enriched = _releasesBySlug.get(album.slug);
      const tracks = getCanonicalTracksForAlbum(album.slug);
      return {
        ...enriched,
        type: "album",
        price: (enriched.price_cents || 0) / 100,
        date: enriched.release_date,
        vinyl: 47.99,
        release_category: enriched.release_category,
        tracks,
        trackTitles: tracks.map((t) => t.title),
      };
    })
    .sort((a, b) => String(b.release_date).localeCompare(String(a.release_date)));
}

export function toStorefrontCard(release, extras = {}) {
  if (!release) return null;
  const type = release.release_type === "feature" ? "feature" : "single";
  return {
    slug: release.slug,
    title: release.title,
    type,
    cover: release.cover,
    video: release.video,
    price: (release.price_cents || 0) / 100,
    preview: release.preview,
    storage_path: release.storage_path,
    artwork_path: release.artwork_path,
    preview_path: release.preview_path,
    csAudio: null,
    csCover: null,
    hasCs: false,
    ...extras,
  };
}

export function getStorefrontSingleCards() {
  return getStorefrontSingles().map((r) => toStorefrontCard(r));
}

export function getStorefrontFeatureCards() {
  return getStorefrontFeatures().map((r) =>
    toStorefrontCard(r, { featuring: "FT. 2MRRW" })
  );
}

export function getCanonicalProductRows() {
  indexCatalog();
  const rows = [];

  [...CANONICAL_SINGLES, ...CANONICAL_FEATURES].forEach((raw) => {
    const r = _releasesBySlug.get(raw.slug);
    rows.push({
      slug: r.slug,
      title: r.title,
      display_title: r.title,
      product_type: r.release_type === "feature" ? "feature" : "single",
      price_cents: r.price_cents,
      cover_url: r.cover,
      storage_path: storagePathForProductRow(r.storage_path),
      preview_path: r.preview_path,
      artwork_path: r.artwork_path,
      video_path: r.video_path,
      release_date: r.release_date,
      metadata: { release_category: r.release_type, canonical: true },
    });
  });

  CANONICAL_ALBUMS.forEach((raw) => {
    const r = _releasesBySlug.get(raw.slug);
    rows.push({
      slug: r.slug,
      title: r.title,
      display_title: r.title,
      product_type: "album",
      price_cents: r.price_cents,
      cover_url: r.cover,
      storage_path: null,
      preview_path: null,
      artwork_path: r.artwork_path,
      video_path: null,
      release_date: r.release_date,
      metadata: {
        release_category: r.release_category || r.release_type,
        canonical: true,
      },
    });
  });

  return rows;
}

export function getCanonicalTrackRows() {
  indexCatalog();
  return CANONICAL_TRACKS.map((t) => {
    const enriched = enrichTrack(t);
    return {
      album_slug: t.album_slug,
      track_number: t.track_number,
      slug: t.slug,
      title: t.title,
      display_title: t.title,
      storage_path: storagePathForProductRow(enriched.storage_path),
    };
  });
}

export function mergeCanonicalMetadata(item) {
  if (!item?.slug) return item;
  const release = getCanonicalReleaseBySlug(item.slug);
  if (release) {
    return {
      ...item,
      title: release.title,
      display_title: release.title,
      storage_path: item.storage_path || release.storage_path,
      artwork_path: release.artwork_path || item.artwork_path,
      preview_path: release.preview_path || item.preview_path,
      preview: release.preview || item.preview,
      cover: release.cover || item.cover,
      visual: release.visual || item.visual,
      video: release.video || item.video,
      coverArtType: release.coverArtType || item.coverArtType,
      release_date: item.release_date || release.release_date,
    };
  }
  return item;
}

/** Drop memoized slug/track indexes so folder paths re-enrich from source arrays. */
export function clearCanonicalCatalogCache() {
  _releasesBySlug.clear();
  _tracksByAlbum.clear();
  _tracksBySlug.clear();
}

/**
 * Rebuild in-memory catalog indexes from CANONICAL_* source arrays.
 * Call after canonical-catalog edits or when stale folder paths are suspected.
 */
export function rebuildCanonicalCatalogMappings() {
  clearCanonicalCatalogCache();
  indexCatalog();
  return {
    singles: getStorefrontSingles(),
    features: getStorefrontFeatures(),
    albums: getStorefrontAlbums(),
    productRows: getCanonicalProductRows(),
    trackRows: getCanonicalTrackRows(),
  };
}
