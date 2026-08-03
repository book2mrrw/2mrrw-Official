const CACHE_TTL_MS = 60_000;

/** @type {Map<string, { key: string, source: string, expiresAt: number }>} */
const cache = new Map();
/** @type {Map<string, Promise<{ key: string, source: string } | null>>} */
const inflight = new Map();

export function previewCacheKey(folder, type, legacy) {
  const legacyKey = Array.isArray(legacy) ? legacy.join("|") : legacy || "";
  return `${type}:${folder || ""}:${legacyKey}`;
}

/**
 * @param {string} cacheKey
 * @param {() => Promise<{ key: string, source: string } | null>} factory
 */
export async function getOrResolvePreviewMedia(cacheKey, factory) {
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return { key: hit.key, source: hit.source, cacheHit: true };
  }

  if (inflight.has(cacheKey)) {
    const resolved = await inflight.get(cacheKey);
    return resolved ? { ...resolved, cacheHit: true } : null;
  }

  const promise = Promise.resolve()
    .then(factory)
    .then((resolved) => {
      inflight.delete(cacheKey);
      if (resolved?.key) {
        cache.set(cacheKey, {
          key: resolved.key,
          source: resolved.source,
          expiresAt: now + CACHE_TTL_MS,
        });
      }
      return resolved;
    })
    .catch((err) => {
      inflight.delete(cacheKey);
      throw err;
    });

  inflight.set(cacheKey, promise);
  const resolved = await promise;
  return resolved ? { ...resolved, cacheHit: false } : null;
}

export function clearPreviewResolutionCache() {
  cache.clear();
  inflight.clear();
}
