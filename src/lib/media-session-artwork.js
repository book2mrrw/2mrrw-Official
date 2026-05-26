const ARTWORK_SIZE_ENTRIES = [
  { sizes: "96x96" },
  { sizes: "128x128" },
  { sizes: "256x256" },
  { sizes: "512x512" },
  { sizes: "1024x1024" },
];

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
  return "image/jpeg";
}

/**
 * Resolve cover paths to absolute HTTPS URLs for Media Session / lock screen.
 */
export function resolveAbsoluteArtworkUrl(cover) {
  if (!cover) return "";
  const raw = String(cover).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("blob:") || raw.startsWith("data:")) {
    return raw;
  }

  const withoutLeading = raw.replace(/^\//, "");
  const r2 = r2PublicBase();
  if (r2 && !raw.includes("://")) {
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
 * MediaMetadata artwork array with sizes iOS/Safari expects.
 */
export function buildArtworkEntries(cover) {
  const src = resolveAbsoluteArtworkUrl(cover);
  if (!src) return [];
  const type = mimeFromUrl(src);
  return ARTWORK_SIZE_ENTRIES.map(({ sizes }) => ({ src, sizes, type }));
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
 * Cached artwork entries keyed by track slug for fast re-hydration.
 */
export async function getArtworkEntriesForTrack(cover, slug) {
  const cacheKey = slug || resolveAbsoluteArtworkUrl(cover);
  if (cacheKey && artworkEntriesCache.has(cacheKey)) {
    return artworkEntriesCache.get(cacheKey);
  }
  const absolute = resolveAbsoluteArtworkUrl(cover);
  if (absolute) await preloadArtwork(absolute);
  const entries = buildArtworkEntries(cover);
  if (cacheKey && entries.length) artworkEntriesCache.set(cacheKey, entries);
  return entries;
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
        cover: track.cover,
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
