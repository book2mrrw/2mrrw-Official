import { STREAM_SIGNED_URL_TTL_SECONDS } from "@/lib/playback/stream-pipeline";

/**
 * Client-side TTL for signed stream URLs.
 * Derived from server presign duration (STREAM_SIGNED_URL_TTL_SECONDS) minus a 5-minute
 * safety margin, so clients refresh before R2 expiry under any clock skew.
 * Exported so all consumers share one canonical value — import instead of hardcoding.
 */
export const SIGNED_URL_CLIENT_TTL_MS = Math.max(
  60_000,
  STREAM_SIGNED_URL_TTL_SECONDS * 1000 - 5 * 60 * 1000
);

const CACHE_TTL_MS = SIGNED_URL_CLIENT_TTL_MS;

/** @type {Map<string, { url: string, expiresAt: number }>} */
const cache = new Map();
/** @type {Map<string, Promise<{ url: string, cacheHit: boolean }>>} */
const inflight = new Map();

const CACHE_MAX_ENTRIES = 200;

function evictCache() {
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
    if (cache.size <= CACHE_MAX_ENTRIES) return;
  }
  // If still over limit, evict by insertion order (Map preserves it)
  for (const key of cache.keys()) {
    cache.delete(key);
    if (cache.size <= CACHE_MAX_ENTRIES) return;
  }
}

export function streamCacheKey(userId, slug, trackSlug = null) {
  return trackSlug ? `${userId}:${slug}:${trackSlug}` : `${userId}:${slug}`;
}

function deleteKeysMatching(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

/**
 * @returns {Promise<{ url: string, cacheHit: boolean }>}
 */
export async function getOrCreateStreamSignedUrl(userId, slug, factory, trackSlug = null) {
  const key = streamCacheKey(userId, slug, trackSlug);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return { url: hit.url, cacheHit: true };

  if (inflight.has(key)) return inflight.get(key);

  const promise = Promise.resolve()
    .then(factory)
    .then((url) => {
      cache.set(key, { url, expiresAt: now + CACHE_TTL_MS });
      evictCache();
      inflight.delete(key);
      return { url, cacheHit: false };
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

export function invalidateStreamCacheForUser(userId, slug = null) {
  if (slug) {
    deleteKeysMatching(`${userId}:${slug}`);
    return;
  }
  deleteKeysMatching(`${userId}:`);
}

/** Clear all in-memory signed stream URL entries (tests / hot reload). */
export function clearStreamUrlCache() {
  cache.clear();
  inflight.clear();
}

/** @alias clearStreamUrlCache */
export const clearCache = clearStreamUrlCache;
