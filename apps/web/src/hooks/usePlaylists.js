"use client";

import { useDeletedReleaseSlugs } from "@/lib/releases/deletion-store";
import { excludeDeletedReleases } from "@/lib/releases/deletion-projection";
import { playlistTrackKey } from "@/lib/playlists/identity";
import { useCallback, useEffect, useState, useMemo } from "react";
import {
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  fetchAndSyncPlaylists,
  loadPlaylists,
  hasPendingWrites,
  migrateLocalToServer,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
  updatePlaylist,
} from "@/lib/playlists";

export function usePlaylists(userId) {
  const [playlists, setPlaylists] = useState(() => loadPlaylists(userId));
  const deletedSlugs = useDeletedReleaseSlugs();
  const [loading, setLoading] = useState(false);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!userId || userId === "guest") {
      setPlaylists(loadPlaylists(userId));
      return;
    }

    let cancelled = false;
    setLoading(true);

    migrateLocalToServer(userId)
      .then(() => fetchAndSyncPlaylists(userId))
      .then((result) => {
        if (!cancelled) {
          setPlaylists(result);
          setSynced(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlaylists(loadPlaylists(userId));
          setSynced(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [userId]);

  const reload = useCallback(() => {
    setPlaylists(loadPlaylists(userId));
  }, [userId]);

  useEffect(() => {
    window.addEventListener('2mrrw:playlists', reload);
    return () => window.removeEventListener('2mrrw:playlists', reload);
  }, [reload]);
  const reloadSaved = useCallback(async () => {
    if (hasPendingWrites(userId)) return;
    setPlaylists(await fetchAndSyncPlaylists(userId, {discardUnsaved:true}));
  }, [userId]);

  const create = useCallback(
    (payload) => {
      const created = createPlaylist(userId, payload);
      setPlaylists(loadPlaylists(userId));
      return created;
    },
    [userId]
  );

  const update = useCallback(
    (playlistId, patch) => {
      const next = updatePlaylist(userId, playlistId, patch);
      setPlaylists(loadPlaylists(userId));
      return next;
    },
    [userId]
  );

  const remove = useCallback(
    (playlistId) => {
      const next = deletePlaylist(userId, playlistId);
      setPlaylists(next);
      return next;
    },
    [userId]
  );

  const addTrack = useCallback(
    (playlistId, trackRef) => {
      const next = addTrackToPlaylist(userId, playlistId, trackRef);
      setPlaylists(loadPlaylists(userId));
      return next;
    },
    [userId]
  );

  const removeTrack = useCallback(
    (playlistId, trackKey) => {
      const next = removeTrackFromPlaylist(userId, playlistId, trackKey);
      setPlaylists(loadPlaylists(userId));
      return next;
    },
    [userId]
  );

  const reorder = useCallback(
    (playlistId, trackIds) => {
      const next = reorderPlaylistTracks(userId, playlistId, trackIds);
      setPlaylists(loadPlaylists(userId));
      return next;
    },
    [userId]
  );

  const availablePlaylists = useMemo(() => playlists.map((playlist) => {
    if (!deletedSlugs.length) return playlist;
    const tracks = excludeDeletedReleases(playlist.tracks || [], deletedSlugs);
    const keys = new Set(tracks.map(playlistTrackKey));
    const trackIds = (playlist.trackIds || []).filter((key) => {
      if (playlist.tracks?.length) return keys.has(key);
      try { const [album, track] = JSON.parse(key); return !deletedSlugs.includes(album || track); }
      catch { return !deletedSlugs.includes(key); }
    });
    return { ...playlist, tracks, trackIds };
  }), [playlists, deletedSlugs]);

  return {
    playlists: availablePlaylists,
    reloadSaved,
    pending: hasPendingWrites(userId),
    loading,
    synced,
    reload,
    create,
    update,
    remove,
    addTrack,
    removeTrack,
    reorder,
  };
}
