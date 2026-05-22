"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addToLibrary,
  addTrackToPlaylist,
  createPlaylist,
  isInLibrary,
  loadPlaylists,
} from "@/lib/playlists";
import { queueOfflineDownload, isOfflineQueued } from "@/lib/offline-cache";
import { buildShareUrl } from "@/lib/deep-links";
import { resolvePlaybackSrc } from "@/lib/music-access";
import { postLibraryAdd } from "@/lib/library-client";
import PlusActionSheet from "@/components/music/PlusActionSheet";

export default function MusicPlusButton({
  track,
  userId,
  access,
  playlists: playlistsProp,
  onPlaylistsChange,
  onLibraryChange,
  isMobile,
  deepLinkType = "song",
  showOfflineDownload = false,
}) {
  const [open, setOpen] = useState(false);
  const [inLib, setInLib] = useState(false);
  const [offlineQueued, setOfflineQueued] = useState(false);
  const [playlists, setPlaylists] = useState(playlistsProp || []);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState("");
  const [flashCheck, setFlashCheck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionFlash, setActionFlash] = useState(null);

  const slug = track?.slug;
  const canAddLibrary = Boolean(access?.canAddToLibrary);
  const canAddPlaylist = Boolean(access?.canAddToPlaylist);
  const canAdd = canAddLibrary || canAddPlaylist;

  const currentPlaylist = useMemo(
    () => playlists.find((p) => !p.isSystem) || null,
    [playlists]
  );

  useEffect(() => {
    if (!userId || !slug) {
      setInLib(false);
      setOfflineQueued(false);
      return;
    }
    setInLib(isInLibrary(userId, slug));
    setOfflineQueued(isOfflineQueued(userId, slug));
  }, [userId, slug, open]);

  useEffect(() => {
    if (playlistsProp) setPlaylists(playlistsProp);
    else if (userId) setPlaylists(loadPlaylists(userId).filter((p) => !p.isSystem));
  }, [playlistsProp, userId, open]);

  const flashAction = useCallback((key, ms = 900) => {
    setActionFlash(key);
    const t = setTimeout(() => setActionFlash(null), ms);
    return () => clearTimeout(t);
  }, []);

  const refreshPlaylists = useCallback(() => {
    const next = loadPlaylists(userId).filter((p) => !p.isSystem);
    setPlaylists(next);
    onPlaylistsChange?.(next);
  }, [userId, onPlaylistsChange]);

  const handleAddToLibrary = async () => {
    if (!userId || !track?.slug || saving || !canAddLibrary) return;
    setSaving(true);
    flashAction("library");
    addToLibrary(userId, track);
    try {
      await postLibraryAdd(track.slug);
      onLibraryChange?.();
    } catch {
      /* local library bookmark still saved */
    } finally {
      setSaving(false);
    }
    setInLib(true);
    setFlashCheck(true);
    setTimeout(() => setFlashCheck(false), 1200);
    setTimeout(() => setOpen(false), 450);
  };

  const handleAddToPlaylist = (playlistId) => {
    if (!userId || !canAddPlaylist) return;
    flashAction(playlistId);
    addTrackToPlaylist(userId, playlistId, track);
    refreshPlaylists();
    setTimeout(() => setOpen(false), 450);
  };

  const handleAddToCurrentPlaylist = () => {
    if (!currentPlaylist?.id || !canAddPlaylist) return;
    flashAction("current-playlist");
    addTrackToPlaylist(userId, currentPlaylist.id, track);
    refreshPlaylists();
    setTimeout(() => setOpen(false), 450);
  };

  const handleCreateAndAdd = () => {
    if (!userId || !newPlaylistTitle.trim() || !canAddPlaylist) return;
    flashAction("create");
    const pl = createPlaylist(userId, { title: newPlaylistTitle.trim(), trackIds: [] });
    addTrackToPlaylist(userId, pl.id, track);
    setNewPlaylistTitle("");
    refreshPlaylists();
    setTimeout(() => setOpen(false), 450);
  };

  const handleOffline = async () => {
    if (!userId || !access?.canOffline) return;
    const src = resolvePlaybackSrc(track, access, { userId });
    await queueOfflineDownload(userId, track, { streamUrl: src });
    setOfflineQueued(true);
    setOpen(false);
  };

  const handleShare = async () => {
    flashAction("share", 600);
    const url = buildShareUrl({ type: deepLinkType, slug: track.slug });
    try {
      if (navigator.share) {
        await navigator.share({ title: track.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        alert("Link copied to clipboard.");
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        alert("Link copied to clipboard.");
      } catch {
        alert(url);
      }
    }
    setTimeout(() => setOpen(false), 350);
  };

  const showCheck = inLib || flashCheck;
  const showPlus = canAdd || Boolean(userId);

  if (!showPlus) return null;

  return (
    <>
      <button
        type="button"
        aria-label={showCheck ? "In library" : "More actions"}
        onClick={() => setOpen(true)}
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: `1px solid ${showCheck ? "#00ffff55" : "#333"}`,
          background: showCheck ? "rgba(0,255,255,0.12)" : actionFlash ? "rgba(0,255,255,0.06)" : "transparent",
          color: showCheck ? "#00ffff" : "#888",
          cursor: "pointer",
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1,
          flexShrink: 0,
          transition: "all 0.2s",
          transform: actionFlash ? "scale(0.94)" : "scale(1)",
        }}
      >
        {showCheck ? "✓" : "+"}
      </button>

      <PlusActionSheet
        open={open}
        onClose={() => setOpen(false)}
        track={track}
        isMobile={isMobile}
        inLib={inLib}
        offlineQueued={offlineQueued}
        access={access}
        userId={userId}
        playlists={playlists}
        currentPlaylist={currentPlaylist}
        newPlaylistTitle={newPlaylistTitle}
        onNewPlaylistTitleChange={setNewPlaylistTitle}
        onAddToLibrary={handleAddToLibrary}
        onAddToPlaylist={handleAddToPlaylist}
        onAddToCurrentPlaylist={currentPlaylist ? handleAddToCurrentPlaylist : undefined}
        onCreateAndAdd={handleCreateAndAdd}
        onOffline={handleOffline}
        onShare={handleShare}
        showOfflineDownload={showOfflineDownload}
        actionFlash={actionFlash}
      />
    </>
  );
}
