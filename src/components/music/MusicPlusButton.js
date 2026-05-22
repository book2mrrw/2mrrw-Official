"use client";

import { useCallback, useEffect, useState } from "react";
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
}) {
  const [open, setOpen] = useState(false);
  const [inLib, setInLib] = useState(false);
  const [offlineQueued, setOfflineQueued] = useState(false);
  const [playlists, setPlaylists] = useState(playlistsProp || []);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState("");
  const [flashCheck, setFlashCheck] = useState(false);
  const [saving, setSaving] = useState(false);

  const slug = track?.slug;

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

  const refreshPlaylists = useCallback(() => {
    const next = loadPlaylists(userId).filter((p) => !p.isSystem);
    setPlaylists(next);
    onPlaylistsChange?.(next);
  }, [userId, onPlaylistsChange]);

  const handleAddToLibrary = async () => {
    if (!userId || !track?.slug || saving) return;
    setSaving(true);
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
    setOpen(false);
  };

  const handleAddToPlaylist = (playlistId) => {
    if (!userId) return;
    addTrackToPlaylist(userId, playlistId, track);
    refreshPlaylists();
    setOpen(false);
  };

  const handleCreateAndAdd = () => {
    if (!userId || !newPlaylistTitle.trim()) return;
    const pl = createPlaylist(userId, { title: newPlaylistTitle.trim(), trackIds: [] });
    addTrackToPlaylist(userId, pl.id, track);
    setNewPlaylistTitle("");
    refreshPlaylists();
    setOpen(false);
  };

  const handleOffline = async () => {
    if (!userId || !access?.canOffline) return;
    const src = resolvePlaybackSrc(track, access, { userId });
    await queueOfflineDownload(userId, track, { streamUrl: src });
    setOfflineQueued(true);
    setOpen(false);
  };

  const handleShare = async () => {
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
    setOpen(false);
  };

  const showCheck = inLib || flashCheck;
  const showPlus = access?.canStream || access?.canPreview || access?.canOffline;

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
          background: showCheck ? "rgba(0,255,255,0.12)" : "transparent",
          color: showCheck ? "#00ffff" : "#888",
          cursor: "pointer",
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1,
          flexShrink: 0,
          transition: "all 0.2s",
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
        newPlaylistTitle={newPlaylistTitle}
        onNewPlaylistTitleChange={setNewPlaylistTitle}
        onAddToLibrary={handleAddToLibrary}
        onAddToPlaylist={handleAddToPlaylist}
        onCreateAndAdd={handleCreateAndAdd}
        onOffline={handleOffline}
        onShare={handleShare}
      />
    </>
  );
}
