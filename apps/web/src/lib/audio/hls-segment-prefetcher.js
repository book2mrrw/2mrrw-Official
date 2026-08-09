/**
 * HLS segment prefetcher — Spotify-level next-track preloading.
 *
 * Pre-fetches the first N segments of the next queued HLS track into
 * the in-memory segment cache (hls-segment-cache). When hls.js later
 * loads that track, hls-prefetch-loader serves the cached bytes with
 * zero CDN latency, bringing buffer-gate satisfaction from 2–5 s to < 50 ms.
 *
 * Flow:
 *   1. GET /api/library/hls?slug=...     → master playlist (3 variant URLs)
 *   2. Pick highest-bitrate variant URL  → matches hls.js default ABR choice
 *   3. GET variant URL                   → media playlist with segment URLs
 *   4. Fetch first MAX_PRELOAD_SEGS CDN  → store encrypted .ts bytes in cache
 *      segment URLs (public, no auth)
 *
 * The segment bytes are AES-128 encrypted. hls.js decrypts them using the
 * key it fetches from /api/library/hls/key — we do not touch the key path.
 * Storing the encrypted bytes is safe: useless without the decryption key.
 *
 * Abort safety: calling this function for a new slug automatically cancels
 * any in-flight prefetch for a previous slug.
 *
 * Safari guard: isHlsJsActive() in scheduleNextTrackPreload ensures this
 * function is never called on Safari (native HLS, no hls.js).
 *
 * URL resolution: both _parseFirstVariantUrl and _parseSegmentUrls resolve
 * relative URLs against the final response URL (Response.url, post-redirect).
 * CDN HLS playlists overwhelmingly use absolute URLs, but relative paths in
 * dev/staging or after CDN URL rewrites are now handled correctly.
 *
 * _activeKey retention: on successful completion, _activeKey stays set for
 * the current track key. Duplicate calls (from the onTime safety-net and the
 * onPlay delayed-call) return early without re-fetching or clearing the cache.
 * _activeKey is only cleared when a new slug is requested (overwritten at the
 * top of the function) or on abort (signal.aborted in the finally block).
 */

import { setSegment, clearSegmentCache } from "./hls-segment-cache";

// Number of segments to prefetch — 3 × 6 s/segment = 18 s of audio.
// Enough to satisfy the 3-second buffer gate instantly and give hls.js
// time to download remaining segments before the buffer runs dry.
const MAX_PRELOAD_SEGS = 3;

let _activeKey = null;
let _activeController = null;

/**
 * Begin prefetching HLS segments for the given track in the background.
 * Fire-and-forget (no need to await).
 *
 * @param {string}      slug
 * @param {string|null} trackSlug
 */
export async function prefetchHlsSegmentsForTrack(slug, trackSlug = null) {
  const key = trackSlug ? `${slug}:${trackSlug}` : slug;
  // _activeKey === key on both: (a) an in-flight prefetch for this track, and
  // (b) a successfully completed prefetch — cached bytes are still valid.
  // In both cases, returning early is correct: either the work is happening or
  // the cache is already warm. Only a new-slug request should reset this.
  if (_activeKey === key) return;

  // Cancel any in-flight prefetch for a different track.
  _activeController?.abort();
  _activeController = new AbortController();
  _activeKey = key;
  clearSegmentCache(); // drop stale bytes from the previous next-track preload

  const { signal } = _activeController;

  try {
    // 1. Fetch the HLS master playlist.
    //    This endpoint requires auth (session cookie) and returns a ~200-byte
    //    M3U8 with 3 variant URLs (320k / 160k / 96k), each carrying an
    //    HMAC token. Cache-Control: no-store — never cached by the browser.
    const params = new URLSearchParams({ slug });
    if (trackSlug) params.set("trackSlug", trackSlug);
    const masterResp = await fetch(`/api/library/hls?${params}`, {
      credentials: "include",
      signal,
    });
    if (!masterResp.ok || signal.aborted) return;

    // Use Response.url as the base for relative URL resolution — this is the
    // final URL after any server-side redirects, which is the canonical base
    // for any relative paths in the playlist body.
    const masterBaseUrl = masterResp.url;
    const masterText = await masterResp.text();
    if (signal.aborted) return;

    // 2. Pick the first variant URL from the master playlist.
    //    The server emits variants in descending bitrate order (320k first),
    //    matching hls.js's startLevel: -1 choice on high-bandwidth connections.
    //    Relative variant URLs are resolved against masterBaseUrl.
    const variantUrl = _parseFirstVariantUrl(masterText, masterBaseUrl);
    if (!variantUrl) return;

    // 3. Fetch the variant (media) playlist.
    //    Auth is via the HMAC token embedded in the variant URL — no extra
    //    credentials header needed beyond the cookie for our own origin.
    //    Cache-Control: private, max-age=3000 — browser may cache this.
    const variantResp = await fetch(variantUrl, {
      credentials: "include",
      signal,
    });
    if (!variantResp.ok || signal.aborted) return;

    // Use the variant response URL as the base for segment relative paths.
    const variantBaseUrl = variantResp.url;
    const variantText = await variantResp.text();
    if (signal.aborted) return;

    // 4. Fetch the first N segments and store in the cache.
    //    Segment URLs are public Cloudflare CDN URLs — AES-128 encrypted,
    //    usable by anyone, decryptable only with the key from /api/library/hls/key.
    //    Relative segment URLs are resolved against variantBaseUrl.
    const segUrls = _parseSegmentUrls(variantText, variantBaseUrl);
    for (let i = 0; i < Math.min(MAX_PRELOAD_SEGS, segUrls.length); i++) {
      if (signal.aborted) break;
      try {
        const segResp = await fetch(segUrls[i], { signal });
        if (!segResp.ok || signal.aborted) break;
        const buf = await segResp.arrayBuffer();
        if (!signal.aborted) setSegment(segUrls[i], buf);
      } catch {
        break; // non-fatal — hls.js falls back to CDN on cache miss
      }
    }
  } catch (e) {
    if (e?.name !== "AbortError") {
      // Non-fatal — hls.js downloads segments from CDN on all cache misses
    }
  } finally {
    // On abort (new slug requested): _activeKey was already overwritten to the
    // new slug at the top of the function, so _activeKey !== key here — no-op.
    // On success: keep _activeKey === key so duplicate calls return early and
    // do not re-enter, clear the cache, and re-fetch already-cached segments.
    // This prevents the onTime safety-net from triggering a wasteful re-fetch
    // immediately after a successful completion.
    if (_activeKey === key && signal.aborted) _activeKey = null;
  }
}

/**
 * Returns the first non-comment, non-empty line from a master M3U8, resolved
 * as an absolute URL against baseUrl. Handles both absolute and relative URLs.
 *
 * @param {string} masterM3U8
 * @param {string} baseUrl  Final URL of the master playlist response (Response.url)
 * @returns {string|null}
 */
function _parseFirstVariantUrl(masterM3U8, baseUrl) {
  for (const line of masterM3U8.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    try {
      return new URL(t, baseUrl).href;
    } catch {
      // Malformed line — skip and keep looking
    }
  }
  return null;
}

/**
 * Returns all non-comment, non-empty lines from a variant M3U8 as absolute
 * URLs. Relative segment paths are resolved against baseUrl (the variant
 * playlist's Response.url). Silently skips any line that can't be parsed.
 *
 * @param {string} variantM3U8
 * @param {string} baseUrl  Final URL of the variant playlist response (Response.url)
 * @returns {string[]}
 */
function _parseSegmentUrls(variantM3U8, baseUrl) {
  const urls = [];
  for (const line of variantM3U8.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    try {
      const url = new URL(t, baseUrl).href;
      if (url.startsWith("http://") || url.startsWith("https://")) {
        urls.push(url);
      }
    } catch {
      // Skip unparseable lines
    }
  }
  return urls;
}
