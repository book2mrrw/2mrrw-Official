const CACHE_TTL_MS = 8 * 60 * 1000;

/** @type {Map<string, { url: string, expiresAt: number }>} */
const cache = new Map();
/** @type {Map<string, Promise<string>>} */
const inflight = new Map();

export function streamCacheKey(userId, slug) {
  return `${userId}:${slug}`;
}

export async function getOrCreateStreamSignedUrl(userId, slug, factory) {
  const key = streamCacheKey(userId, slug);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.url;

  if (inflight.has(key)) return inflight.get(key);

  const promise = Promise.resolve()
    .then(factory)
    .then((url) => {
      cache.set(key, { url, expiresAt: now + CACHE_TTL_MS });
      inflight.delete(key);
      return url;
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
    cache.delete(streamCacheKey(userId, slug));
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}
