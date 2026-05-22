"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { usePlaylists } from "@/hooks/usePlaylists";

const COVER_GRADIENT = "linear-gradient(135deg, rgba(0,255,255,0.12), rgba(162,89,255,0.12))";

function resolvePlaylistCover(playlist, catalogTracks) {
  return (
    playlist.artwork ||
    playlist.tracks?.[0]?.cover ||
    catalogTracks.find((t) => t.slug === playlist.tracks?.[0]?.slug)?.cover ||
    null
  );
}

function PlaylistDragRow({ track, index, onRemove }) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      value={track}
      dragListener={false}
      dragControls={dragControls}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
        color: "#ccc",
        padding: "10px 0",
        borderBottom: "1px solid #141414",
        background: "#0a0a0a",
        listStyle: "none",
      }}
      whileDrag={{
        scale: 1.02,
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        zIndex: 2,
      }}
      layout
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
    >
      <span style={{ width: 24, color: "#555", fontSize: 12, textAlign: "right", flexShrink: 0 }}>{index + 1}</span>
      <button
        type="button"
        aria-label={`Reorder ${track.title}`}
        className="playlist-drag-handle"
        onPointerDown={(e) => dragControls.start(e)}
        style={{
          touchAction: "none",
          padding: "8px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid #222",
          borderRadius: 8,
          color: "#666",
          cursor: "grab",
          fontSize: 14,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ⠿
      </button>
      <span style={{ flex: 1, minWidth: 0 }}>{track.title}</span>
      <button
        type="button"
        onClick={() => onRemove(track.id || track.slug)}
        style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 11, padding: "8px 4px" }}
      >
        Remove
      </button>
    </Reorder.Item>
  );
}

function PlaylistTrackList({ playlistId, tracks, isMobile, reorder, update, removeTrack }) {
  const [ordered, setOrdered] = useState(tracks);

  useEffect(() => {
    setOrdered(tracks);
  }, [tracks]);

  const commitOrder = useCallback(
    (nextTracks) => {
      setOrdered(nextTracks);
      const trackIds = nextTracks.map((t) => t.id || t.slug).filter(Boolean);
      reorder(playlistId, trackIds);
      update(playlistId, { tracks: nextTracks });
    },
    [playlistId, reorder, update]
  );

  const moveTrack = useCallback(
    (fromIndex, direction) => {
      const next = [...ordered];
      const toIndex = fromIndex + direction;
      if (toIndex < 0 || toIndex >= next.length) return;
      [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
      commitOrder(next);
    },
    [ordered, commitOrder]
  );

  if (!ordered.length) {
    return <div style={{ fontSize: 12, color: "#555", marginTop: 12 }}>No tracks yet. Add tracks below.</div>;
  }

  if (isMobile) {
    return (
      <Reorder.Group
        axis="y"
        values={ordered}
        onReorder={commitOrder}
        style={{ marginTop: 12, display: "flex", flexDirection: "column", padding: 0 }}
      >
        {ordered.map((track, trackIndex) => (
          <PlaylistDragRow
            key={track.slug || track.id}
            track={track}
            index={trackIndex}
            onRemove={(key) => removeTrack(playlistId, key)}
          />
        ))}
      </Reorder.Group>
    );
  }

  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column" }}>
      {ordered.map((track, trackIndex) => (
        <div
          key={track.slug || track.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            color: "#ccc",
            padding: "8px 0",
            borderBottom: "1px solid #141414",
          }}
        >
          <span style={{ width: 24, color: "#555", fontSize: 12, textAlign: "right" }}>{trackIndex + 1}</span>
          <span style={{ flex: 1, minWidth: 0 }}>{track.title}</span>
          <button
            type="button"
            disabled={trackIndex === 0}
            onClick={() => moveTrack(trackIndex, -1)}
            style={{
              background: "none",
              border: "none",
              color: trackIndex === 0 ? "#333" : "#666",
              cursor: trackIndex === 0 ? "default" : "pointer",
              fontSize: 10,
            }}
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={trackIndex === ordered.length - 1}
            onClick={() => moveTrack(trackIndex, 1)}
            style={{
              background: "none",
              border: "none",
              color: trackIndex === ordered.length - 1 ? "#333" : "#666",
              cursor: trackIndex === ordered.length - 1 ? "default" : "pointer",
              fontSize: 10,
            }}
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => removeTrack(playlistId, track.id || track.slug)}
            style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 11 }}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function NewPlaylistModal({ onCancel, onCreate }) {
  const [name, setName] = useState("");

  return (
    <div
      role="dialog"
      aria-label="New playlist"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 7500,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "#0a0a0a",
          border: "1px solid #222",
          borderRadius: 16,
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            aspectRatio: "1",
            borderRadius: 12,
            background: COVER_GRADIENT,
            marginBottom: 20,
          }}
        />
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10, fontWeight: 700 }}>
          New Playlist
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Playlist name"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && name.trim() && onCreate(name.trim())}
          style={{
            width: "100%",
            padding: "12px 14px",
            background: "#111",
            border: "1px solid #333",
            borderRadius: 10,
            color: "white",
            fontSize: 15,
            marginBottom: 16,
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "12px",
              background: "#111",
              color: "#888",
              border: "1px solid #333",
              borderRadius: 10,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => onCreate(name.trim())}
            style={{
              flex: 1,
              padding: "12px",
              background: "#00ffff",
              color: "#000",
              border: "none",
              borderRadius: 10,
              cursor: name.trim() ? "pointer" : "not-allowed",
              fontSize: 13,
              fontWeight: 800,
              opacity: name.trim() ? 1 : 0.4,
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function PlaylistSection({
  userId,
  catalogTracks = [],
  onPlayPlaylist,
  onAddTrackToPlaylist,
  subscriptionLocked = false,
  isMobile = false,
}) {
  const { playlists, create, update, remove, addTrack, removeTrack, reorder } = usePlaylists(userId);
  const [detailId, setDetailId] = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);
  const [showAddTracks, setShowAddTracks] = useState(false);

  const detailPlaylist = useMemo(
    () => playlists.find((p) => p.id === detailId) || null,
    [playlists, detailId]
  );

  const catalogBySlug = useMemo(() => new Map(catalogTracks.map((t) => [t.slug, t])), [catalogTracks]);

  const openDetail = useCallback((playlist) => {
    setDetailId(playlist.id);
    setDraftTitle(playlist.title);
    setEditingTitle(false);
    setShowAddTracks(false);
  }, []);

  const handleCreateFromModal = useCallback(
    (title) => {
      const created = create({ title });
      setShowNewModal(false);
      openDetail(created);
    },
    [create, openDetail]
  );

  const saveTitle = useCallback(
    (playlistId) => {
      if (draftTitle.trim()) update(playlistId, { title: draftTitle.trim() });
      setEditingTitle(false);
    },
    [draftTitle, update]
  );

  const tracksInPlaylist = useMemo(() => {
    if (!detailPlaylist) return [];
    const raw = detailPlaylist.tracks || [];
    if (raw.length) return raw;
    return (detailPlaylist.trackIds || []).map((id) => catalogBySlug.get(id)).filter(Boolean);
  }, [detailPlaylist, catalogBySlug]);

  const addableTracks = useMemo(() => {
    if (!detailPlaylist) return [];
    const inPlaylist = new Set(tracksInPlaylist.map((t) => t.slug || t.id));
    return catalogTracks.filter((t) => t.slug && !inPlaylist.has(t.slug));
  }, [catalogTracks, detailPlaylist, tracksInPlaylist]);

  const playDetail = useCallback(
    (shuffle = false) => {
      if (!detailPlaylist) return;
      onPlayPlaylist?.({ ...detailPlaylist, tracks: tracksInPlaylist, shuffle });
    },
    [detailPlaylist, onPlayPlaylist, tracksInPlaylist]
  );

  if (detailPlaylist) {
    const cover = resolvePlaylistCover(detailPlaylist, catalogTracks);
    const trackCount = tracksInPlaylist.length;

    return (
      <section style={{ marginBottom: 36 }}>
        <button
          type="button"
          onClick={() => setDetailId(null)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "none",
            border: "none",
            color: "#00ffff",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 700,
            marginBottom: 16,
            padding: 0,
          }}
        >
          ← Back
        </button>

        <div style={{ display: "flex", flexDirection: "column", alignItems: isMobile ? "stretch" : "flex-start", gap: 16, marginBottom: 20 }}>
          {cover ? (
            <img
              src={cover}
              alt=""
              style={{ width: 200, height: 200, borderRadius: 12, objectFit: "cover", alignSelf: "center" }}
            />
          ) : (
            <div
              style={{
                width: 200,
                height: 200,
                borderRadius: 12,
                background: COVER_GRADIENT,
                border: "1px solid #222",
                alignSelf: "center",
              }}
            />
          )}
          {editingTitle ? (
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={() => saveTitle(detailPlaylist.id)}
              onKeyDown={(e) => e.key === "Enter" && saveTitle(detailPlaylist.id)}
              autoFocus
              style={{
                width: "100%",
                padding: "10px 12px",
                background: "#111",
                border: "1px solid #333",
                borderRadius: 8,
                color: "white",
                fontSize: 20,
                fontWeight: 800,
                textAlign: "center",
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingTitle(true);
                setDraftTitle(detailPlaylist.title);
              }}
              style={{
                background: "none",
                border: "none",
                color: "white",
                fontSize: 22,
                fontWeight: 800,
                cursor: "pointer",
                textAlign: "center",
                padding: 0,
              }}
            >
              {detailPlaylist.title}
            </button>
          )}
          <div style={{ fontSize: 12, color: "#555", textAlign: "center" }}>{trackCount} track{trackCount !== 1 ? "s" : ""}</div>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={subscriptionLocked || trackCount === 0}
            onClick={() => playDetail(false)}
            style={{
              padding: "10px 22px",
              background: "#00ffff",
              color: "#000",
              border: "none",
              borderRadius: 10,
              cursor: subscriptionLocked || trackCount === 0 ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 800,
              opacity: subscriptionLocked || trackCount === 0 ? 0.4 : 1,
            }}
          >
            Play
          </button>
          <button
            type="button"
            disabled={subscriptionLocked || trackCount === 0}
            onClick={() => playDetail(true)}
            style={{
              padding: "10px 22px",
              background: "#111",
              color: "#00ffff",
              border: "1px solid rgba(0,255,255,0.3)",
              borderRadius: 10,
              cursor: subscriptionLocked || trackCount === 0 ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 700,
              opacity: subscriptionLocked || trackCount === 0 ? 0.4 : 1,
            }}
          >
            Shuffle
          </button>
          <button
            type="button"
            onClick={() => {
              remove(detailPlaylist.id);
              setDetailId(null);
            }}
            style={{
              padding: "10px 16px",
              background: "none",
              color: "#666",
              border: "1px solid #333",
              borderRadius: 10,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Delete
          </button>
        </div>

        <PlaylistTrackList
          playlistId={detailPlaylist.id}
          tracks={tracksInPlaylist}
          isMobile={isMobile}
          reorder={reorder}
          update={update}
          removeTrack={removeTrack}
        />

        <button
          type="button"
          onClick={() => setShowAddTracks((v) => !v)}
          style={{
            marginTop: 16,
            padding: "10px 16px",
            background: "rgba(0,255,255,0.08)",
            color: "#00ffff",
            border: "1px solid rgba(0,255,255,0.25)",
            borderRadius: 10,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            width: "100%",
          }}
        >
          + Add tracks
        </button>

        {showAddTracks && addableTracks.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
            {addableTracks.map((track) => (
              <button
                key={track.slug}
                type="button"
                onClick={() => {
                  addTrack(detailPlaylist.id, track);
                  onAddTrackToPlaylist?.(detailPlaylist, track);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  background: "#111",
                  border: "1px solid #222",
                  borderRadius: 10,
                  cursor: "pointer",
                  textAlign: "left",
                  color: "#ccc",
                  fontSize: 13,
                }}
              >
                {track.cover && (
                  <img src={track.cover} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }} />
                )}
                <span style={{ flex: 1 }}>{track.title}</span>
                <span style={{ color: "#00ffff", fontSize: 18 }}>+</span>
              </button>
            ))}
          </div>
        )}
        {showAddTracks && addableTracks.length === 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>All catalog tracks are already in this playlist.</div>
        )}
      </section>
    );
  }

  return (
    <section style={{ marginBottom: 36 }}>
      {showNewModal && (
        <NewPlaylistModal onCancel={() => setShowNewModal(false)} onCreate={handleCreateFromModal} />
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>
          Playlists
        </div>
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          style={{
            padding: "8px 14px",
            background: "rgba(0,255,255,0.08)",
            color: "#00ffff",
            border: "1px solid rgba(0,255,255,0.3)",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          + New Playlist
        </button>
      </div>

      {playlists.length === 0 ? (
        <div
          style={{
            padding: "24px 20px",
            background: "#0a0a0a",
            border: "1px dashed #222",
            borderRadius: 14,
            color: "#555",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          Create a playlist to queue your owned tracks.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          {playlists.map((playlist) => {
            const cover = resolvePlaylistCover(playlist, catalogTracks);
            const count = (playlist.tracks || []).length || playlist.trackIds?.length || 0;
            return (
              <button
                key={playlist.id}
                type="button"
                onClick={() => openDetail(playlist)}
                style={{
                  textAlign: "left",
                  background: "#0a0a0a",
                  border: "1px solid #1a1a1a",
                  borderRadius: 14,
                  overflow: "hidden",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <div style={{ aspectRatio: "1", position: "relative" }}>
                  {cover ? (
                    <img src={cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", background: COVER_GRADIENT }} />
                  )}
                </div>
                <div style={{ padding: "10px 12px 12px" }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      marginBottom: 4,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {playlist.title}
                  </div>
                  <div style={{ fontSize: 10, color: "#555" }}>
                    {count} track{count !== 1 ? "s" : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default memo(PlaylistSection);
