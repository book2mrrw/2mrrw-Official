/**
 * Two-level HLS manifest metadata cache: L1 in-process Map → L2 Upstash Redis → Supabase.
 *
 * HLS manifests are written once at transcode time and never mutate during normal
 * catalog operation. The appropriate cache model is therefore:
 *
 *   L1  in-process Map  — 5 min TTL, 500 entries per instance, zero network cost
 *   L2  Upstash Redis   — 24 h TTL, cross-instance shared, survives Vercel cold starts
 *   Invalidation        — explicit on re-transcode; TTL is last-resort safety net only
 *
 * At 10 M users across hundreds of Vercel instances, per-instance-only caching causes
 * a constant DB waterfall from cold-start misses. 24 h Redis TTL means a manifest
 * row is read from Supabase at most once per day per slug — after that every instance,
 * cold or warm, fetches from Redis (< 5 ms) rather than Supabase (20–100 ms).
 *
 * The factory function SELECTs the superset of fields needed by both the master
 * playlist route and the variant playlist route in a single query. This eliminates
 * the 4-per-session-start DB amplification (1 master + 3 variant reads) down to at
 * most 1 DB read per slug per 24 hours across the entire fleet.
 *
 * Inflight coalescing prevents a cold-start thundering herd from issuing multiple
 * simultaneous DB reads for the same (slug, trackSlug) pair.
 *
 * Redis unavailability: silently falls back to L1, then factory. Zero error propagation.
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

const L1_TTL_MS  = 5 * 60 * 1_000; // 5 min — in-process, hot path
const L2_TTL_S   = 86_400;          // 24 h  — cross-instance, manifests are immutable
const L1_MAX     = 500;

// Sentinel stored in Redis for "confirmed not found" — prevents repeated DB hits
// for tracks without HLS manifests while keeping the TTL short (5 min) so newly
// transcoded tracks appear quickly.
const NOT_FOUND_SENTINEL = "__not_found__";
const L2_NOT_FOUND_TTL_S = 300; // 5 min — re-check DB after transcoding window

// ── L1 store ─────────────────────────────────────────────────────────────────

/** @type {Map<string, { value: object|null, ts: number }>} */
const _l1 = new Map();
/** @type {Map<string, Promise<object|null>>} */
const _inflight = new Map();

function cacheKey(slug, trackSlug) {
  // Normalize null/undefined trackSlug to a stable sentinel for the key.
  return `hls:manifest:v1:${slug}:${trackSlug ?? "__null__"}`;
}

function evict() {
  if (_l1.size <= L1_MAX) return;
  const overage = _l1.size - Math.floor(L1_MAX * 0.8);
  let i = 0;
  for (const key of _l1.keys()) {
    if (i++ >= overage) break;
    _l1.delete(key);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retrieve a manifest from L1 → L2. Returns null on cache miss.
 * Callers should use getOrFetchManifest() which combines lookup + factory.
 *
 * @param {string} slug
 * @param {string|null} trackSlug
 * @returns {Promise<object|null>}  null = cache miss (not the same as "not found")
 */
export async function getCachedManifest(slug, trackSlug) {
  const k = cacheKey(slug, trackSlug);

  // L1
  const l1 = _l1.get(k);
  if (l1 && Date.now() - l1.ts < L1_TTL_MS) return l1.value; // may be null (not-found)

  // L2
  const redis = getRedis();
  if (!redis) return undefined; // undefined = L2 unavailable, distinct from null = not-found
  try {
    const raw = await redis.get(k);
    if (raw !== null && raw !== undefined) {
      const value = raw === NOT_FOUND_SENTINEL ? null
        : typeof raw === "string" ? JSON.parse(raw) : raw;
      evict();
      _l1.set(k, { value, ts: Date.now() });
      return value; // null = not-found sentinel
    }
  } catch {}
  return undefined; // L2 miss
}

/**
 * Write a manifest (or null for "not found") to L1 + L2.
 *
 * @param {string} slug
 * @param {string|null} trackSlug
 * @param {object|null} value  null stores the not-found sentinel in Redis
 */
export async function setCachedManifest(slug, trackSlug, value) {
  const k = cacheKey(slug, trackSlug);
  evict();
  _l1.set(k, { value, ts: Date.now() });
  const redis = getRedis();
  if (!redis) return;
  try {
    if (value === null) {
      await redis.setex(k, L2_NOT_FOUND_TTL_S, NOT_FOUND_SENTINEL);
    } else {
      await redis.setex(k, L2_TTL_S, JSON.stringify(value));
    }
  } catch {}
}

/**
 * Explicit cache invalidation. Call after re-transcoding a track.
 *
 * @param {string} slug
 * @param {string|null} trackSlug
 */
export async function invalidateManifestCache(slug, trackSlug) {
  const k = cacheKey(slug, trackSlug);
  _l1.delete(k);
  const redis = getRedis();
  if (!redis) return;
  try { await redis.del(k); } catch {}
}

/**
 * Cache-aware manifest fetch with inflight coalescing.
 *
 * Checks L1 → L2 → factory. All concurrent callers for the same (slug, trackSlug)
 * share a single factory invocation during a cache miss, collapsing a cold-start
 * thundering herd into exactly one DB round-trip.
 *
 * The factory must return the complete manifest row (all fields: bitrates,
 * segment_duration_secs, duration_seconds, hls_prefix, segment_counts), or null
 * if no manifest exists for this track. Both routes extract only the fields they need.
 *
 * @param {string} slug
 * @param {string|null} trackSlug
 * @param {() => Promise<object|null>} factory  runs the Supabase query on cache miss
 * @returns {Promise<object|null>}  null = no HLS manifest for this track
 */
export async function getOrFetchManifest(slug, trackSlug, factory) {
  // ── L1/L2 read ───────────────────────────────────────────────────────────
  const cached = await getCachedManifest(slug, trackSlug);
  // null = confirmed not-found (sentinel); undefined = miss (no L2 hit)
  if (cached !== undefined) return cached;

  // ── Inflight coalescing ───────────────────────────────────────────────────
  const k = cacheKey(slug, trackSlug);
  if (_inflight.has(k)) return _inflight.get(k);

  const promise = factory()
    .then(async (value) => {
      // Cache both found and not-found outcomes
      await setCachedManifest(slug, trackSlug, value ?? null);
      return value ?? null;
    })
    .finally(() => _inflight.delete(k));

  _inflight.set(k, promise);
  return promise;
}
