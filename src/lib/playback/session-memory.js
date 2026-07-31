/**
 * Playback session memory — persists queue, queue index, shuffle, and repeat mode
 * across page reloads. Key: `2mrrw_sess_{userId}`. TTL: 7 days.
 * Tracks are stripped to minimal fields (CDN preview src only — signed URLs expire).
 *
 * Cross-device sync: server sync via /api/queue (throttled fire-and-forget).
 * On mount, AudioContext loads local session first; falls back to server if absent.
 */

const SESSION_VERSION = 1;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_QUEUE_STORE = 50;
// Minimum time between server syncs — debounced anyway from AudioContext, this is a floor.
const SERVER_SYNC_THROTTLE_MS = 10_000;

const sessionKey = (userId) => `2mrrw_sess_${userId}`;

function stripTrackForStorage(t) {
  if (!t) return null;
  return {
    id: t.id ?? null,
    slug: t.slug,
    src: t.src,
    title: t.title,
    artist: t.artist,
    album: t.album,
    cover: t.cover || t.coverArt || t.baseCover || null,
    csCover: t.csCover || null,
    gainDb: t.gainDb ?? null,
    duration: typeof t.duration === "number" ? t.duration : null,
    source: t.source ?? null,
    metadata: t.metadata
      ? {
          trackSlug: t.metadata.trackSlug ?? null,
          albumSlug: t.metadata.albumSlug ?? null,
          trackIndex: t.metadata.trackIndex ?? null,
          access: t.metadata.access
            ? {
                canStream: Boolean(t.metadata.access.canStream),
                previewOnly: Boolean(t.metadata.access.previewOnly),
              }
            : null,
        }
      : null,
  };
}

export function savePlaybackSession(userId, { queue, queueIndex, shuffle, repeatMode }) {
  if (!userId || typeof window === "undefined") return;
  try {
    const stripped = (queue || [])
      .slice(0, MAX_QUEUE_STORE)
      .map(stripTrackForStorage)
      .filter(Boolean);
    if (!stripped.length) return;
    localStorage.setItem(
      sessionKey(userId),
      JSON.stringify({
        v: SESSION_VERSION,
        queue: stripped,
        queueIndex: queueIndex ?? 0,
        shuffle: Boolean(shuffle),
        repeatMode: repeatMode || "off",
        savedAt: Date.now(),
      })
    );
    syncQueueToServer(userId, { queue: stripped, queueIndex, shuffle, repeatMode });
  } catch {
    /* localStorage quota — non-fatal */
  }
}

export function loadPlaybackSession(userId) {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(sessionKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== SESSION_VERSION) return null;
    if (Date.now() - (parsed.savedAt || 0) > SESSION_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPlaybackSession(userId) {
  if (!userId || typeof window === "undefined") return;
  try {
    localStorage.removeItem(sessionKey(userId));
  } catch {}
}

// ─── Server sync ──────────────────────────────────────────────────────────────

let _lastServerSyncAt = 0;
let _pendingSyncTimer = null;

function syncQueueToServer(userId, { queue, queueIndex, shuffle, repeatMode }) {
  if (!userId || typeof fetch === "undefined") return;
  // Already debounced by AudioContext (400ms); add a floor to prevent rapid-fire on shuffle.
  if (_pendingSyncTimer) clearTimeout(_pendingSyncTimer);
  _pendingSyncTimer = setTimeout(() => {
    _pendingSyncTimer = null;
    const now = Date.now();
    if (now - _lastServerSyncAt < SERVER_SYNC_THROTTLE_MS) return;
    _lastServerSyncAt = now;
    fetch("/api/queue", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queue, queueIndex, shuffle, repeatMode }),
    }).catch(() => {});
  }, 2000);
}

/**
 * Load the playback session, preferring the freshest source.
 * Checks localStorage first; if absent or older than the server record, fetches
 * from the server and writes it back to localStorage for instant future access.
 *
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function loadPlaybackSessionServerFirst(userId) {
  const local = loadPlaybackSession(userId);
  const localSavedAt = local?.savedAt ?? 0;
  try {
    const server = await fetchQueueFromServer();
    const serverSavedAt = server?.savedAt ?? 0;
    if (server && serverSavedAt > localSavedAt) {
      // Server has a fresher session — persist it locally so next load is instant.
      try {
        localStorage.setItem(
          sessionKey(userId),
          JSON.stringify({ ...server, savedAt: serverSavedAt })
        );
      } catch { /* quota — non-fatal */ }
      return server;
    }
  } catch { /* server unavailable — local is fine */ }
  return local;
}

/** Load queue from server. Returns null if unavailable or user is not authenticated. */
export async function fetchQueueFromServer() {
  if (typeof fetch === "undefined") return null;
  try {
    const res = await fetch("/api/queue");
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.queue?.length) return null;
    return {
      v: SESSION_VERSION,
      queue: data.queue,
      queueIndex: data.queueIndex ?? 0,
      shuffle: Boolean(data.shuffle),
      repeatMode: data.repeatMode || "off",
      savedAt: data.savedAt ? new Date(data.savedAt).getTime() : Date.now(),
    };
  } catch {
    return null;
  }
}
