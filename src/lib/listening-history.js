/** Local storage keys for listening rails — complements account-state mediaProgress. */
export const LISTENING_KEYS = {
  continue: "2mrrw_continue_listening",
  recentlyPlayed: "2mrrw_recently_played",
  recentlyAdded: "2mrrw_recently_added",
};

const MAX_RAIL_ITEMS = 20;

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Read a listening rail from localStorage. */
export function readListeningRail(key) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = safeParse(localStorage.getItem(key));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist a listening rail (capped). */
export function writeListeningRail(key, items) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify((items || []).slice(0, MAX_RAIL_ITEMS)));
  } catch {
    /* ignore quota */
  }
}

/** Record a play/resume event for offline or pre-sync rails. */
export function recordListeningEvent(slug, meta = {}) {
  if (!slug || typeof window === "undefined") return;
  const entry = {
    slug,
    title: meta.title || slug,
    cover: meta.cover || null,
    positionSeconds: Number(meta.positionSeconds || 0),
    durationSeconds: Number(meta.durationSeconds || 0),
    completed: Boolean(meta.completed),
    lastPlayedAt: meta.lastPlayedAt || new Date().toISOString(),
  };

  const recent = readListeningRail(LISTENING_KEYS.recentlyPlayed).filter((r) => r.slug !== slug);
  writeListeningRail(LISTENING_KEYS.recentlyPlayed, [entry, ...recent]);

  if (!entry.completed && entry.positionSeconds > 0) {
    writeListeningRail(LISTENING_KEYS.continue, [entry]);
  } else if (entry.completed) {
    writeListeningRail(LISTENING_KEYS.continue, []);
  }
}

/** Record a newly acquired item for the Recently Added rail. */
export function recordRecentlyAdded(slug, meta = {}) {
  if (!slug || typeof window === "undefined") return;
  const entry = {
    slug,
    title: meta.title || slug,
    cover: meta.cover || null,
    addedAt: meta.addedAt || new Date().toISOString(),
  };
  const list = readListeningRail(LISTENING_KEYS.recentlyAdded).filter((r) => r.slug !== slug);
  writeListeningRail(LISTENING_KEYS.recentlyAdded, [entry, ...list]);
}
