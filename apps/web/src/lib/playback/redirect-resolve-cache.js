/**
 * Module-level singleton: slug → resolved CDN URL after following a redirect-path 302.
 * Written by audio probes (viewport / hover) and by AudioContext's onPlay handler.
 * Read by AudioContext's playTrackInternal to skip the proxy round-trip on known tracks.
 */
export const redirectResolveCache = {};

// R2 pre-signed URLs expire after 60 min server-side. Cache entries older than
// 50 min are treated as stale so playback never attempts a guaranteed-403 URL.
// IMPORTANT: this declaration must come BEFORE registerCache() — ESM strict mode
// enforces TDZ (Temporal Dead Zone) for const, so referencing CDN_URL_TTL_MS
// inside the registerCache call before its declaration causes a ReferenceError.
const CDN_URL_TTL_MS = 50 * 60 * 1000;

import { registerCache } from "@/lib/playback/playback-cache-manager";
registerCache("redirect-resolve", {
  maxEntries: 200,
  ttlMs: CDN_URL_TTL_MS,
  getSize: () => Object.keys(redirectResolveCache).length,
  evict: () => {
    // Sort by last-used timestamp (LRU) so recently-accessed entries survive
    // eviction regardless of when they were first written. Legacy plain-string
    // entries (no lastUsed) fall back to their write time (ts).
    const entries = Object.entries(redirectResolveCache).sort(([, a], [, b]) => {
      const tsA = typeof a === "object" && a !== null ? (a.lastUsed ?? a.ts ?? 0) : 0;
      const tsB = typeof b === "object" && b !== null ? (b.lastUsed ?? b.ts ?? 0) : 0;
      return tsA - tsB; // ascending = least recently used first
    });
    const overage = entries.length - 150;
    for (let i = 0; i < overage; i++) delete redirectResolveCache[entries[i][0]];
  },
});

export function setResolvedCdnUrl(slug, cdnUrl) {
  if (slug && cdnUrl) {
    const now = Date.now();
    redirectResolveCache[slug] = { url: cdnUrl, ts: now, lastUsed: now };
  }
}

export function getResolvedCdnUrl(slug) {
  if (!slug) return null;
  const entry = redirectResolveCache[slug];
  if (!entry) return null;
  // Support legacy plain-string entries written before this TTL scheme.
  if (typeof entry === "string") return entry;
  if (Date.now() - entry.ts > CDN_URL_TTL_MS) {
    delete redirectResolveCache[slug];
    return null;
  }
  // Update last-used for LRU eviction ordering.
  entry.lastUsed = Date.now();
  return entry.url;
}

let _activeProbes = 0;
const MAX_ACTIVE_PROBES = 4;

function isSlowConnection() {
  if (typeof navigator === "undefined") return false;
  const conn = navigator.connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  const type = conn.effectiveType;
  return type === "slow-2g" || type === "2g";
}

// Build the cache key for a redirect URL. For album tracks the URL contains both
// slug (albumSlug) and trackSlug params — combine them so tracks in the same album
// don't overwrite each other's resolved CDN URL.
function redirectCacheKey(slug, url) {
  if (!url) return slug;
  try {
    const qs = url.includes("?") ? url.split("?")[1] : "";
    const trackSlug = new URLSearchParams(qs).get("trackSlug");
    return trackSlug ? `${slug}:${trackSlug}` : slug;
  } catch { return slug; }
}

/**
 * Fire a lightweight audio probe to resolve a redirect-path URL to its CDN URL.
 * Uses preload="metadata" — downloads only the audio container header (~2-8 KB),
 * not the full track. Stores result in redirectResolveCache for instant reuse.
 *
 * Throttled to MAX_ACTIVE_PROBES concurrent, skipped on data-saver / very slow connections.
 */
export function probeRedirectUrl(slug, redirectUrl) {
  if (!slug || !redirectUrl) return;
  if (typeof window === "undefined") return;
  const cacheKey = redirectCacheKey(slug, redirectUrl);
  if (getResolvedCdnUrl(cacheKey)) return; // already resolved and not expired
  if (_activeProbes >= MAX_ACTIVE_PROBES) return;
  if (isSlowConnection()) return;

  _activeProbes++;
  const probe = document.createElement("audio");
  probe.preload = "metadata";
  probe.muted = true;
  probe.volume = 0;

  // One-shot guard: setting probe.src="" in cleanup fires an "abort" event, which
  // would call cleanup() a second time and decrement _activeProbes twice. Over many
  // network errors this drives _activeProbes negative, breaking the concurrency cap.
  let _cleanedUp = false;
  const cleanup = () => {
    if (_cleanedUp) return;
    _cleanedUp = true;
    _activeProbes--;
    try { probe.src = ""; probe.load(); } catch {}
  };

  probe.addEventListener(
    "loadedmetadata",
    () => {
      const cdn = probe.currentSrc;
      if (cdn && cdn !== redirectUrl) setResolvedCdnUrl(cacheKey, cdn);
      cleanup();
    },
    { once: true }
  );
  probe.addEventListener("error", cleanup, { once: true });
  probe.addEventListener("abort", cleanup, { once: true });

  probe.src = redirectUrl;
  probe.load();
}

// Track which slug is currently being eagerly probed to avoid duplicate probes.
let _eagerSlug = null;

/**
 * Resolve the redirect URL for the topmost visible card to its CDN URL using a
 * CORS-aware probe. Unlike probeRedirectUrl, this probe sets crossOrigin="anonymous"
 * so the main <audio crossOrigin="anonymous"> element can reuse the browser's
 * cached response — eliminating the 302 round-trip on play with zero resource contention.
 *
 * Intentionally does NOT use preload="auto" — a singleton preload element competing
 * for iOS Safari's per-domain media connection slots causes the main audio element
 * to stall, producing silence on tap.
 */
export function eagerPrimeFirstCard(slug, redirectUrl) {
  if (!slug || !redirectUrl || typeof window === "undefined") return;
  if (isSlowConnection()) return;
  if (_eagerSlug === slug) return;
  _eagerSlug = slug;

  const cacheKey = redirectCacheKey(slug, redirectUrl);
  if (getResolvedCdnUrl(cacheKey)) return; // already resolved and not expired — fast-path 1 is ready

  if (_activeProbes >= MAX_ACTIVE_PROBES) return;
  _activeProbes++;

  const probe = document.createElement("audio");
  probe.preload = "metadata";
  probe.muted = true;
  probe.volume = 0;
  probe.crossOrigin = "anonymous";

  let _cleanedUp = false;
  const cleanup = () => {
    if (_cleanedUp) return;
    _cleanedUp = true;
    _activeProbes--;
    try { probe.src = ""; probe.load(); } catch {}
  };

  probe.addEventListener("loadedmetadata", () => {
    const cdn = probe.currentSrc;
    if (cdn && cdn !== redirectUrl) setResolvedCdnUrl(cacheKey, cdn);
    cleanup();
  }, { once: true });
  probe.addEventListener("error", () => {
    cleanup();
    probeRedirectUrl(slug, redirectUrl);
  }, { once: true });
  probe.addEventListener("abort", cleanup, { once: true });

  probe.src = redirectUrl;
  probe.load();
}

/**
 * Clear the eager-prime tracking slug when the first visible card leaves the viewport.
 * In-flight probes are lightweight (metadata only) and complete harmlessly.
 */
export function cancelEagerPrime(slug) {
  if (_eagerSlug === slug) _eagerSlug = null;
}

/**
 * Pre-buffer initial audio bytes for a track that the user is likely about to play
 * (e.g., hovering the play button). Reuses an existing preload element provided by
 * the caller so we don't create extra DOM nodes. Sets src + load() but NOT play().
 *
 * Returns cleanup function to call if the user moves away without clicking.
 */
export function primeAudioElement(el, cdnOrRedirectUrl) {
  if (!el || !cdnOrRedirectUrl) return () => {};
  if (el.src === cdnOrRedirectUrl || el.currentSrc === cdnOrRedirectUrl) return () => {};
  try {
    el.preload = "auto";
    el.src = cdnOrRedirectUrl;
    el.load();
  } catch {}
  return () => {
    try { el.src = ""; el.load(); } catch {};
  };
}
