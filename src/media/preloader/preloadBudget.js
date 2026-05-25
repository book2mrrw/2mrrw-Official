const LIMITS = {
  audio: 3,
  artwork: 6,
  totalBytes: 50 * 1024 * 1024,
};

/** @type {Map<string, { type: string, bytes: number, ts: number }>} */
const active = new Map();
let totalBytes = 0;

function evictOldest() {
  let oldestKey = null;
  let oldestTs = Infinity;
  for (const [key, entry] of active) {
    if (entry.ts < oldestTs) {
      oldestTs = entry.ts;
      oldestKey = key;
    }
  }
  if (oldestKey) releasePreload(oldestKey.split(":")[0], oldestKey.split(":").slice(1).join(":"));
}

export function canPreload(type) {
  const count = [...active.values()].filter((e) => e.type === type).length;
  if (type === "audio" && count >= LIMITS.audio) return false;
  if (type === "artwork" && count >= LIMITS.artwork) return false;
  if (totalBytes >= LIMITS.totalBytes) return false;
  return true;
}

export function trackPreload(type, id, estimatedSize = 512 * 1024) {
  const key = `${type}:${id}`;
  if (!canPreload(type)) {
    evictOldest();
    if (!canPreload(type)) {
      import("@/system/telemetry")
        .then(({ telemetry }) => {
          telemetry.log({ type: "preload.budget.exceeded", preloadType: type, id });
        })
        .catch(() => {});
      return false;
    }
  }
  active.set(key, { type, bytes: estimatedSize, ts: Date.now() });
  totalBytes += estimatedSize;
  return true;
}

export function releasePreload(type, id) {
  const key = `${type}:${id}`;
  const entry = active.get(key);
  if (entry) {
    totalBytes = Math.max(0, totalBytes - entry.bytes);
    active.delete(key);
  }
}
