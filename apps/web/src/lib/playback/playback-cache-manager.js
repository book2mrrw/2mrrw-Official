/**
 * Unified playback cache registry.
 *
 * Each cache (redirect-resolve, prewarm, stream-url, preview-resolution, availability)
 * registers here on module init. The registry enforces a common governance interface:
 * max entries, TTL, eviction callbacks, and health reporting.
 *
 * This module has no side effects — it only records registrations and provides
 * the observability surface for admin dashboards and diagnostics.
 */

/** @type {Map<string, CacheRegistration>} */
const _registry = new Map();

/**
 * @typedef {object} CacheRegistration
 * @property {string} name
 * @property {number} maxEntries
 * @property {number} ttlMs
 * @property {() => number} getSize
 * @property {() => void} [evict]
 * @property {number} registeredAt
 * @property {number | null} lastPurgeAt
 * @property {number} purgeCount
 */

/**
 * Register a cache with the unified manager.
 *
 * @param {string} name          Unique cache identifier for diagnostics/admin.
 * @param {object} opts
 * @param {number} opts.maxEntries    Maximum number of entries before eviction.
 * @param {number} opts.ttlMs         Entry TTL in milliseconds.
 * @param {() => number} opts.getSize Returns current entry count (for live stats).
 * @param {() => void} [opts.evict]   Optional eviction callback (trim to maxEntries).
 */
export function registerCache(name, { maxEntries, ttlMs, getSize, evict }) {
  if (!name) return;
  _registry.set(name, {
    name,
    maxEntries: maxEntries ?? 100,
    ttlMs: ttlMs ?? 60_000,
    getSize: typeof getSize === "function" ? getSize : () => 0,
    evict: typeof evict === "function" ? evict : undefined,
    registeredAt: Date.now(),
    lastPurgeAt: null,
    purgeCount: 0,
  });
}

/** Report that a cache was purged (called by the cache after eviction runs). */
export function reportCachePurge(name) {
  const meta = _registry.get(name);
  if (!meta) return;
  meta.lastPurgeAt = Date.now();
  meta.purgeCount += 1;
}

/** Snapshot of all registered caches — for admin dashboards and diagnostics. */
export function getCacheRegistry() {
  return [..._registry.values()].map((meta) => ({
    name: meta.name,
    maxEntries: meta.maxEntries,
    ttlMs: meta.ttlMs,
    currentSize: meta.getSize(),
    fillPercent: meta.maxEntries > 0 ? Math.round((meta.getSize() / meta.maxEntries) * 100) : 0,
    registeredAt: meta.registeredAt,
    lastPurgeAt: meta.lastPurgeAt,
    purgeCount: meta.purgeCount,
  }));
}

/** Evict all caches that are over their maxEntries limit. Returns count of caches evicted. */
export function evictOverflowingCaches() {
  let evicted = 0;
  for (const meta of _registry.values()) {
    if (meta.evict && meta.getSize() > meta.maxEntries) {
      meta.evict();
      reportCachePurge(meta.name);
      evicted += 1;
    }
  }
  return evicted;
}

/** Aggregate health snapshot — for admin dashboard widgets. */
export function getCacheHealthSummary() {
  const caches = getCacheRegistry();
  const totalEntries = caches.reduce((sum, c) => sum + c.currentSize, 0);
  const atCapacity = caches.filter((c) => c.fillPercent >= 90);
  return {
    totalCaches: caches.length,
    totalEntries,
    atCapacity: atCapacity.map((c) => c.name),
    caches,
  };
}
