"use client";

export default function PlaylistCard({ playlist, trackCount, onClick, isMobile }) {
  const cover = playlist.artwork || playlist.tracks?.[0]?.cover;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: isMobile ? "0 0 140px" : undefined,
        width: isMobile ? 140 : "100%",
        textAlign: "left",
        background: "#0a0a0a",
        border: "1px solid #1a1a1a",
        borderRadius: 14,
        overflow: "hidden",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <div
        style={{
          aspectRatio: "1/1",
          background: cover
            ? `url(${cover}) center/cover`
            : "linear-gradient(135deg,rgba(0,255,255,0.08),rgba(162,89,255,0.08))",
        }}
      />
      <div style={{ padding: "10px 12px 14px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {playlist.title}
        </div>
        <div style={{ fontSize: 10, color: "#555" }}>{trackCount} track{trackCount !== 1 ? "s" : ""}</div>
      </div>
    </button>
  );
}
