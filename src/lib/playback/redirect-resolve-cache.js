/**
 * Module-level singleton: slug → resolved CDN URL after following a redirect-path 302.
 * Written by audio probes (viewport / hover) and by AudioContext's onPlay handler.
 * Read by AudioContext's playTrackInternal to skip the proxy round-trip on known tracks.
 */
export const redirectResolveCache = {};

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

// Singleton element that buffers the first ~3s of audio for the topmost visible card.
let _eagerEl = null;
let _eagerSlug = null;

function getOrCreateEagerEl() {
  if (_eagerEl) return _eagerEl;
  if (typeof document === "undefined") return null;
  _eagerEl = document.createElement("audio");
  _eagerEl.muted = true;
  _eagerEl.volume = 0;
  _eagerEl.preload = "auto";
  _eagerEl.crossOrigin = "anonymous";
  return _eagerEl;
}

/**
 * Buffer the first ~3s of audio for the topmost visible card before the user taps.
 * Resolves the redirect URL to a CDN URL, then assigns it to a persistent singleton
 * <audio preload="auto"> element. When AudioContext plays the same CDN URL, the
 * browser serves the buffered bytes from cache — collapsing wait time to near zero.
 *
 * Only one card is eager-buffered at a time. Call cancelEagerPrime when the card
 * leaves the viewport. No-ops on slow connections and data-saver mode.
 */
export function eagerPrimeFirstCard(slug, redirectUrl) {
  if (!slug || !redirectUrl || typeof window === "undefined") return;
  if (isSlowConnection()) return;

  const cacheKey = redirectCacheKey(slug, redirectUrl);
  const cached = redirectResolveCache[cacheKey];

  if (cached) {
    if (_eagerSlug === slug) return;
    _eagerSlug = slug;
    const el = getOrCreateEagerEl();
    if (!el || el.src === cached) return;
    el.src = cached;
    el.load();
    return;
  }

  if (_eagerSlug === slug) return;
  _eagerSlug = slug;

  if (_activeProbes >= MAX_ACTIVE_PROBES) return;
  _activeProbes++;

  const probe = document.createElement("audio");
  probe.preload = "metadata";
  probe.muted = true;
  probe.volume = 0;
  probe.crossOrigin = "anonymous";

  const done = () => {
    _activeProbes--;
    try { probe.src = ""; probe.load(); } catch {}
  };

  probe.addEventListener("loadedmetadata", () => {
    const cdn = probe.currentSrc;
    if (cdn && cdn !== redirectUrl) setResolvedCdnUrl(cacheKey, cdn);
    done();
    if (_eagerSlug !== slug) return;
    const el = getOrCreateEagerEl();
    if (!el) return;
    const finalUrl = cdn || redirectUrl;
    if (el.src !== finalUrl) { el.src = finalUrl; el.load(); }
  }, { once: true });
  probe.addEventListener("error", () => { if (_eagerSlug === slug) _eagerSlug = null; done(); }, { once: true });
  probe.addEventListener("abort", () => { if (_eagerSlug === slug) _eagerSlug = null; done(); }, { once: true });

  probe.src = redirectUrl;
  probe.load();
}

/**
 * Release the eager buffer element when the first visible card leaves the viewport.
 */
export function cancelEagerPrime(slug) {
  if (_eagerSlug !== slug) return;
  _eagerSlug = null;
  const el = _eagerEl;
  if (el) {
    try { el.src = ""; el.load(); } catch {}
  }
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
