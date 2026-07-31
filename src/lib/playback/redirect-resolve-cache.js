/**
 * Module-level singleton: slug → resolved CDN URL after following a redirect-path 302.
 * Written by audio probes (viewport / hover) and by AudioContext's onPlay handler.
 * Read by AudioContext's playTrackInternal to skip the proxy round-trip on known tracks.
 */
export const redirectResolveCache = {};

import { registerCache } from "@/lib/playback/playback-cache-manager";
registerCache("redirect-resolve", {
  maxEntries: 200,
  ttlMs: 30_000,
  getSize: () => Object.keys(redirectResolveCache).length,
  evict: () => {
    const keys = Object.keys(redirectResolveCache);
    const overage = keys.length - 150;
    for (let i = 0; i < overage; i++) delete redirectResolveCache[keys[i]];
  },
});

export function setResolvedCdnUrl(slug, cdnUrl) {
  if (slug && cdnUrl) redirectResolveCache[slug] = cdnUrl;
}

export function getResolvedCdnUrl(slug) {
  return slug ? (redirectResolveCache[slug] || null) : null;
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
  if (redirectResolveCache[cacheKey]) return; // already resolved
  if (_activeProbes >= MAX_ACTIVE_PROBES) return;
  if (isSlowConnection()) return;

  _activeProbes++;
  const probe = document.createElement("audio");
  probe.preload = "metadata";
  probe.muted = true;
  probe.volume = 0;

  const cleanup = () => {
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
  if (redirectResolveCache[cacheKey]) return; // already resolved — fast-path 1 is ready

  if (_activeProbes >= MAX_ACTIVE_PROBES) return;
  _activeProbes++;

  const probe = document.createElement("audio");
  probe.preload = "metadata";
  probe.muted = true;
  probe.volume = 0;
  probe.crossOrigin = "anonymous";

  const cleanup = () => {
    _activeProbes--;
    try { probe.src = ""; probe.load(); } catch {}
  };

  probe.addEventListener("loadedmetadata", () => {
    const cdn = probe.currentSrc;
    if (cdn && cdn !== redirectUrl) setResolvedCdnUrl(cacheKey, cdn);
    cleanup();
  }, { once: true });
  probe.addEventListener("error", cleanup, { once: true });
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
