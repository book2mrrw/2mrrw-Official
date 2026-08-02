const STORAGE_PREFIX = "2mrrw_playlists";
const MIGRATED_KEY = "2mrrw_playlists_migrated";

function storageKey(userId) {
  return `${STORAGE_PREFIX}:${userId || "guest"}`;
}

function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function genId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── localStorage cache layer ─────────────────────────────────────────────────

export function loadPlaylists(userId) {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(storageKey(userId));
  const list = safeParse(raw, []);
  return Array.isArray(list) ? list : [];
}

export function savePlaylists(userId, playlists) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(userId), JSON.stringify(playlists));
}

// ─── Server API client ────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`${options.method || "GET"} ${path} → ${res.status}`);
  return res.json();
}

export async function fetchAndSyncPlaylists(userId) {
  if (!userId || typeof window === "undefined") return loadPlaylists(userId);
  try {
    const { playlists } = await apiFetch("/api/playlists");
    savePlaylists(userId, playlists);
    return playlists;
  } catch {
    return loadPlaylists(userId);
  }
}

// Runs once per device: migrates legacy pl_xxx IDs to the server.
export async function migrateLocalToServer(userId) {
  if (!userId || typeof window === "undefined") return;
  const flag = `${MIGRATED_KEY}:${userId}`;
  if (window.localStorage.getItem(flag)) return;

  const local = loadPlaylists(userId);
  const legacy = local.filter((p) => p.id && p.id.startsWith("pl_") && !p.isSystem);
  if (!legacy.length) {
    window.localStorage.setItem(flag, "1");
    return;
  }

  let serverTitles = new Set();
  try {
    const { playlists: serverPls } = await apiFetch("/api/playlists");
    serverTitles = new Set(serverPls.map((p) => p.title.toLowerCase()));
  } catch {
    return; // offline — skip migration, try next session
  }

  for (const pl of legacy) {
    if (serverTitles.has(pl.title.toLowerCase())) continue;
    const newId = genId();
    try {
      await apiFetch("/api/playlists", {
        method: "POST",
        body: JSON.stringify({ id: newId, title: pl.title, artwork: pl.artwork || null }),
      });
      for (const trackRef of pl.tracks || []) {
        const slug = trackRef.slug || trackRef.id;
        if (!slug) continue;
        await apiFetch(`/api/playlists/${newId}/tracks`, {
          method: "POST",
          body: JSON.stringify({ trackSlug: slug, albumSlug: trackRef.albumSlug, trackData: trackRef }),
        });
      }
    } catch { /* best effort — partial migration is acceptable */ }
  }

  window.localStorage.setItem(flag, "1");
  await fetchAndSyncPlaylists(userId);
}

// ─── Fire-and-forget server sync ──────────────────────────────────────────────

function syncCreate(pl) {
  apiFetch("/api/playlists", {
    method: "POST",
    body: JSON.stringify({ id: pl.id, title: pl.title, artwork: pl.artwork, isSystem: pl.isSystem }),
  }).catch(() => {});
}

function syncUpdate(playlistId, serverPatch) {
  apiFetch(`/api/playlists/${playlistId}`, {
    method: "PATCH",
    body: JSON.stringify(serverPatch),
  }).catch(() => {});
}

function syncDelete(playlistId) {
  apiFetch(`/api/playlists/${playlistId}`, { method: "DELETE" }).catch(() => {});
}

function syncAddTrack(playlistId, trackRef) {
  const slug = trackRef.slug || trackRef.id;
  if (!slug) return;
  apiFetch(`/api/playlists/${playlistId}/tracks`, {
    method: "POST",
    body: JSON.stringify({ trackSlug: slug, albumSlug: trackRef.albumSlug, trackData: trackRef }),
  }).catch(() => {});
}

function syncRemoveTrack(playlistId, trackKey) {
  apiFetch(`/api/playlists/${playlistId}/tracks`, {
    method: "DELETE",
    body: JSON.stringify({ trackKey }),
  }).catch(() => {});
}

function syncReorder(playlistId, trackIds) {
  apiFetch(`/api/playlists/${playlistId}/tracks`, {
    method: "PUT",
    body: JSON.stringify({ trackIds }),
  }).catch(() => {});
}

function isServerUser(userId) {
  return Boolean(userId) && userId !== "guest";
}

// ─── Public mutation API ──────────────────────────────────────────────────────

export function createPlaylist(userId, { title, artwork = null, trackIds = [] } = {}) {
  const playlists = loadPlaylists(userId);
  const id = genId();
  const next = {
    id,
    title: title?.trim() || "New Playlist",
    artwork,
    trackIds: Array.isArray(trackIds) ? trackIds : [],
    tracks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  playlists.unshift(next);
  savePlaylists(userId, playlists);
  if (isServerUser(userId)) syncCreate(next);
  return next;
}

export function updatePlaylist(userId, playlistId, patch = {}) {
  const playlists = loadPlaylists(userId);
  const index = playlists.findIndex((p) => p.id === playlistId);
  if (index < 0) return null;
  playlists[index] = {
    ...playlists[index],
    ...patch,
    title: patch.title !== undefined
      ? String(patch.title).trim() || playlists[index].title
      : playlists[index].title,
    updatedAt: new Date().toISOString(),
  };
  savePlaylists(userId, playlists);
  // Only sync fields the PATCH endpoint handles — trackIds go through PUT /tracks
  if (isServerUser(userId)) {
    const serverPatch = {};
    if (patch.title !== undefined) serverPatch.title = playlists[index].title;
    if (patch.artwork !== undefined) serverPatch.artwork = patch.artwork;
    if (patch.sortOrder !== undefined) serverPatch.sortOrder = patch.sortOrder;
    if (Object.keys(serverPatch).length) syncUpdate(playlistId, serverPatch);
  }
  return playlists[index];
}

export function deletePlaylist(userId, playlistId) {
  const playlists = loadPlaylists(userId).filter((p) => p.id !== playlistId);
  savePlaylists(userId, playlists);
  if (isServerUser(userId)) syncDelete(playlistId);
  return playlists;
}

export function addTrackToPlaylist(userId, playlistId, trackRef) {
  const playlists = loadPlaylists(userId);
  const playlist = playlists.find((p) => p.id === playlistId);
  if (!playlist || !trackRef?.slug) return null;
  const key = trackRef.id || trackRef.slug;
  if (!playlist.trackIds.includes(key)) {
    playlist.trackIds.push(key);
    playlist.tracks = [...(playlist.tracks || []), trackRef];
    playlist.updatedAt = new Date().toISOString();
    savePlaylists(userId, playlists);
    if (isServerUser(userId)) syncAddTrack(playlistId, trackRef);
  }
  return playlist;
}

export function removeTrackFromPlaylist(userId, playlistId, trackKey) {
  const playlists = loadPlaylists(userId);
  const playlist = playlists.find((p) => p.id === playlistId);
  if (!playlist) return null;
  playlist.trackIds = (playlist.trackIds || []).filter((id) => id !== trackKey);
  playlist.tracks = (playlist.tracks || []).filter((t) => (t.id || t.slug) !== trackKey);
  playlist.updatedAt = new Date().toISOString();
  savePlaylists(userId, playlists);
  if (isServerUser(userId)) syncRemoveTrack(playlistId, trackKey);
  return playlist;
}

export function reorderPlaylistTracks(userId, playlistId, trackIds) {
  const playlists = loadPlaylists(userId);
  const index = playlists.findIndex((p) => p.id === playlistId);
  if (index < 0) return null;
  playlists[index] = { ...playlists[index], trackIds, updatedAt: new Date().toISOString() };
  savePlaylists(userId, playlists);
  if (isServerUser(userId)) syncReorder(playlistId, trackIds);
  return playlists[index];
}

export function addToLibrary(userId, trackRef) {
  const playlists = loadPlaylists(userId);
  let lib = playlists.find((p) => p.id === "__library__");
  if (!lib) {
    lib = {
      id: "__library__",
      title: "Library",
      trackIds: [],
      tracks: [],
      isSystem: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    playlists.unshift(lib);
  }
  const key = trackRef.id || trackRef.slug;
  if (!key || lib.trackIds.includes(key)) return lib;
  lib.trackIds.push(key);
  lib.tracks = [...(lib.tracks || []), trackRef];
  lib.updatedAt = new Date().toISOString();
  savePlaylists(userId, playlists);
  return lib;
}

export function isInLibrary(userId, slug) {
  const lib = loadPlaylists(userId).find((p) => p.id === "__library__");
  if (!lib) return false;
  return (lib.trackIds || []).includes(slug) || (lib.tracks || []).some((t) => t.slug === slug);
}

export function resolvePlaylistTracks(playlist, catalogBySlug = new Map()) {
  const refs = playlist?.tracks?.length
    ? playlist.tracks.filter(Boolean)
    : (playlist?.trackIds || []).map((id) => catalogBySlug.get(id)).filter(Boolean);
  return refs.map((t) => ({
    id: t.id || t.slug,
    slug: t.slug,
    title: t.title,
    artist: t.artist || "2MRRW",
    cover: t.cover || t.coverArt,
    src: t.full || t.audio || t.src || t.preview,
    source: "playlist",
  }));
}
