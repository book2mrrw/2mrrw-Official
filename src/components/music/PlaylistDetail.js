"use client";

import { useMemo } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { resolvePlaylistTracks } from "@/lib/playlists";

export default function PlaylistDetail({ playlist, catalogBySlug, onBack, isMobile }) {
  const { playQueue, toggleShuffle, shuffle, toggleRepeat, repeatMode } = useAudioPlayer();

  const tracks = useMemo(
    () => resolvePlaylistTracks(playlist, catalogBySlug),
    [playlist, catalogBySlug]
  );

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        style={{ background: "none", border: "none", color: "#00ffff", cursor: "pointer", fontSize: 12, fontWeight: 700, marginBottom: 16 }}
      >
        ← Playlists
      </button>
      <h3 style={{ fontSize: 20, fontWeight: 900, marginBottom: 8 }}>{playlist.title}</h3>
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => playQueue(tracks, 0)}
          style={{ padding: "10px 18px", background: "#00ffff", color: "#000", border: "none", borderRadius: 10, fontWeight: 900, fontSize: 12, cursor: "pointer" }}
        >
          Play All
        </button>
        <button
          type="button"
          onClick={() => toggleShuffle()}
          style={{ padding: "10px 14px", background: shuffle ? "rgba(0,255,255,0.12)" : "#111", color: shuffle ? "#00ffff" : "#888", border: "1px solid #333", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >
          Shuffle
        </button>
        <button
          type="button"
          onClick={() => toggleRepeat()}
          style={{ padding: "10px 14px", background: repeatMode !== "off" ? "rgba(0,255,255,0.12)" : "#111", color: repeatMode !== "off" ? "#00ffff" : "#888", border: "1px solid #333", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >
          Repeat {repeatMode === "one" ? "1" : repeatMode === "all" ? "∞" : ""}
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tracks.map((track, i) => (
          <div
            key={track.slug || i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              background: "#0a0a0a",
              border: "1px solid #1a1a1a",
              borderRadius: 10,
            }}
          >
            <span style={{ fontSize: 11, color: "#444", width: 20 }}>{i + 1}</span>
            {track.cover && <img src={track.cover} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{track.title}</div>
            </div>
            <button
              type="button"
              onClick={() => playQueue(tracks, i)}
              style={{ background: "none", border: "none", color: "#00ffff", cursor: "pointer", fontSize: 16 }}
              aria-label={`Play ${track.title}`}
            >
              ▶
            </button>
          </div>
        ))}
        {!tracks.length && <p style={{ color: "#555", fontSize: 13 }}>No tracks in this playlist yet.</p>}
      </div>
    </div>
  );
}
