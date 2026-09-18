/**
 * In-memory cache for pre-fetched HLS segment bytes.
 *
 * Stores raw encrypted .ts bytes fetched from the public CDN during
 * next-track preload. The hls-prefetch-loader serves from here so hls.js
 * gets zero-latency segment delivery instead of a CDN round-trip.
 *
 * Size cap: 15 MB (≈ 2–3 tracks of 3-segment preload at 320k).
 * Eviction: LRU — least-recently-used entry is dropped when the cap is reached.
 */

const MAX_BYTES = 15 * 1024 * 1024;

/** @type {Map<string, { buf: ArrayBuffer, size: number, lastUsed: number }>} */
const _cache = new Map();
let _totalBytes = 0;

/**
 * Returns a consumer-owned copy for this segment URL, or null on miss.
 * HLS may transfer this buffer to its decoding worker, detaching it. Never
 * expose the cache's retained bytes to a consumer's mutation or transfer.
 * Updates the lastUsed timestamp on every hit (LRU accounting).
 * @param {string} url
 * @returns {ArrayBuffer|null}
 */
export function getSegment(url) {
  const entry = _cache.get(url);
  if (!entry) return null;
  if (entry.buf.byteLength === 0) {
    _cache.delete(url);
    _totalBytes -= entry.size;
    return null;
  }
  entry.lastUsed = Date.now();
  return entry.buf.slice(0);
}

/**
 * Stores an owned snapshot of segment bytes. No-ops if already cached.
 * Evicts LRU entries to stay within MAX_BYTES.
 * @param {string} url
 * @param {ArrayBuffer} buf
 */
export function setSegment(url, buf) {
  if (_cache.has(url)) return;
  const size = buf.byteLength;
  // Invalid data must fall through to the normal network loader. Reject an
  // oversized entry before eviction so it cannot empty or exceed the cache.
  if (size === 0 || size > MAX_BYTES) return;
  const owned = buf.slice(0);

  // Evict least-recently-used entries until there is room.
  while (_totalBytes + size > MAX_BYTES && _cache.size > 0) {
    let lruKey = null;
    let lruTime = Infinity;
    for (const [k, v] of _cache) {
      if (v.lastUsed < lruTime) {
        lruTime = v.lastUsed;
        lruKey = k;
      }
    }
    if (!lruKey) break;
    _totalBytes -= _cache.get(lruKey).size;
    _cache.delete(lruKey);
  }

  _cache.set(url, { buf: owned, size, lastUsed: Date.now() });
  _totalBytes += size;
}

/**
 * Removes all cached segments. Called before starting a new prefetch so
 * stale bytes from the previous preloaded track don't linger in memory.
 */
export function clearSegmentCache() {
  _cache.clear();
  _totalBytes = 0;
}
