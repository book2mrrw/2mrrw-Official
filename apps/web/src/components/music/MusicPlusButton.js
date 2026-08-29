"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addToLibrary,
  addTrackToPlaylist,
  createPlaylist,
  isInLibrary,
  loadPlaylists,
} from "@/lib/playlists";
import { postLibraryAdd } from "@/lib/library-client";
import MusicOptionsSheet from "@/components/music/MusicOptionsSheet";
import { PlusIcon } from "@/components/music/MusicIcons";

export default function MusicPlusButton({
  track,
  userId,
  access,
  onPlaylistsChange,
  onLibraryChange,
  sheetBg,
  className,
  style,
}) {
  const [open, setOpen] = useState(false);
  const [inLib, setInLib] = useState(false);
  const [playlists, setPlaylists] = useState([]);
  const [newPlaylistTitle, setNewPlaylistTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const slug = track?.slug;
  const canStream = Boolean(access?.canStream);

  useEffect(() => {
    if (!userId || !slug) {
      setInLib(false);
      return;
    }
    setInLib(isInLibrary(userId, slug));
  }, [userId, slug, open]);

  useEffect(() => {
    if (!userId || !open) return;
    setPlaylists(loadPlaylists(userId).filter((p) => !p.isSystem));
  }, [userId, open]);

  const refreshPlaylists = useCallback(() => {
    const next = loadPlaylists(userId).filter((p) => !p.isSystem);
    setPlaylists(next);
    onPlaylistsChange?.(next);
  }, [userId, onPlaylistsChange]);

  const handleAddToLibrary = async () => {
    if (!userId || !track?.slug || saving || !canStream) return;
    setSaving(true);
    addToLibrary(userId, track);
    try {
      await postLibraryAdd(track.slug);
      onLibraryChange?.();
    } catch {
      /* local bookmark still saved */
    } finally {
      setSaving(false);
    }
    setInLib(true);
    setTimeout(() => setOpen(false), 350);
  };

  const handleAddToPlaylist = (playlistId) => {
    if (!userId || !canStream) return;
    addTrackToPlaylist(userId, playlistId, track);
    refreshPlaylists();
    setOpen(false);
  };

  const handleCreateAndAdd = () => {
    if (!userId || !newPlaylistTitle.trim() || !canStream) return;
    const pl = createPlaylist(userId, { title: newPlaylistTitle.trim(), trackIds: [] });
    addTrackToPlaylist(userId, pl.id, track);
    setNewPlaylistTitle("");
    refreshPlaylists();
    setOpen(false);
  };

  const handleShare = async () => {
    if (!track?.slug) return;
    const url = `/?track=${encodeURIComponent(track.slug)}`;
    const artist = track.artist || track.artistName || "2MRRW";
    const payload = {
      title: track.title || "Track",
      text: `${track.title || "Track"} by ${artist}`,
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(payload);
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

  if (!track?.slug) return null;

  return (
    <>
      <button
        type="button"
        data-release-action="library"
        className={className}
        aria-label="More actions"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        style={{
          minWidth: 44,
          minHeight: 44,
          width: 44,
          height: 44,
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
          touchAction: "manipulation",
          color: open ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.55)",
          transition: "color 0.15s",
          ...style,
        }}
      >
        <PlusIcon size={22} />
      </button>

      <MusicOptionsSheet
        open={open}
        onClose={() => setOpen(false)}
        track={track}
        access={access}
        sheetBg={sheetBg}
        userId={userId}
        inLib={inLib}
        playlists={playlists}
        onShare={handleShare}
        onAddToLibrary={handleAddToLibrary}
        onAddToPlaylist={handleAddToPlaylist}
        onCreateAndAdd={handleCreateAndAdd}
        newPlaylistTitle={newPlaylistTitle}
        onNewPlaylistTitleChange={setNewPlaylistTitle}
      />
    </>
  );
}
