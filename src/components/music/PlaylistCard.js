"use client";

const COVER_GRADIENT = "linear-gradient(135deg, rgba(0,255,255,0.12), rgba(162,89,255,0.12))";

export default function PlaylistCard({ playlist, trackCount, cover, onOpen, onPlay, isMobile }) {
  const resolvedCover = cover || playlist.artwork || playlist.tracks?.[0]?.cover;

  return (
    <div
      style={{
        width: "100%",
        textAlign: "left",
        background: "#0a0a0a",
        border: "1px solid #1a1a1a",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <div style={{ aspectRatio: "1", position: "relative" }}>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${playlist.title}`}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            padding: 0,
            border: "none",
            cursor: "pointer",
            background: resolvedCover ? `url(${resolvedCover}) center/cover` : COVER_GRADIENT,
          }}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPlay?.();
          }}
          aria-label={`Play ${playlist.title}`}
          style={{
            position: "absolute",
            right: 8,
            bottom: 8,
            padding: "6px 12px",
            background: "rgba(0,255,255,0.92)",
            color: "#000",
            border: "none",
            borderRadius: 8,
            fontSize: 10,
            fontWeight: 800,
            cursor: "pointer",
            letterSpacing: 0.5,
          }}
        >
          Play
        </button>
      </div>
      <button
        type="button"
        onClick={onOpen}
        style={{
          width: "100%",
          padding: isMobile ? "10px 12px 12px" : "10px 12px 14px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
        }}
      >
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
          {trackCount} track{trackCount !== 1 ? "s" : ""}
        </div>
      </button>
    </div>
  );
}
