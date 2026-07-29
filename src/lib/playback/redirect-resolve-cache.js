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
  if (redirectResolveCache[slug]) return; // already resolved
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
      if (cdn && cdn !== redirectUrl) setResolvedCdnUrl(slug, cdn);
      cleanup();
    },
    { once: true }
  );
  probe.addEventListener("error", cleanup, { once: true });
  probe.addEventListener("abort", cleanup, { once: true });

  probe.src = redirectUrl;
  probe.load();
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
