import { getSegment, hasSegment, setSegment } from './hls-segment-cache';

const CACHE_NAME = '2mrrw-encrypted-audio-v1';
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 1024;

function storageRead(run, fallback) {
  return new Promise(resolve => {
    const finish = value => { clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => resolve(fallback), 200);
    Promise.resolve().then(run).then(finish, () => finish(fallback));
  });
}

// A fresh authorized master supplies this identity on every play. Never retain
// bearer tokens, playlists containing key URLs, or decryption keys.
export function renditionCacheKey(url) {
  try {
    const u = new URL(url);
    if (!u.searchParams.get('v') || !['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    for (const key of [...u.searchParams.keys()]) {
      if (!['slug', 'trackSlug', 'bitrate', 'v'].includes(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    return u.href;
  } catch { return null; }
}

export class EncryptedSegmentStore {
  constructor({ storage = globalThis.caches, maxBytes = MAX_BYTES, maxEntries = MAX_ENTRIES } = {}) {
    this.storage = storage;
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.entries = null;
    this.protectedUrls = new Set();
    this.writes = Promise.resolve();
    this.catalog = new Map();
  }

  protect(urls = []) { this.protectedUrls = new Set(urls); }

  async cache() {
    try { return await this.storage?.open(CACHE_NAME); } catch { return null; }
  }

  async has(url) {
    if (hasSegment(url)) return true;
    return storageRead(async () => {
      const response = await (await this.cache())?.match(url);
      return Number(response?.headers.get('x-2mrrw-bytes')) > 0;
    }, false);
  }

  async get(url) {
    const memory = getSegment(url);
    if (memory) return memory;
    return storageRead(async () => {
      const response = await (await this.cache())?.match(url);
      if (!response) return null;
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength) return null;
      setSegment(url, bytes);
      if (this.entries?.has(url)) this.entries.get(url).at = Date.now();
      return bytes;
    }, null);
  }

  async put(url, bytes, { descriptor = false } = {}) {
    if (!bytes?.byteLength || bytes.byteLength > this.maxBytes) return false;
    if (!descriptor) setSegment(url, bytes);
    // Legacy URLs have no replacement identity and must not survive a reload.
    if (!renditionCacheKey(url)) return false;
    if (!descriptor && [...new URL(url).searchParams.keys()].some(key => key !== 'v')) return false;
    const owned = bytes.slice(0);
    const write = async () => {
      const cache = await this.cache();
      if (!cache) return false;
      try {
        this.entries ??= new Map();
        const requests = await cache.keys();
        const present = new Set(requests.map(request => request.url));
        for (const key of this.entries.keys()) if (!present.has(key)) this.entries.delete(key);
        for (const request of requests) {
          if (!this.entries.has(request.url)) {
            const response = await cache.match(request);
            this.entries.set(request.url, { size: Number(response?.headers.get('x-2mrrw-bytes')) || 0,
              at: Number(response?.headers.get('x-2mrrw-at')) || 0 });
          }
        }
        let total = [...this.entries.values()].reduce((n, e) => n + e.size, 0);
        total -= this.entries.get(url)?.size || 0;
        const victims = [...this.entries].filter(([key]) => key !== url && !this.protectedUrls.has(key))
          .sort((a, b) => a[1].at - b[1].at);
        while (total + owned.byteLength > this.maxBytes || this.entries.size + (this.entries.has(url) ? 0 : 1) > this.maxEntries) {
          const victim = victims.shift();
          if (!victim) return false;
          await cache.delete(victim[0]);
          this.entries.delete(victim[0]);
          total -= victim[1].size;
        }
        const at = Date.now();
        await cache.put(url, new Response(owned, { headers: {
          'Content-Type': descriptor ? 'application/json' : 'application/octet-stream',
          'x-2mrrw-bytes': String(owned.byteLength), 'x-2mrrw-at': String(at),
        } }));
        this.entries.set(url, { size: owned.byteLength, at });
        return true;
      } catch { this.entries = null; return false; }
    };
    // Coordinate the shared browser cache across tabs where Web Locks exists.
    // Refresh its key inventory inside the lock; versioned bytes are immutable.
    const lockedWrite = () => globalThis.navigator?.locks?.request
      ? globalThis.navigator.locks.request(CACHE_NAME, write) : write();
    const result = this.writes.then(lockedWrite, lockedWrite);
    this.writes = result.catch(() => false);
    return result;
  }

  async remember(variantUrl, urls) {
    const key = renditionCacheKey(variantUrl);
    if (!key || !urls.length || urls.length > this.maxEntries - 1 || urls.some(url => {
      try { return !renditionCacheKey(url) || [...new URL(url).searchParams.keys()].some(name => name !== 'v'); }
      catch { return true; }
    })) return;
    // Only encrypted segment addresses are recorded, not EXT-X-KEY material.
    this.catalog.set(key, [...urls]);
    if (this.catalog.size > 32) this.catalog.delete(this.catalog.keys().next().value);
    await this.put(key, new TextEncoder().encode(JSON.stringify(urls)).buffer, { descriptor: true });
  }

  async complete(variantUrl) {
    const started = Date.now();
    const key = renditionCacheKey(variantUrl);
    if (!key) return false;
    let urls = this.catalog.get(key);
    if (!urls) {
      try {
        urls = await storageRead(async () => {
          const response = await (await this.cache())?.match(key);
          return response ? response.json() : null;
        }, null);
      } catch { return false; }
    }
    if (!Array.isArray(urls) || !urls.length || urls.length >= this.maxEntries ||
        urls.some(url => typeof url !== 'string' || !renditionCacheKey(url))) return false;
    for (const url of urls) {
      if (Date.now() - started > 400 || !await this.has(url)) return false;
    }
    return true;
  }
}

export const encryptedSegmentStore = new EncryptedSegmentStore();
