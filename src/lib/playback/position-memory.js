function positionKey(userId, slug) {
  return `2mrrw_pos_${userId}_${slug}`;
}

/** Save in-progress playback position for a slug (used every ~15s during play). */
export function savePlaybackPosition(userId, slug, positionSeconds, durationSeconds = 0) {
  if (!userId || !slug || typeof window === "undefined") return;
  try {
    localStorage.setItem(
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
}

/** Read saved position for resume on stream start. */
export function getSavedPlaybackPosition(userId, slug) {
  if (!userId || !slug || typeof window === "undefined") return null;
  try {
    const entry = JSON.parse(localStorage.getItem(positionKey(userId, slug)));
    if (!entry || entry.positionSeconds <= 0) return null;
    return entry;
  } catch {
    return null;
  }
}

export function clearPlaybackPosition(userId, slug) {
  if (!userId || !slug) return;
  try {
    localStorage.removeItem(positionKey(userId, slug));
  } catch {}
}
