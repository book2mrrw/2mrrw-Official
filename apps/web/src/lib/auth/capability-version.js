/**
 * capability-version — atomic fingerprint→version state machine.
 *
 * INV-ENT-7   capabilityVersion changes when — and only when — effective
 *             authorization changes.
 * INV-ENT-12  The fingerprint comparison and the version advancement are a
 *             SINGLE INDIVISIBLE OPERATION. N concurrent resolvers observing the
 *             same rights transition produce exactly ONE version transition.
 *
 * ── The race this replaces (E0-B defect) ────────────────────────────────────
 *
 *   The first implementation did read-then-write across two round trips:
 *
 *       const [storedFp, storedVer] = await Promise.all([GET fp, GET ver]);
 *       if (storedFp === fingerprint) return storedVer;   // unchanged
 *       const next = await INCR ver;                      // ← every caller
 *       await SET fp, fingerprint;
 *
 *   With 100 concurrent resolvers all computing F2 while the store holds F1,
 *   all 100 read F1, all 100 fail the equality test, and all 100 INCR:
 *
 *       41 → 141          instead of      41 → 42
 *
 *   There was a second defect in the same window: INCR landed before SET, so
 *   between them the store advertised the OLD fingerprint with the NEW version.
 *   Any instance reading in that gap saw an inconsistent pair.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 *
 *   Compare and advance inside one Lua script. Redis executes scripts
 *   atomically — no other command interleaves — so exactly one caller observes
 *   the F1→F2 edge. The remaining callers observe F2 === F2 and return the same
 *   version. The fingerprint and version are also written together, so no reader
 *   can ever observe a mismatched pair.
 *
 *       CURRENT  fp=F1 ver=41
 *       100 concurrent resolvers compute F2
 *                    ↓  one atomic transition
 *       fp=F2 ver=42          ← every caller returns 42
 *
 * ── Failure semantics ───────────────────────────────────────────────────────
 *
 *   Redis unavailable → version null, changed false. Callers MUST treat a null
 *   version as UNKNOWN, never as "unchanged, safe to skip re-authorization".
 *   The fingerprint is always returned and is fully usable for equality
 *   comparison with no storage at all.
 */

import { Redis } from "@upstash/redis";
import { capabilityFingerprint } from "@/lib/auth/capability-document";

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

/** Test seam — inject a Redis-compatible client (see the torture suite). */
export function __setRedisClientForTests(client) {
  _redis = client;
}

const CAP_TTL_S = 60 * 60 * 24 * 90; // 90 days — outlives any realistic session

export const CapabilityTransition = Object.freeze({
  UNCHANGED:   0,  // stored fingerprint already equals the computed one
  ADVANCED:    1,  // rights genuinely changed — exactly one caller sees this
  INITIALISED: 2,  // first observation for this principal; not a transition
});

/**
 * Atomic compare-and-advance.
 *
 * KEYS[1] cap:fp:{userId}   KEYS[2] cap:ver:{userId}
 * ARGV[1] fingerprint       ARGV[2] ttl seconds
 *
 * Returns { code, version } where code is a CapabilityTransition.
 *
 * Every path refreshes both TTLs so an active principal never expires mid-life
 * and silently re-initialises (which would look like a spurious version reset).
 */
const CAS_SCRIPT = `
local stored = redis.call('GET', KEYS[1])

if stored == ARGV[1] then
  local v = redis.call('GET', KEYS[2])
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  redis.call('EXPIRE', KEYS[2], ARGV[2])
  return { 0, tostring(v or '0') }
end

local ver
local code
if stored == false then
  local existing = redis.call('GET', KEYS[2])
  if existing == false then
    ver = redis.call('INCR', KEYS[2])
  else
    ver = tonumber(existing)
  end
  code = 2
else
  ver = redis.call('INCR', KEYS[2])
  code = 1
end

redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('EXPIRE', KEYS[2], ARGV[2])
return { code, tostring(ver) }
`;

/**
 * Resolve the capability version for a principal's current document.
 *
 * @param {string} userId
 * @param {object} doc CapabilityDocument
 * @returns {Promise<{ fingerprint: string, version: number|null,
 *                     changed: boolean, transition: number|null }>}
 */
export async function resolveCapabilityVersion(userId, doc) {
  const fingerprint = capabilityFingerprint(doc);
  if (!userId) {
    return { fingerprint, version: null, changed: false, transition: null };
  }

  const redis = getRedis();
  if (!redis) {
    return { fingerprint, version: null, changed: false, transition: null };
  }

  try {
    const raw = await redis.eval(
      CAS_SCRIPT,
      [`cap:fp:${userId}`, `cap:ver:${userId}`],
      [fingerprint, String(CAP_TTL_S)]
    );

    const code = Number(Array.isArray(raw) ? raw[0] : NaN);
    const version = Number(Array.isArray(raw) ? raw[1] : NaN);
    if (!Number.isFinite(code) || !Number.isFinite(version)) {
      return { fingerprint, version: null, changed: false, transition: null };
    }

    return {
      fingerprint,
      version,
      // Initialisation records a baseline; it is not a rights TRANSITION.
      changed: code === CapabilityTransition.ADVANCED,
      transition: code,
    };
  } catch (err) {
    console.error("[capability-version] atomic resolve failed", err?.message);
    return { fingerprint, version: null, changed: false, transition: null };
  }
}

/**
 * Read the stored capability state without computing or advancing anything.
 * @param {string} userId
 * @returns {Promise<{ fingerprint: string|null, version: number|null }>}
 */
export async function peekCapabilityVersion(userId) {
  const redis = getRedis();
  if (!redis || !userId) return { fingerprint: null, version: null };
  try {
    const [fp, ver] = await Promise.all([
      redis.get(`cap:fp:${userId}`),
      redis.get(`cap:ver:${userId}`),
    ]);
    return {
      fingerprint: fp ?? null,
      version: ver === null || ver === undefined ? null : Number(ver) || 0,
    };
  } catch {
    return { fingerprint: null, version: null };
  }
}
