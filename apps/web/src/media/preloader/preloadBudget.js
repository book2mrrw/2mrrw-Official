const LIMITS = {
  audio: 3,
  artwork: 6,
  totalBytes: 50 * 1024 * 1024,
};

function networkAudioFactor() {
  if (typeof navigator === "undefined") return 1;
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return 1;
  if (conn.saveData) return 0;
  switch (conn.effectiveType) {
    case "slow-2g":
    case "2g":
      return 0;
    case "3g":
      return 0.4;
    default:
      return 1;
  }
}

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
  if (type === "audio") {
    const factor = networkAudioFactor();
    if (factor <= 0) return false;
    const audioLimit = Math.max(1, Math.floor(LIMITS.audio * factor));
    const count = [...active.values()].filter((e) => e.type === "audio").length;
    if (count >= audioLimit) return false;
  } else {
    const count = [...active.values()].filter((e) => e.type === type).length;
    if (type === "artwork" && count >= LIMITS.artwork) return false;
  }
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
