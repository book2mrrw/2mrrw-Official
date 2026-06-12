const STORAGE_PREFIX = "2mrrw_playlists";

function storageKey(userId) {
  return `${STORAGE_PREFIX}:${userId || "guest"}`;
}

function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

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

export function createPlaylist(userId, { title, artwork = null, trackIds = [] } = {}) {
  const playlists = loadPlaylists(userId);
  const id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const next = {
    id,
    title: title?.trim() || "New Playlist",
    artwork,
    trackIds: Array.isArray(trackIds) ? trackIds : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  playlists.unshift(next);
  savePlaylists(userId, playlists);
  return next;
}

export function updatePlaylist(userId, playlistId, patch = {}) {
  const playlists = loadPlaylists(userId);
  const index = playlists.findIndex((p) => p.id === playlistId);
  if (index < 0) return null;
  playlists[index] = {
    ...playlists[index],
    ...patch,
    title: patch.title !== undefined ? String(patch.title).trim() || playlists[index].title : playlists[index].title,
    updatedAt: new Date().toISOString(),
  };
  savePlaylists(userId, playlists);
  return playlists[index];
}

export function deletePlaylist(userId, playlistId) {
  const playlists = loadPlaylists(userId).filter((p) => p.id !== playlistId);
  savePlaylists(userId, playlists);
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
  return playlist;
}

export function reorderPlaylistTracks(userId, playlistId, trackIds) {
  return updatePlaylist(userId, playlistId, { trackIds });
}

export function resolvePlaylistTracks(playlist, catalogBySlug = new Map()) {
  const refs = playlist?.tracks?.length
    ? playlist.tracks
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
