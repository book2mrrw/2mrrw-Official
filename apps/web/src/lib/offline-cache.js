import { storeAudioBlob, getAudioBlob, removeAudioBlob, getAllAudioKeys } from "@/lib/idb-audio-cache";

const OFFLINE_PREFIX = "2mrrw_offline";
const QUEUED_PREFIX = "2mrrw_offline_queued";

// Unique to this page session — used to validate same-session blob URLs
// created before IDB hydration completes.
const SESSION_ID = typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

// Module-level memory map of idbKey ("userId:slug") → active blob URL.
// Populated by queueOfflineDownload (same session) and initOfflineAudioCache (cross-session).
const blobUrlMap = new Map();

function offlineKey(userId, slug) {
  return `${OFFLINE_PREFIX}:${userId || "guest"}:${slug}`;
}

function queuedKey(userId) {
  return `${QUEUED_PREFIX}:${userId || "guest"}`;
}

function idbKey(userId, slug) {
  return `${userId || "guest"}:${slug}`;
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
  if (blobUrlMap.has(idbKey(userId, slug))) return true;
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
 * Resolve an audio blob from either a direct URL or the /api/library/stream
 * endpoint. The stream endpoint returns JSON { url, ... } pointing to a signed
 * R2 URL — we follow that indirection to get real audio bytes.
 */
async function fetchBlobWithProgress(url, credentials, onProgress) {
  const res = await fetch(url, { credentials });
  if (!res.ok) throw new Error(`fetch_${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!total || !onProgress || !res.body) return res.blob();
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(99, Math.round((received / total) * 100)));
  }
  onProgress(100);
  return new Blob(chunks);
}

async function fetchAudioBlob(apiOrDirectUrl, onProgress) {
  const isStreamApi = apiOrDirectUrl.includes("/api/library/stream");
  if (isStreamApi) {
    const apiRes = await fetch(apiOrDirectUrl, { credentials: "include" });
    if (!apiRes.ok) throw new Error(`stream_api_${apiRes.status}`);
    const json = await apiRes.json();
    if (!json?.url) throw new Error("stream_api_no_url");
    return fetchBlobWithProgress(json.url, "omit", onProgress);
  }
  return fetchBlobWithProgress(apiOrDirectUrl, "include", onProgress);
}

/** Minimum free storage bytes required before attempting an offline download (50 MB). */
const MIN_FREE_STORAGE_BYTES = 50 * 1024 * 1024;

/**
 * Queue a track for offline playback. Fetches the audio, stores the blob in
 * IndexedDB (persists across sessions) and puts the blob URL in blobUrlMap
 * for immediate same-session use.
 *
 * @param {string} userId
 * @param {object} track
 * @param {{ streamUrl?: string, onProgress?: function, playbackPolicy?: string }} [opts]
 */
export async function queueOfflineDownload(userId, track, { streamUrl, onProgress, playbackPolicy } = {}) {
  if (typeof window === "undefined" || !track?.slug) {
    return { status: "unavailable", slug: track?.slug };
  }

  // Playback policy gate — preview-only sessions cannot cache full streams.
  if (playbackPolicy === "PREVIEW_ONLY" || (!playbackPolicy && !streamUrl)) {
    return { status: "policy_denied", slug: track.slug };
  }

  // Storage quota gate — ensure at least 50 MB free before downloading.
  if (navigator.storage?.estimate) {
    try {
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      if (quota > 0 && (quota - usage) < MIN_FREE_STORAGE_BYTES) {
        return { status: "quota_exceeded", slug: track.slug };
      }
    } catch {
      /* non-fatal — proceed without quota check */
    }
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
      const blob = await fetchAudioBlob(url, onProgress);
      blobUrl = URL.createObjectURL(blob);
      const key = idbKey(userId, track.slug);
      blobUrlMap.set(key, blobUrl);
      // Persist to IDB — non-fatal if storage is unavailable.
      storeAudioBlob(key, blob).catch(() => {});
    } catch {
      /* queued without blob — in-app playback falls back to stream URL */
    }
  }

  const meta = {
    slug: track.slug,
    title: track.title,
    cover: track.cover || track.coverArt,
    blobUrl,
    blobSessionId: blobUrl ? SESSION_ID : null,
    streamUrl: url || null,
    queuedAt: new Date().toISOString(),
    status: blobUrl ? "cached" : "queued",
  };
  window.localStorage.setItem(offlineKey(userId, track.slug), JSON.stringify(meta));
  return meta;
}

/**
 * Hydrate blobUrlMap from IndexedDB on session start.
 * Call once when the authenticated userId is known (e.g. from PageAuthRefSync).
 * Blob URLs created here are valid for this session; IDB blobs persist indefinitely.
 */
export async function initOfflineAudioCache(userId) {
  if (typeof window === "undefined" || !userId) return;
  const prefix = `${userId}:`;
  try {
    const keys = await getAllAudioKeys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith(prefix) && !blobUrlMap.has(k))
        .map(async (key) => {
          const blob = await getAudioBlob(key);
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          blobUrlMap.set(key, url);
        })
    );
  } catch {
    /* non-fatal — falls back to stream URL */
  }
}

export function removeOfflineCache(userId, slug) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(offlineKey(userId, slug));
  const queued = getOfflineQueuedSlugs(userId).filter((s) => s !== slug);
  window.localStorage.setItem(queuedKey(userId), JSON.stringify(queued));
  const key = idbKey(userId, slug);
  const url = blobUrlMap.get(key);
  if (url) { try { URL.revokeObjectURL(url); } catch {} }
  blobUrlMap.delete(key);
  removeAudioBlob(key).catch(() => {});
}

/**
 * Prefer IDB-backed blob URL (persistent), then same-session blob URL from localStorage,
 * then stream URL (requires network).
 */
export function getOfflinePlaybackUrl(userId, slug) {
  const key = idbKey(userId, slug);
  if (blobUrlMap.has(key)) return blobUrlMap.get(key);
  const meta = getOfflineCacheMeta(userId, slug);
  if (!meta) return null;
  // Same-session blob URL created before IDB hydration completed.
  if (meta.blobUrl && meta.blobSessionId === SESSION_ID) return meta.blobUrl;
  return meta.streamUrl || null;
}

/**
 * Revoke in-memory blob URLs to release iOS memory pressure.
 * IDB blobs are unaffected — they will be re-hydrated on next initOfflineAudioCache call.
 */
export function releaseRetainedOfflineBlobUrls() {
  if (typeof window === "undefined") return;
  for (const [, url] of blobUrlMap) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  blobUrlMap.clear();

  // Clear blobUrl from localStorage metadata so stale URLs aren't re-used.
  const prefix = `${OFFLINE_PREFIX}:`;
  const keys = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(prefix)) keys.push(key);
  }
  for (const key of keys) {
    const meta = safeParse(window.localStorage.getItem(key), null);
    if (meta?.blobUrl) {
      window.localStorage.setItem(key, JSON.stringify({
        ...meta,
        blobUrl: null,
        blobSessionId: null,
        status: meta.streamUrl ? "cached" : "queued",
      }));
    }
  }
}
