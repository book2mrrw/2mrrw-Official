"use client";

import { memo, useState } from "react";
import { usePlaylists } from "@/hooks/usePlaylists";

function PlaylistSection({
  userId,
  catalogTracks = [],
  onPlayPlaylist,
  onAddTrackToPlaylist,
  subscriptionLocked = false,
}) {
  const { playlists, create, update, remove, addTrack, removeTrack } = usePlaylists(userId);
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");

  const handleCreate = () => {
    const created = create({ title: "New Playlist" });
    setEditingId(created.id);
    setDraftTitle(created.title);
  };

  const saveTitle = (playlistId) => {
    if (draftTitle.trim()) update(playlistId, { title: draftTitle.trim() });
    setEditingId(null);
  };

  return (
    <section style={{ marginBottom: 36 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>Playlists</div>
        <button
          type="button"
          onClick={handleCreate}
          style={{ padding: "8px 14px", background: "rgba(0,255,255,0.08)", color: "#00ffff", border: "1px solid rgba(0,255,255,0.3)", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}
        >
          + New Playlist
        </button>
      </div>

      {playlists.length === 0 ? (
        <div style={{ padding: "24px 20px", background: "#0a0a0a", border: "1px dashed #222", borderRadius: 14, color: "#555", fontSize: 13, textAlign: "center" }}>
          Create a playlist to queue your owned tracks.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {playlists.map((playlist) => (
            <div key={playlist.id} style={{ background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                {editingId === playlist.id ? (
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={() => saveTitle(playlist.id)}
                    onKeyDown={(e) => e.key === "Enter" && saveTitle(playlist.id)}
                    style={{ flex: 1, minWidth: 140, padding: "8px 10px", background: "#111", border: "1px solid #333", borderRadius: 8, color: "white", fontSize: 13 }}
                    autoFocus
                  />
                ) : (
                  <div style={{ flex: 1, fontSize: 15, fontWeight: 800, letterSpacing: 0.5 }}>{playlist.title}</div>
                )}
                <span style={{ fontSize: 10, color: "#555" }}>{(playlist.tracks || []).length || playlist.trackIds?.length || 0} tracks</span>
                <button type="button" onClick={() => { setEditingId(playlist.id); setDraftTitle(playlist.title); }} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11 }}>Edit</button>
                <button type="button" onClick={() => remove(playlist.id)} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11 }}>Delete</button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={subscriptionLocked || !(playlist.tracks?.length || playlist.trackIds?.length)}
                  onClick={() => onPlayPlaylist?.(playlist)}
                  style={{ padding: "8px 14px", background: "#00ffff", color: "#000", border: "none", borderRadius: 8, cursor: subscriptionLocked ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 800, opacity: subscriptionLocked ? 0.4 : 1 }}
                >
                  Play
                </button>
                {catalogTracks.slice(0, 4).map((track) => (
                  <button
                    key={`${playlist.id}-${track.slug}`}
                    type="button"
                    onClick={() => {
                      addTrack(playlist.id, track);
                      onAddTrackToPlaylist?.(playlist, track);
                    }}
                    style={{ padding: "6px 10px", background: "#111", color: "#aaa", border: "1px solid #222", borderRadius: 8, cursor: "pointer", fontSize: 10 }}
                  >
                    + {track.title}
                  </button>
                ))}
              </div>
              {(playlist.tracks || []).length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {(playlist.tracks || []).map((track) => (
                    <div key={track.slug || track.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "#ccc", padding: "4px 0", borderBottom: "1px solid #141414" }}>
                      <span>{track.title}</span>
                      <button type="button" onClick={() => removeTrack(playlist.id, track.id || track.slug)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 10 }}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(PlaylistSection);
