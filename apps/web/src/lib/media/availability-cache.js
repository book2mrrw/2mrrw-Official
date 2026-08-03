/** In-memory availability cache — client-safe; no R2 or entity-resolver imports. */

const AVAILABILITY_CACHE_TTL_MS = 5 * 60 * 1000;
/** @type {Map<string, { expiresAt: number, value: object }>} */
const availabilityCache = new Map();
/** @type {Map<string, Promise<object>>} */
const inflightAvailability = new Map();

function availabilityCacheKey({ slug, trackSlug, albumSlug }) {
  return `${String(slug || "").trim()}|${String(trackSlug || "").trim()}|${String(albumSlug || "").trim()}`;
}

/** Read cached availability (5 min TTL) — no R2 calls. */
export function getCachedAvailability(slug, trackSlug, albumSlug) {
  const key = availabilityCacheKey({ slug, trackSlug, albumSlug });
  const hit = availabilityCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    availabilityCache.delete(key);
    return null;
  }
  return hit.value;
}

export function writeAvailabilityCache(params, value) {
  const key = availabilityCacheKey(params);
  availabilityCache.set(key, {
    value,
    expiresAt: Date.now() + AVAILABILITY_CACHE_TTL_MS,
  });
}

export function getInflightAvailability(params) {
  return inflightAvailability.get(availabilityCacheKey(params));
}

export function setInflightAvailability(params, promise) {
  inflightAvailability.set(availabilityCacheKey(params), promise);
}

export function deleteInflightAvailability(params) {
  inflightAvailability.delete(availabilityCacheKey(params));
}

/** Clear availability cache (tests / hot reload). */
export function clearMediaAvailabilityCache() {
  availabilityCache.clear();
  inflightAvailability.clear();
}
