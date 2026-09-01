import {
  ensureRelativeSiteApiPath,
  isSiteApiMediaPath,
  repairMisboundR2ApiUrl,
} from "@/lib/media/site-api-url";

const artworkEntriesCache = new Map();

function r2PublicBase() {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_R2_PUBLIC_URL) {
    return String(process.env.NEXT_PUBLIC_R2_PUBLIC_URL).replace(/\/$/, "");
  }
  return null;
}

function mimeFromUrl(url) {
  if (/\.jpe?g($|[?#])/i.test(url)) return "image/jpeg";
  if (/\.png($|[?#])/i.test(url)) return "image/png";
  if (/\.webp($|[?#])/i.test(url)) return "image/webp";
  if (/\.avif($|[?#])/i.test(url)) return "image/avif";
  return "";
}

function isFetchableSystemArtworkUrl(src) {
  try {
    const parsed = new URL(src, typeof window !== "undefined" ? window.location?.origin : undefined);
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function mediaSessionTrackIdentity(track) {
  if (!track) return "";
  const cover = resolveAbsoluteArtworkUrl(
    track.baseCover || track.coverArt || track.coverUrl || track.cover || ""
  );
  const revision =
    track.artwork_revision ||
    track.artworkRevision ||
    track.cover_art_revision ||
    track.coverArtRevision ||
    "";
  return [
    track.id || track.trackId || "",
    track.slug || "",
    track.title || "",
    track.artist || "",
    track.album || "",
    revision,
    cover,
  ].join("|");
}

/**
 * Resolve cover paths to absolute HTTPS URLs for Media Session / lock screen.
 */
export function resolveAbsoluteArtworkUrl(cover) {
  if (!cover) return "";
  let raw = String(cover).trim();
  if (!raw) return "";
  raw = repairMisboundR2ApiUrl(raw);
  if (raw.startsWith("blob:") || raw.startsWith("data:")) {
    return raw;
  }
  if (isSiteApiMediaPath(raw)) {
    const relative = ensureRelativeSiteApiPath(raw);
    if (typeof window !== "undefined" && window.location?.origin) {
      try {
        return new URL(relative, window.location.origin).href;
      } catch {
        return relative;
      }
    }
    return relative;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  const withoutLeading = raw.replace(/^\//, "");
  const r2 = r2PublicBase();
  // Only prepend R2 for paths that are NOT leading-slash (those are Next.js public dir assets).
  // R2 object keys are always relative (no leading /); e.g. "images/singles/w2d/cover.jpeg".
  if (r2 && !raw.startsWith("/") && !raw.includes("://") && !isSiteApiMediaPath(withoutLeading)) {
    return `${r2}/${withoutLeading}`;
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    try {
      const path = raw.startsWith("/") ? raw : `/${withoutLeading}`;
      return new URL(path, window.location.origin).href;
    } catch {
      return raw;
    }
  }

  return raw.startsWith("/") ? raw : `/${withoutLeading}`;
}

/**
 * Build a standards-valid MediaMetadata artwork array.
 *
 * A single original image must not be advertised as five different physical
 * sizes. Browsers use `sizes` to choose a real derivative; a false declaration
 * can make Chromium reject or mis-cache lock-screen artwork. Existing catalog
 * authority currently exposes one static source, so publish that source once.
 */
export function buildArtworkEntries(cover) {
  const src = resolveAbsoluteArtworkUrl(cover);
  if (!src || !isFetchableSystemArtworkUrl(src)) return [];
  const type = mimeFromUrl(src);
  return [{ src, ...(type ? { type } : {}) }];
}

/**
 * Preload artwork so lock screen metadata can render reliably.
 */
export function preloadArtwork(url) {
  const resolved = resolveAbsoluteArtworkUrl(url);
  if (!resolved || typeof Image === "undefined") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = resolved;
  });
}

/**
 * Cached artwork entries keyed by stable track identity plus the concrete
 * artwork URL. A cover revision for the same slug must be a cache miss.
 */
export async function getArtworkEntriesForTrack(cover, slug) {
  const absolute = resolveAbsoluteArtworkUrl(cover);
  const cacheKey = `${slug || ""}|${absolute}`;
  if (cacheKey && artworkEntriesCache.has(cacheKey)) {
    return artworkEntriesCache.get(cacheKey);
  }
  const entries = buildArtworkEntries(cover);
  if (cacheKey && entries.length) artworkEntriesCache.set(cacheKey, entries);
  // Warm browser image caches without delaying title/artist/artwork authority.
  if (absolute && entries.length) void preloadArtwork(absolute);
  return entries;
}

export function clearMediaSessionArtworkCache() {
  artworkEntriesCache.clear();
}

export const MEDIA_SESSION_TRACK_STORAGE_KEY = "2mrrw:media-session-track";

export function persistMediaSessionTrack(track, { playing, currentTime, duration }) {
  if (typeof sessionStorage === "undefined" || !track?.slug) return;
  try {
    sessionStorage.setItem(
      MEDIA_SESSION_TRACK_STORAGE_KEY,
      JSON.stringify({
        slug: track.slug,
        title: track.title,
        artist: track.artist,
        album: track.album,
        cover: track.baseCover || track.cover,
        artworkRevision:
          track.artwork_revision || track.artworkRevision || track.cover_art_revision || null,
        source: track.source,
        playing: Boolean(playing),
        currentTime: Number.isFinite(currentTime) ? currentTime : 0,
        duration: Number.isFinite(duration) ? duration : 0,
        at: Date.now(),
      })
    );
  } catch {
    /* quota / private mode */
  }
}

export function readPersistedMediaSessionTrack() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(MEDIA_SESSION_TRACK_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearPersistedMediaSessionTrack() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(MEDIA_SESSION_TRACK_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
