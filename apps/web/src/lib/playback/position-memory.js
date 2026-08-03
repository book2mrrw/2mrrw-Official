/**
 * Playback position memory — slug-scoped localStorage keys (`2mrrw_pos_{userId}_{slug}`).
 * Stores seconds only (no R2 paths). Stale paths in catalog do not corrupt these entries.
 * Use clearPlaybackPosition(userId, slug) per track; no bulk clear helper (avoid accidental data loss).
 *
 * Cross-device sync: server sync throttled to once per 30s per slug via /api/media/playback.
 * AudioContext resume path already reads from mediaProgress (account state) as cross-device fallback.
 */

function positionKey(userId, slug) {
  return `2mrrw_pos_${userId}_${slug}`;
}

// Throttle server sync to 30s per slug to avoid overloading /api/media/playback
const SERVER_SYNC_INTERVAL_MS = 30_000;
const _lastServerSync = new Map(); // `${userId}:${slug}` → timestamp

function syncPositionToServer(userId, slug, positionSeconds, durationSeconds) {
  if (!userId || !slug || typeof fetch === "undefined") return;
  const key = `${userId}:${slug}`;
  const now = Date.now();
  const last = _lastServerSync.get(key) || 0;
  if (now - last < SERVER_SYNC_INTERVAL_MS) return;
  _lastServerSync.set(key, now);

  fetch("/api/media/playback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug,
      eventType: "progress",
      positionSeconds,
      durationSeconds,
      mediaType: "audio",
    }),
  }).catch(() => {});
}

/** Save in-progress playback position for a slug (used every ~15s during play). */
export function savePlaybackPosition(userId, slug, positionSeconds, durationSeconds = 0) {
  if (!userId || !slug || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      positionKey(userId, slug),
      JSON.stringify({
        positionSeconds: Math.max(0, Number(positionSeconds) || 0),
        durationSeconds: Math.max(0, Number(durationSeconds) || 0),
        updatedAt: new Date().toISOString(),
      })
    );
  } catch {
    /* quota */
  }
  syncPositionToServer(userId, slug, positionSeconds, durationSeconds);
}

/** Read saved position for resume on stream start. */
export function getSavedPlaybackPosition(userId, slug) {
  if (!userId || !slug || typeof window === "undefined") return null;
  try {
    const entry = JSON.parse(window.localStorage.getItem(positionKey(userId, slug)));
    if (!entry || entry.positionSeconds <= 0) return null;
    return entry;
  } catch {
    return null;
  }
}

export function clearPlaybackPosition(userId, slug) {
  if (!userId || !slug) return;
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(positionKey(userId, slug));
    _lastServerSync.delete(`${userId}:${slug}`);
  } catch {}
}

/**
 * Fetch position from the server — server is authoritative for cross-device resume.
 * Returns null on error or when the server has no record.
 *
 * @param {string} userId
 * @param {string} slug
 * @returns {Promise<{positionSeconds: number, durationSeconds: number, updatedAt: string}|null>}
 */
export async function fetchPositionFromServer(userId, slug) {
  if (!userId || !slug || typeof fetch === "undefined") return null;
  try {
    const res = await fetch(
      `/api/media/playback?slug=${encodeURIComponent(slug)}&userId=${encodeURIComponent(userId)}`,
      { credentials: "include" }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const pos = data?.positionSeconds ?? data?.position_seconds;
    if (!pos || pos <= 0) return null;
    return {
      positionSeconds: Number(pos),
      durationSeconds: Number(data?.durationSeconds ?? data?.duration_seconds ?? 0),
      updatedAt: data?.lastPlayedAt ?? data?.last_played_at ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
