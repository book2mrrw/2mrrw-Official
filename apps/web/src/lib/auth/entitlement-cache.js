/**
 * Slim localStorage cache for user entitlements.
 *
 * Written after /api/account/state responds; read synchronously on session
 * bootstrap so entitled users have library-stream access before the HTTP
 * round-trip completes. The server re-validates on every /api/library/stream
 * request, so a stale cache entry causes at most a 403 — never over-grants.
 */

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const KEY_PREFIX = "2mrrw-ent-v";

function cacheKey(userId) {
  return `${KEY_PREFIX}${CACHE_VERSION}:${userId}`;
}

/**
 * Persist slim entitlement data from /api/account/state.
 * Omits mediaProgress (not needed for access decisions) and caps library
 * size to keep the entry well within localStorage limits.
 */
export function writeEntitlementsCache(userId, data) {
  if (typeof window === "undefined" || !userId) return;
  try {
    const entry = {
      userId,
      permissions: data.permissions || null,
      subscriberActive: Boolean(data.subscriberActive),
      collectorCard: Boolean(data.collectorCard),
      vaultAccess: Boolean(data.vaultAccess),
      vaultAccessDetail: data.vaultAccessDetail || null,
      membership: data.membership || null,
      collectorOwnerships: (data.collectorOwnerships || []).slice(0, 50),
      ownedSlugs: (data.ownedSlugs || []).slice(0, 1000),
      library: (data.library || []).slice(0, 500),
      userEntitlements: data.userEntitlements || null,
      syncedAt: data.syncedAt || null,
      // Platform session policy — resolved server-side, cached so playback decisions
      // are available synchronously on session bootstrap before the HTTP round-trip.
      tier: data.tier || null,
      playbackPolicy: data.playbackPolicy || null,
      cachedAt: Date.now(),
    };
    localStorage.setItem(cacheKey(userId), JSON.stringify(entry));
  } catch {
    /* localStorage may be unavailable (private mode, storage full, etc.) */
  }
}

/**
 * Read cached entitlements for a user.
 * Returns null if absent, expired, or malformed.
 */
export function readEntitlementsCache(userId) {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || entry.userId !== userId) return null;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      try { localStorage.removeItem(cacheKey(userId)); } catch { /* ignore */ }
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

/**
 * Remove the entitlement cache for a user (call on sign-out).
 * Also sweeps any entries from older cache versions.
 */
export function clearEntitlementsCache(userId) {
  if (typeof window === "undefined") return;
  try {
    if (userId) {
      try { localStorage.removeItem(cacheKey(userId)); } catch { /* ignore */ }
    }
    // Sweep old cache versions left from prior deployments.
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX) && k !== cacheKey(userId)) toRemove.push(k);
    }
    for (const k of toRemove) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  } catch {
    /* ignore */
  }
}
