import { normalizePlaylistTrack, orderedPlaylistTracks, playlistIdentity, playlistTrackKey } from "./playlists/identity.js";
const cacheVersions = new Map();
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
  return Array.isArray(list) ? list.map(p => {
    if (p.id === '__library__') return p; // Personal library keeps its existing bookmark contract.
    const tracks = orderedPlaylistTracks(p);
    const interrupted = p.syncPending && !writeQueues.has(`${userId}:${p.id}`);
    return {...p, tracks, trackIds: tracks.length ? tracks.map(playlistTrackKey) : p.trackIds || [],
      ...(interrupted && !p.syncError ? {syncError:'Playlist save was interrupted. Reload saved playlist before editing.'} : {})};
  }) : [];
}

export function savePlaylists(userId, playlists) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(userId), JSON.stringify(playlists));
  cacheVersions.set(userId, (cacheVersions.get(userId) || 0) + 1);
}

// ─── Server API client ────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) { const error = new Error(`${options.method || "GET"} ${path} → ${res.status}`); error.status = res.status; throw error; }
  return res.json();
}

export async function fetchAndSyncPlaylists(userId, {discardUnsaved = false} = {}) {
  if (hasPendingWrites(userId)) return loadPlaylists(userId);
  if (!discardUnsaved && loadPlaylists(userId).some(p => p.syncError)) return loadPlaylists(userId);
  if (!userId || typeof window === "undefined") return loadPlaylists(userId);
  const version = cacheVersions.get(userId) || 0;
  try {
    const { playlists } = await apiFetch("/api/playlists");
    if (hasPendingWrites(userId) || version !== (cacheVersions.get(userId) || 0)) return loadPlaylists(userId);
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
  if (local.some(p => p.syncError)) return;
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
      let revision = 0;
      for (const trackRef of pl.tracks || []) {
        const slug = trackRef.slug || trackRef.id;
        if (!slug) continue;
        const added = await apiFetch(`/api/playlists/${newId}/tracks`, {
          method: "POST",
          body: JSON.stringify({ ...playlistIdentity(trackRef), trackData: trackRef, revision }),
        });
        revision = added.revision;
      }
    } catch {
      const retained = loadPlaylists(userId);
      const index = retained.findIndex(p => p.id === pl.id);
      if (index >= 0) {
        retained[index] = {...retained[index],syncError:'Playlist import was not completed. Your local tracks have been kept.'};
        savePlaylists(userId, retained);
        notifyPlaylists();
      }
      return;
    }
  }

  window.localStorage.setItem(flag, "1");
  await fetchAndSyncPlaylists(userId);
}

// Per-user, per-playlist ordering. Failed edits stay visibly unsaved until reload.
const writeQueues = new Map();
const queueRevisions = new Map();
export function hasPendingWrites(userId) {
  return [...writeQueues.keys()].some(key => key.startsWith(`${userId}:`));
}
/** Await the submitted batch before a UI reports it saved. */
export async function awaitPlaylistSave(userId, playlistId) {
  const pending = writeQueues.get(`${userId}:${playlistId}`);
  if (pending) await pending;
  const playlist = loadPlaylists(userId).find(p => p.id === playlistId);
  if (!playlist || playlist.syncError) throw new Error(playlist?.syncError || 'Playlist was not saved');
  return playlist;
}
function notifyPlaylists() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('2mrrw:playlists'));
}
function syncWrite(userId, playlistId, path, method, body, needsRevision = false, deletedSnapshot = null) {
  const key = `${userId}:${playlistId}`;
  const previous = writeQueues.get(key) || Promise.resolve();
  if (!queueRevisions.has(key)) queueRevisions.set(key, {revision:loadPlaylists(userId).find(p => p.id === playlistId)?.revision});
  const queueState = queueRevisions.get(key);
  const task = previous.then(async () => {
    const playlist = loadPlaylists(userId).find(p => p.id === playlistId);
    if (playlist?.syncError) throw new Error('Reload saved playlist before retrying');
    const payload = {...body};
    if (needsRevision) {
      if (!Number.isSafeInteger(queueState.revision)) throw new Error('Reload saved playlist before editing');
      payload.revision = queueState.revision;
    }
    const result = await apiFetch(path, {method,body:JSON.stringify(payload)});
    const acknowledged = result.revision ?? result.playlist?.revision;
    if (Number.isSafeInteger(acknowledged)) queueState.revision = acknowledged;
    const list = loadPlaylists(userId);
    const index = list.findIndex(p => p.id === playlistId);
    if (index >= 0 && Number.isSafeInteger(acknowledged)) {
      list[index] = {...list[index],revision:result.revision ?? result.playlist.revision};
      savePlaylists(userId,list);
    }
    notifyPlaylists();
    return result;
  }).catch(error => {
    const list = loadPlaylists(userId);
    const index = list.findIndex(p => p.id === playlistId);
    if (index < 0 && deletedSnapshot) list.push(deletedSnapshot);
    const failedIndex = list.findIndex(p => p.id === playlistId);
    if (failedIndex >= 0) {
      list[failedIndex] = {...list[failedIndex],syncError:error.status === 409 ? 'Playlist changed on another device. Reload saved playlist.' : 'Playlist changes were not saved. Reload saved playlist before retrying.'};
      savePlaylists(userId,list);
    }
    notifyPlaylists();
    throw error;
  });
  writeQueues.set(key,task);
  const pendingList = loadPlaylists(userId);
  const pendingIndex = pendingList.findIndex(p => p.id === playlistId);
  if (pendingIndex >= 0) {pendingList[pendingIndex] = {...pendingList[pendingIndex],syncPending:true};savePlaylists(userId,pendingList);}
  // The caller is optimistic; the error is persisted and rendered, not discarded.
  task.catch(() => {}).finally(() => {
    if (writeQueues.get(key) !== task) return;
    const list = loadPlaylists(userId);
    const index = list.findIndex(p => p.id === playlistId);
    if (index >= 0) {list[index] = {...list[index],syncPending:false};savePlaylists(userId,list);}
    writeQueues.delete(key);queueRevisions.delete(key);notifyPlaylists();
  });
}
function syncCreate(userId, pl) {
  syncWrite(userId, pl.id, '/api/playlists', 'POST', {id:pl.id,title:pl.title,artwork:pl.artwork,isSystem:pl.isSystem});
}
function syncUpdate(userId, id, patch) {syncWrite(userId,id,`/api/playlists/${id}`,'PATCH',patch);}
function syncDelete(userId, id, snapshot) {syncWrite(userId,id,`/api/playlists/${id}`,'DELETE',{},false,snapshot);}
function syncAddTrack(userId, id, track) {
  syncWrite(userId,id,`/api/playlists/${id}/tracks`,'POST',{...playlistIdentity(track),trackData:track},true);
}
function syncRemoveTrack(userId,id,key) {syncWrite(userId,id,`/api/playlists/${id}/tracks`,'DELETE',{trackKey:key},true);}
function syncReorder(userId,id,keys) {syncWrite(userId,id,`/api/playlists/${id}/tracks`,'PUT',{trackKeys:keys},true);}

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
    revision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  playlists.unshift(next);
  savePlaylists(userId, playlists);
  if (isServerUser(userId)) syncCreate(userId, next);
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
    if (Object.keys(serverPatch).length) syncUpdate(userId, playlistId, serverPatch);
  }
  return playlists[index];
}

export function deletePlaylist(userId, playlistId) {
  const existing = loadPlaylists(userId);
  const snapshot = existing.find(p => p.id === playlistId);
  const playlists = existing.filter((p) => p.id !== playlistId);
  savePlaylists(userId, playlists);
  if (isServerUser(userId)) syncDelete(userId, playlistId, snapshot);
  return playlists;
}

export function addTrackToPlaylist(userId, playlistId, trackRef) {
  const playlists = loadPlaylists(userId);
  const playlist = playlists.find((p) => p.id === playlistId);
  if (!playlist || !trackRef?.slug) return null;
  trackRef = normalizePlaylistTrack(trackRef);
  const key = playlistTrackKey(trackRef);
  if (!playlist.trackIds.includes(key)) {
    playlist.trackIds.push(key);
    playlist.tracks = [...(playlist.tracks || []), trackRef];
    playlist.updatedAt = new Date().toISOString();
    savePlaylists(userId, playlists);
    if (isServerUser(userId)) syncAddTrack(userId, playlistId, trackRef);
  }
  return playlist;
}

export function removeTrackFromPlaylist(userId, playlistId, trackKey) {
  const playlists = loadPlaylists(userId);
  const playlist = playlists.find((p) => p.id === playlistId);
  if (!playlist) return null;
  playlist.trackIds = (playlist.trackIds || []).filter((id) => id !== trackKey);
  playlist.tracks = (playlist.tracks || []).filter((t) => playlistTrackKey(t) !== trackKey);
  playlist.updatedAt = new Date().toISOString();
  savePlaylists(userId, playlists);
  if (isServerUser(userId)) syncRemoveTrack(userId, playlistId, trackKey);
  return playlist;
}

export function reorderPlaylistTracks(userId, playlistId, trackIds) {
  const playlists = loadPlaylists(userId);
  const index = playlists.findIndex((p) => p.id === playlistId);
  if (index < 0) return null;
  const tracks = orderedPlaylistTracks({...playlists[index],trackIds});
  const keys = tracks.map(playlistTrackKey);
  if (keys.length !== trackIds.length || new Set(trackIds).size !== trackIds.length || keys.some((key,i) => key !== trackIds[i])) throw new Error("Reorder must contain every playlist key exactly once");
  playlists[index] = { ...playlists[index], tracks, trackIds: keys, updatedAt: new Date().toISOString() };
  savePlaylists(userId, playlists);
  if (isServerUser(userId)) syncReorder(userId, playlistId, trackIds);
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
  return orderedPlaylistTracks(playlist, catalogBySlug).map(t => ({...t,
    title:t.title,artist:t.artist || "2MRRW",cover:t.cover || t.coverArt,
    src:t.full || t.audio || t.src || t.preview,source:"playlist"}));
}
