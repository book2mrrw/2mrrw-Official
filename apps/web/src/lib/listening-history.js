/** Local storage keys for listening rails — complements account-state mediaProgress. */
export const LISTENING_KEY_BASES = {
  continue: "2mrrw_continue_listening",
  recentlyPlayed: "2mrrw_recently_played",
  recentlyAdded: "2mrrw_recently_added",
};

export const LISTENING_HISTORY_EVENT = "2mrrw:listening-history-updated";

const MAX_RAIL_ITEMS = 20;

/** Per-user playback position map for resume (slug → { positionSeconds, durationSeconds, updatedAt }). */
export function getPlaybackPositionKey(userId) {
  if (!userId) return null;
  return `listening_history_${userId}`;
}

function readPlaybackPositionStore(userId) {
  const key = getPlaybackPositionKey(userId);
  if (!key || typeof window === "undefined") return {};
  const parsed = safeParse(localStorage.getItem(key));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function writePlaybackPositionStore(userId, store) {
  const key = getPlaybackPositionKey(userId);
  if (!key || typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(store));
  } catch {
    /* quota */
  }
}

/** Save in-progress playback position for a slug (used every ~15s during play). */
export function savePlaybackPosition(userId, slug, positionSeconds, durationSeconds = 0) {
  if (!userId || !slug || typeof window === "undefined") return;
  const store = readPlaybackPositionStore(userId);
  store[slug] = {
    positionSeconds: Math.max(0, Number(positionSeconds) || 0),
    durationSeconds: Math.max(0, Number(durationSeconds) || 0),
    updatedAt: new Date().toISOString(),
  };
  writePlaybackPositionStore(userId, store);
}

/** Read saved position for resume on stream start. */
export function getSavedPlaybackPosition(userId, slug) {
  if (!userId || !slug) return null;
  const entry = readPlaybackPositionStore(userId)[slug];
  if (!entry || entry.positionSeconds <= 0) return null;
  return entry;
}

/** Clear saved position after track completion or explicit stop. */
export function clearPlaybackPosition(userId, slug) {
  if (!userId || !slug || typeof window === "undefined") return;
  const store = readPlaybackPositionStore(userId);
  if (!store[slug]) return;
  delete store[slug];
  writePlaybackPositionStore(userId, store);
}

/** Per-user scoped localStorage keys. */
export function getListeningKeys(userId) {
  if (!userId) return null;
  return {
    continue: `${LISTENING_KEY_BASES.continue}:${userId}`,
    recentlyPlayed: `${LISTENING_KEY_BASES.recentlyPlayed}:${userId}`,
    recentlyAdded: `${LISTENING_KEY_BASES.recentlyAdded}:${userId}`,
  };
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function notifyListeningHistoryChange(userId) {
  if (typeof window === "undefined" || !userId) return;
  window.dispatchEvent(new CustomEvent(LISTENING_HISTORY_EVENT, { detail: { userId } }));
}

/** Read a listening rail from localStorage. */
export function readListeningRail(key) {
  if (typeof window === "undefined" || !key) return [];
  try {
    const parsed = safeParse(localStorage.getItem(key));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist a listening rail (capped). */
export function writeListeningRail(key, items, userId) {
  if (typeof window === "undefined" || !key) return;
  try {
    localStorage.setItem(key, JSON.stringify((items || []).slice(0, MAX_RAIL_ITEMS)));
    notifyListeningHistoryChange(userId);
  } catch {
    /* ignore quota */
  }
}

/** Record a play/resume event for offline or pre-sync rails. */
export function recordListeningEvent(slug, meta = {}, userId) {
  if (!slug || !userId || typeof window === "undefined") return;
  const keys = getListeningKeys(userId);
  if (!keys) return;

  const entry = {
    slug,
    title: meta.title || slug,
    cover: meta.cover || null,
    positionSeconds: Number(meta.positionSeconds || 0),
    durationSeconds: Number(meta.durationSeconds || 0),
    completed: Boolean(meta.completed),
    lastPlayedAt: meta.lastPlayedAt || new Date().toISOString(),
  };

  const recent = readListeningRail(keys.recentlyPlayed).filter((r) => r.slug !== slug);
  writeListeningRail(keys.recentlyPlayed, [entry, ...recent], userId);

  if (!entry.completed && entry.positionSeconds > 0) {
    writeListeningRail(keys.continue, [entry], userId);
  } else if (entry.completed) {
    writeListeningRail(keys.continue, [], userId);
  }
}

/** Record a newly acquired item for the Recently Added rail. */
export function recordRecentlyAdded(slug, meta = {}, userId) {
  if (!slug || !userId || typeof window === "undefined") return;
  const keys = getListeningKeys(userId);
  if (!keys) return;

  const entry = {
    slug,
    title: meta.title || slug,
    cover: meta.cover || null,
    addedAt: meta.addedAt || new Date().toISOString(),
  };
  const list = readListeningRail(keys.recentlyAdded).filter((r) => r.slug !== slug);
  writeListeningRail(keys.recentlyAdded, [entry, ...list], userId);
}
