/**
 * Two-level entitlement cache: L1 in-process Map → L2 Upstash Redis → Supabase (source of truth).
 *
 * Two cache namespaces:
 *
 *   TIER cache  (`ent:tier:{userId}`)
 *     Stores the user's global streaming tier: { canStreamAll, isAdmin, isSubscriber, isCollector }
 *     SUBSCRIBER and COLLECTOR users can stream the entire digital catalog — a single tier cache
 *     hit short-circuits all per-slug ownership lookups, eliminating 4–8 DB queries per play.
 *     Invalidated on membership change, collector grant/revoke, admin privilege change.
 *
 *   SLUG cache  (`ent:slug:{userId}:{slug}`)
 *     Stores the resolved boolean for a specific user+slug pair.
 *     Covers all tiers after first resolution — PURCHASER/ENTRY users get per-slug caching
 *     so repeated plays of the same track cost 0 DB queries.
 *     Invalidated on purchase completion for that slug.
 *
 * Inflight coalescing: concurrent misses for the same (userId, slug) key from the same instance
 * share a single factory call — a cold-start thundering herd of 1000 simultaneous play events
 * results in exactly 1 DB round-trip for that (user, slug) pair.
 *
 * Redis unavailability: L2 reads/writes silently fail; L1 continues to serve warm instances
 * and the factory fallback reaches the DB transparently. Zero error propagation to callers.
 */

import { Redis } from "@upstash/redis";

// ── L2: Upstash Redis ─────────────────────────────────────────────────────────

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

// ── Tuning constants ──────────────────────────────────────────────────────────

const TIER_L1_TTL_MS   = 30_000;   // 30 s — in-process tier cache
const SLUG_L1_TTL_MS   = 30_000;   // 30 s — in-process slug cache
const L1_MAX_ENTRIES   = 1_000;    // bounded per-instance memory footprint

const TIER_REDIS_TTL_S = 120;      // 2 min — membership events propagate via webhook invalidation
const SLUG_REDIS_TTL_S = 300;      // 5 min — purchase ownership is stable; webhook invalidates earlier

// ── L1 stores ────────────────────────────────────────────────────────────────

/** @type {Map<string, { value: object, ts: number }>} */
const _tierL1 = new Map();
/** @type {Map<string, { result: boolean, ts: number }>} */
const _slugL1 = new Map();
/** @type {Map<string, Promise<any>>} */
const _inflight = new Map();

function evictL1(map) {
  if (map.size <= L1_MAX_ENTRIES) return;
  // Insertion-order walk = LRU approximation; evict oldest 20%
  const overage = map.size - Math.floor(L1_MAX_ENTRIES * 0.8);
  let i = 0;
  for (const key of map.keys()) {
    if (i++ >= overage) break;
    map.delete(key);
  }
}

// ── Tier cache ────────────────────────────────────────────────────────────────

/**
 * @param {string} userId
 * @returns {Promise<{ canStreamAll: boolean, isAdmin?: boolean, isSubscriber?: boolean, isCollector?: boolean }|null>}
 */
export async function getCachedTier(userId) {
  // L1
  const l1 = _tierL1.get(userId);
  if (l1 && Date.now() - l1.ts < TIER_L1_TTL_MS) return l1.value;

  // L2
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`ent:tier:${userId}`);
    if (raw !== null && raw !== undefined) {
      const value = typeof raw === "string" ? JSON.parse(raw) : raw;
      evictL1(_tierL1);
      _tierL1.set(userId, { value, ts: Date.now() });
      return value;
    }
  } catch {}
  return null;
}

/**
 * @param {string} userId
 * @param {{ canStreamAll: boolean, isAdmin?: boolean, isSubscriber?: boolean, isCollector?: boolean }} value
 */
export async function setCachedTier(userId, value) {
  evictL1(_tierL1);
  _tierL1.set(userId, { value, ts: Date.now() });
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.setex(`ent:tier:${userId}`, TIER_REDIS_TTL_S, JSON.stringify(value));
  } catch {}
}

// ── Per-slug cache ────────────────────────────────────────────────────────────

/**
 * @param {string} userId
 * @param {string} slug
 * @returns {Promise<boolean|null>}  null = cache miss
 */
export async function getCachedSlugResult(userId, slug) {
  const mapKey = `${userId}:${slug}`;

  // L1
  const l1 = _slugL1.get(mapKey);
  if (l1 && Date.now() - l1.ts < SLUG_L1_TTL_MS) return l1.result;

  // L2
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`ent:slug:${userId}:${slug}`);
    if (raw !== null && raw !== undefined) {
      const result = raw === "1" || raw === true || raw === 1;
      evictL1(_slugL1);
      _slugL1.set(mapKey, { result, ts: Date.now() });
      return result;
    }
  } catch {}
  return null;
}

/**
 * @param {string} userId
 * @param {string} slug
 * @param {boolean} result
 */
export async function setCachedSlugResult(userId, slug, result) {
  const mapKey = `${userId}:${slug}`;
  evictL1(_slugL1);
  _slugL1.set(mapKey, { result, ts: Date.now() });
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.setex(`ent:slug:${userId}:${slug}`, SLUG_REDIS_TTL_S, result ? "1" : "0");
  } catch {}
}

// ── Inflight coalescing ───────────────────────────────────────────────────────

/**
 * Coalesces concurrent calls with the same key behind a single factory invocation.
 * All callers waiting on the same key receive the same resolved value.
 *
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} factory
 * @returns {Promise<T>}
 */
export function withInflight(key, factory) {
  if (_inflight.has(key)) return _inflight.get(key);
  const promise = factory().finally(() => _inflight.delete(key));
  _inflight.set(key, promise);
  return promise;
}

// ── Invalidation ──────────────────────────────────────────────────────────────

/**
 * Invalidate the tier cache for a user.
 * Call on membership change, collector grant/revoke, or admin privilege change.
 *
 * @param {string} userId
 */
export async function invalidateEntitlementTierCache(userId) {
  _tierL1.delete(userId);
  const redis = getRedis();
  if (!redis) return;
  try { await redis.del(`ent:tier:${userId}`); } catch {}
}

/**
 * Invalidate the per-slug cache entry for a specific user+slug.
 * Call on purchase completion or entitlement grant for that slug.
 *
 * @param {string} userId
 * @param {string} slug
 */
export async function invalidateEntitlementSlugCache(userId, slug) {
  _slugL1.delete(`${userId}:${slug}`);
  const redis = getRedis();
  if (!redis) return;
  try { await redis.del(`ent:slug:${userId}:${slug}`); } catch {}
}

/**
 * Invalidate all entitlement cache entries for a user across both namespaces.
 * Accepts an optional list of specific slugs for targeted Redis key deletion.
 * Call after any purchase, grant, or revoke that changes what a user can stream.
 *
 * @param {string} userId
 * @param {string[]} [slugs]  specific slugs to invalidate; tier is always invalidated
 */
export async function invalidateUserEntitlementCache(userId, slugs = []) {
  // L1 — synchronous, immediate
  _tierL1.delete(userId);
  for (const slug of slugs) _slugL1.delete(`${userId}:${slug}`);

  // L2 — pipeline all deletes in a single round-trip
  const redis = getRedis();
  if (!redis) return;
  try {
    const pipeline = redis.pipeline();
    pipeline.del(`ent:tier:${userId}`);
    for (const slug of slugs) pipeline.del(`ent:slug:${userId}:${slug}`);
    await pipeline.exec();
  } catch {}
}
