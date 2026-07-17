/**
 * Playback session memory — persists queue, queue index, shuffle, and repeat mode
 * across page reloads. Key: `2mrrw_sess_{userId}`. TTL: 7 days.
 * Tracks are stripped to minimal fields (CDN preview src only — signed URLs expire).
 */

const SESSION_VERSION = 1;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_QUEUE_STORE = 50;

const sessionKey = (userId) => `2mrrw_sess_${userId}`;

function stripTrackForStorage(t) {
  if (!t) return null;
  return {
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
