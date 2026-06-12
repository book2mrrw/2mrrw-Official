import { STREAM_SIGNED_URL_TTL_SECONDS } from "@/lib/playback/stream-pipeline";

/** Keep signed URLs valid — refresh before R2 presign expiry (1h). */
const CACHE_TTL_MS = Math.max(
  60_000,
  STREAM_SIGNED_URL_TTL_SECONDS * 1000 - 5 * 60 * 1000
);

/** @type {Map<string, { url: string, expiresAt: number }>} */
const cache = new Map();
/** @type {Map<string, Promise<{ url: string, cacheHit: boolean }>>} */
const inflight = new Map();

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
