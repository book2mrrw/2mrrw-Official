"use client";

import { useAudioPlayer } from "@/context/AudioContext";
import { resolvePlaybackSrc } from "@/lib/music-access";

export default function ContinueListening({ lastPlayed, access, isMobile }) {
  const { playTrack } = useAudioPlayer();
  if (!lastPlayed?.slug) return null;

  const track = {
    slug: lastPlayed.slug,
    title: lastPlayed.title,
    cover: lastPlayed.cover,
    src: resolvePlaybackSrc(lastPlayed, access),
    source: "continue",
  };

  return (
    <div
      style={{
        background: "linear-gradient(135deg,#0e0e0e,#111)",
        border: "1px solid #1e1e1e",
        borderRadius: 14,
        padding: isMobile ? "14px 16px" : "16px 20px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      {lastPlayed.cover && (
        <img src={lastPlayed.cover} alt="" style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover" }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>
          Continue Listening
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {lastPlayed.title}
        </div>
        {lastPlayed.positionSeconds > 0 && (
          <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>
            Resume at {formatResume(lastPlayed.positionSeconds)}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => playTrack(track, { resumeAt: lastPlayed.positionSeconds || 0 })}
        style={{
          padding: "10px 18px",
          background: "#00ffff",
          color: "#000",
          border: "none",
          borderRadius: 10,
          fontWeight: 900,
          fontSize: 12,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        Play
      </button>
    </div>
  );
}

function formatResume(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
