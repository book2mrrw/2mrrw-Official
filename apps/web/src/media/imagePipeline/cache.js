const MAX_ENTRIES = 50;

/** @type {Map<string, { value: unknown, bytes: number, lastAccess: number }>} */
const lru = new Map();

function estimateBytes(value) {
  if (value && typeof value === "object" && "naturalWidth" in value) {
    const img = value;
    return (img.naturalWidth || 256) * (img.naturalHeight || 256) * 4;
  }
  return 256 * 256 * 4;
}

function touch(key, entry) {
  lru.delete(key);
  entry.lastAccess = Date.now();
  lru.set(key, entry);
}

export function get(url) {
  const entry = lru.get(url);
  if (!entry) return undefined;
  touch(url, entry);
  return entry.value;
}

export function set(url, value) {
  if (lru.has(url)) lru.delete(url);
  if (lru.size >= MAX_ENTRIES) {
    const oldest = lru.keys().next().value;
    if (oldest) lru.delete(oldest);
  }
  lru.set(url, { value, bytes: estimateBytes(value), lastAccess: Date.now() });
}

export function has(url) {
  return lru.has(url);
}

export function evict(url) {
  lru.delete(url);
}

export function clear() {
  lru.clear();
}
