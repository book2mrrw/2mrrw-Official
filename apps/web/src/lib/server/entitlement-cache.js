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
let _redisOverride = null;
function getRedis() {
  if (_redisOverride !== null) return _redisOverride;
  if (_redis) return _redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

/**
 * Test seam — inject a Redis-compatible client, or `false` to simulate an
 * unreachable store. Pass `null` to restore normal resolution.
 */
export function __setRedisClientForTests(client) {
  _redisOverride = client === undefined ? null : client;
}

/** Test seam — clear all in-process L1 state between cases. */
export function __clearL1ForTests() {
  _tierL1.clear();
  _slugL1.clear();
  _inflight.clear();
}

// ── Tuning constants ──────────────────────────────────────────────────────────

const TIER_L1_TTL_MS   = 30_000;   // 30 s — in-process tier cache
const SLUG_L1_TTL_MS   = 30_000;   // 30 s — in-process slug cache
const L1_MAX_ENTRIES   = 1_000;    // bounded per-instance memory footprint

const TIER_REDIS_TTL_S = 120;      // 2 min — membership events propagate via webhook invalidation
const SLUG_REDIS_TTL_S = 300;      // 5 min — purchase ownership is stable; webhook invalidates earlier

const GEN_REDIS_TTL_S  = 86_400;   // 24 h — generation counter outlives every cached grant

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

// ── Entitlement generation (INV-ENT-3 / INV-ENT-4) ───────────────────────────
//
// PROBLEM THIS SOLVES
//   Revocation previously invalidated only the TIER key plus whatever slugs the
//   caller happened to name. But userCanStreamProduct() reads the SLUG cache
//   FIRST and returns before ever consulting the tier — so a cancelled
//   subscriber kept full-quality access to every track they had already played
//   for up to SLUG_REDIS_TTL_S. Enumerating a user's cached slugs to delete them
//   would require maintaining an unbounded per-user index.
//
// DESIGN
//   Every user has a monotonic generation counter. Cached results record the
//   generation they were computed under. A revoke does a single INCR; every
//   previously cached grant is instantly stale without touching a single slug
//   key. Mass revocation is O(1).
//
//   Positive grants are validated against the live generation on every read.
//   Denials may be served from L1 without validation — a stale denial is
//   fail-closed and is cleared explicitly by the grant paths.
//
//   Redis unavailable → generation unknown → positive cache entries are treated
//   as MISS and recomputed from the DB. Never defaults to allow (INV-ENT-8).

// ── NO LOCAL GENERATION CACHE — deliberate (INV-ENT-11) ─────────────────────
//
// An earlier revision cached the generation in-process for 2 s to save a round
// trip. That reintroduced exactly the defect the generation exists to remove: an
// instance holding a 2-second-old generation would validate — and therefore
// serve — a grant that had already been revoked. A two-second privilege window is
// still a privilege window.
//
// The generation is now always read from the shared store. This is not an extra
// round trip on the hot path: the generation and the cached value are fetched in
// ONE atomic Lua call (see GEN_AND_VALUE_SCRIPT), so a lookup costs the same
// single RTT it cost before, with zero staleness.

/**
 * Atomically read the generation and one cached value together.
 *
 * Reading them separately would allow a revoke to land between the two GETs:
 * the caller could pair a pre-revoke value with a post-revoke generation (or the
 * reverse) and reach the wrong conclusion. A Lua script gives a consistent
 * snapshot of both.
 *
 * KEYS[1] ent:gen:{uid}   KEYS[2] the value key
 * Returns [generation, value] with '' meaning absent.
 */
const GEN_AND_VALUE_SCRIPT = `
local gen = redis.call('GET', KEYS[1])
local val = redis.call('GET', KEYS[2])
return { tostring(gen or '0'), tostring(val or '') }
`;

async function readGenerationAndValue(userId, valueKey) {
  const redis = getRedis();
  if (!redis) return { generation: null, value: null };
  try {
    const raw = await redis.eval(
      GEN_AND_VALUE_SCRIPT,
      [`ent:gen:${userId}`, valueKey],
      []
    );
    if (!Array.isArray(raw)) return { generation: null, value: null };
    const generation = Number(raw[0]);
    if (!Number.isFinite(generation)) return { generation: null, value: null };
    const value = raw[1] === "" || raw[1] === null || raw[1] === undefined ? null : String(raw[1]);
    return { generation, value };
  } catch {
    return { generation: null, value: null };
  }
}

/**
 * Current entitlement generation for a user.
 *
 * Always reads the shared store — never a local cache. Returns null when Redis
 * is unreachable; callers MUST treat that as "cannot validate" and fall through
 * to the database (INV-ENT-8).
 *
 * @param {string} userId
 * @returns {Promise<number|null>}
 */
export async function getEntitlementGeneration(userId) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`ent:gen:${userId}`);
    // Absent means "never revoked" → generation 0. Consistent after a Redis
    // flush, because cached grants live in the same store and vanish with it.
    return raw === null || raw === undefined ? 0 : Number(raw) || 0;
  } catch {
    return null;
  }
}

/**
 * Increment the generation, instantly invalidating every cached grant for this
 * user across all instances and all slugs.
 *
 * @param {string} userId
 * @returns {Promise<number|null>} the new generation, or null if Redis is down
 */
export async function bumpEntitlementGeneration(userId) {
  if (!userId) return null;
  // Local grants are dropped immediately; remote instances observe the counter
  // on their very next read, because no instance caches the generation.
  _tierL1.delete(userId);
  for (const key of _slugL1.keys()) {
    if (key.startsWith(`${userId}:`)) _slugL1.delete(key);
  }

  const redis = getRedis();
  if (!redis) return null;
  try {
    // INCR then EXPIRE in one atomic script: a crash between two separate
    // commands would leave the counter without a TTL, and a concurrent bump
    // could otherwise observe a partially-applied state.
    const next = await redis.eval(
      `local v = redis.call('INCR', KEYS[1])
       redis.call('EXPIRE', KEYS[1], ARGV[1])
       return tostring(v)`,
      [`ent:gen:${userId}`],
      [String(GEN_REDIS_TTL_S)]
    );
    const gen = Number(next);
    return Number.isFinite(gen) ? gen : null;
  } catch {
    return null;
  }
}

// ── L1 stores ────────────────────────────────────────────────────────────────


// ── Tier cache ────────────────────────────────────────────────────────────────

/**
 * @param {string} userId
 * @returns {Promise<{ canStreamAll: boolean, isAdmin?: boolean, isSubscriber?: boolean, isCollector?: boolean }|null>}
 */
export async function getCachedTier(userId) {
  // The tier cache only ever stores canStreamAll=true entries, so it is entirely
  // a positive grant and must be generation-validated (INV-ENT-4). Generation and
  // value are read in ONE atomic call so a concurrent revoke cannot be observed
  // half-applied.
  const { generation, value: tierRaw } = await readGenerationAndValue(
    userId,
    `ent:tier:${userId}`
  );
  if (generation === null) return null; // cannot validate → recompute from DB

  const l1 = _tierL1.get(userId);
  if (l1 && Date.now() - l1.ts < TIER_L1_TTL_MS && l1.generation === generation) {
    return l1.value;
  }

  try {
    const raw = tierRaw;
    if (raw !== null && raw !== undefined) {
      const stored = typeof raw === "string" ? JSON.parse(raw) : raw;
      // Legacy entries written before generation stamping have no _gen field.
      if (!stored || typeof stored !== "object" || stored._gen !== generation) return null;
      const { _gen, ...value } = stored;
      evictL1(_tierL1);
      _tierL1.set(userId, { value, generation, ts: Date.now() });
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
  const generation = (await getEntitlementGeneration(userId)) ?? 0;
  evictL1(_tierL1);
  _tierL1.set(userId, { value, generation, ts: Date.now() });
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.setex(
      `ent:tier:${userId}`,
      TIER_REDIS_TTL_S,
      JSON.stringify({ ...value, _gen: generation })
    );
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

  // A DENIAL may be served straight from L1. Serving a stale "no" is fail-closed,
  // and every grant path invalidates explicitly, so it cannot strand a buyer.
  const l1 = _slugL1.get(mapKey);
  const l1Fresh = l1 && Date.now() - l1.ts < SLUG_L1_TTL_MS;
  if (l1Fresh && l1.result === false) return false;

  // A GRANT must be validated against the live generation (INV-ENT-4), read in
  // the SAME atomic call as the value so a revoke cannot land between the two
  // and let a pre-revoke value be paired with a post-revoke generation.
  const { generation, value: raw } = await readGenerationAndValue(
    userId,
    `ent:slug:${userId}:${slug}`
  );
  if (generation === null) return null; // cannot validate → recompute from DB

  if (l1Fresh && l1.generation === generation) return l1.result;

  try {
    if (raw === null) return null;

    // Stored as "<generation>:<0|1>". Legacy bare "0"/"1" entries written before
    // this migration carry no generation and are treated as stale.
    const text = String(raw);
    const sep = text.indexOf(":");
    if (sep < 0) return null;

    const entryGen = Number(text.slice(0, sep));
    if (!Number.isFinite(entryGen) || entryGen !== generation) return null;

    const result = text.slice(sep + 1) === "1";
    evictL1(_slugL1);
    _slugL1.set(mapKey, { result, generation, ts: Date.now() });
    return result;
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
  // Stamp the generation the result was computed under so a later revoke
  // invalidates it implicitly (INV-ENT-4).
  const generation = (await getEntitlementGeneration(userId)) ?? 0;

  evictL1(_slugL1);
  _slugL1.set(mapKey, { result, generation, ts: Date.now() });

  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.setex(
      `ent:slug:${userId}:${slug}`,
      SLUG_REDIS_TTL_S,
      `${generation}:${result ? "1" : "0"}`
    );
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
  // INV-ENT-3: a tier change alters what the user may stream across the WHOLE
  // catalog, so it must invalidate every derived per-slug grant too — not just
  // the tier key. Bumping the generation does that in O(1).
  //
  // Deleting only ent:tier was the ENT-03 defect: userCanStreamProduct reads the
  // slug cache first and returns before the tier is ever consulted, so a
  // cancelled subscriber retained access to every already-played track.
  await bumpEntitlementGeneration(userId);
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
  // INV-ENT-3: bump first. This invalidates EVERY cached grant for the user
  // across all slugs and all instances, whether or not the caller knew to name
  // them. The explicit deletes below are then just eager cleanup.
  await bumpEntitlementGeneration(userId);

  for (const slug of slugs) _slugL1.delete(`${userId}:${slug}`);

  const redis = getRedis();
  if (!redis) return;
  try {
    const pipeline = redis.pipeline();
    pipeline.del(`ent:tier:${userId}`);
    for (const slug of slugs) pipeline.del(`ent:slug:${userId}:${slug}`);
    await pipeline.exec();
  } catch {}
}
