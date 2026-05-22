"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  loadPlaylists,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
  updatePlaylist,
} from "@/lib/playlists";

export function usePlaylists(userId) {
  const [playlists, setPlaylists] = useState([]);

  const reload = useCallback(() => {
    setPlaylists(loadPlaylists(userId));
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    (payload) => {
      const created = createPlaylist(userId, payload);
      reload();
      return created;
    },
    [userId, reload]
  );

  const update = useCallback(
    (playlistId, patch) => {
      const next = updatePlaylist(userId, playlistId, patch);
      reload();
      return next;
    },
    [userId, reload]
  );

  const remove = useCallback(
    (playlistId) => {
      const next = deletePlaylist(userId, playlistId);
      reload();
      return next;
    },
    [userId, reload]
  );

  const addTrack = useCallback(
    (playlistId, trackRef) => {
      const next = addTrackToPlaylist(userId, playlistId, trackRef);
      reload();
      return next;
    },
    [userId, reload]
  );

  const removeTrack = useCallback(
    (playlistId, trackKey) => {
      const next = removeTrackFromPlaylist(userId, playlistId, trackKey);
      reload();
      return next;
    },
    [userId, reload]
  );

  const reorder = useCallback(
    (playlistId, trackIds) => {
      const next = reorderPlaylistTracks(userId, playlistId, trackIds);
      reload();
      return next;
    },
    [userId, reload]
  );

  return {
    playlists,
    reload,
    create,
    update,
    remove,
    addTrack,
    removeTrack,
    reorder,
  };
}
