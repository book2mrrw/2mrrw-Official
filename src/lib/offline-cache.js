const OFFLINE_PREFIX = "2mrrw_offline";
const QUEUED_PREFIX = "2mrrw_offline_queued";

function offlineKey(userId, slug) {
  return `${OFFLINE_PREFIX}:${userId || "guest"}:${slug}`;
}

function queuedKey(userId) {
  return `${QUEUED_PREFIX}:${userId || "guest"}`;
}

function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function getOfflineQueuedSlugs(userId) {
  if (typeof window === "undefined") return [];
  const list = safeParse(window.localStorage.getItem(queuedKey(userId)), []);
  return Array.isArray(list) ? list : [];
}

export function isOfflineQueued(userId, slug) {
  return getOfflineQueuedSlugs(userId).includes(slug);
}

export function isOfflineCached(userId, slug) {
  if (typeof window === "undefined") return false;
  return Boolean(window.localStorage.getItem(offlineKey(userId, slug)));
}

export function getOfflineCacheMeta(userId, slug) {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(offlineKey(userId, slug));
  if (!raw) return null;
  const meta = safeParse(raw, null);
  return meta && typeof meta === "object" ? meta : null;
}

/**
 * MVP: mark slug as offline-queued; optionally store blob URL when fetch succeeds.
 */
export async function queueOfflineDownload(userId, track, { streamUrl } = {}) {
  if (typeof window === "undefined" || !track?.slug) {
    return { status: "unavailable", slug: track?.slug };
  }

  const queued = getOfflineQueuedSlugs(userId);
  if (!queued.includes(track.slug)) {
    queued.push(track.slug);
    window.localStorage.setItem(queuedKey(userId), JSON.stringify(queued));
  }

  let blobUrl = null;
  const url = streamUrl || track.full || track.audio || track.src || track.preview;
  if (url) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) {
        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
      }
    } catch {
      /* queued without blob — in-app playback uses stream URL */
    }
  }

  const meta = {
    slug: track.slug,
    title: track.title,
    cover: track.cover || track.coverArt,
    blobUrl,
    streamUrl: url || null,
    queuedAt: new Date().toISOString(),
    status: blobUrl ? "cached" : "queued",
  };
  window.localStorage.setItem(offlineKey(userId, track.slug), JSON.stringify(meta));
  return meta;
}

export function removeOfflineCache(userId, slug) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(offlineKey(userId, slug));
  const queued = getOfflineQueuedSlugs(userId).filter((s) => s !== slug);
  window.localStorage.setItem(queuedKey(userId), JSON.stringify(queued));
}

/** Prefer blob URL for in-app offline playback when cached. */
export function getOfflinePlaybackUrl(userId, slug) {
  const meta = getOfflineCacheMeta(userId, slug);
  if (!meta) return null;
  return meta.blobUrl || meta.streamUrl || null;
}

/** Revoke retained object URLs while tab hidden to reduce iOS memory pressure. */
export function releaseRetainedOfflineBlobUrls() {
  if (typeof window === "undefined") return;
  const prefix = `${OFFLINE_PREFIX}:`;
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const sep = rest.indexOf(":");
    if (sep < 0) continue;
    const userId = rest.slice(0, sep);
    const slug = rest.slice(sep + 1);
    const meta = getOfflineCacheMeta(userId, slug);
    if (!meta?.blobUrl) continue;
    try {
      URL.revokeObjectURL(meta.blobUrl);
    } catch {
      /* non-fatal */
    }
    const next = {
      ...meta,
      blobUrl: null,
      status: meta.streamUrl ? "queued" : "queued",
    };
    window.localStorage.setItem(key, JSON.stringify(next));
  }
}
