import { Redis } from "@upstash/redis";

const STATE_CACHE_TTL_SECONDS = 30;
const STATE_CACHE_TTL_MS = STATE_CACHE_TTL_SECONDS * 1000;
const CACHE_MAX_ENTRIES = 500;

const _stateCache = new Map();

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

export async function getCachedState(userId) {
  const redis = getRedis();
  if (redis) {
    try {
      const data = await redis.get(`account:state:${userId}`);
      return data || null;
    } catch {
      // Redis unavailable — fall through to in-process cache.
    }
  }
  const entry = _stateCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _stateCache.delete(userId); return null; }
  return entry.body;
}

export async function setCachedState(userId, body) {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.setex(`account:state:${userId}`, STATE_CACHE_TTL_SECONDS, body);
      return;
    } catch {
      // Redis unavailable — fall through to in-process cache.
    }
  }
  _stateCache.set(userId, { body, expiresAt: Date.now() + STATE_CACHE_TTL_MS });
  if (_stateCache.size > CACHE_MAX_ENTRIES) {
    const oldest = _stateCache.keys().next().value;
    if (oldest !== undefined) _stateCache.delete(oldest);
  }
}

export async function invalidateAccountStateCache(userId) {
  if (!userId) return;
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(`account:state:${userId}`);
    } catch {}
  }
  _stateCache.delete(userId);
}
