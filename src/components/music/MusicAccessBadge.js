"use client";

export default function MusicAccessBadge({ access, label, compact }) {
  const text = label || access?.badge;
  if (!text) return null;
  const color =
    access?.collector || text === "Collector Access"
      ? "#a259ff"
      : access?.subscription || String(text).includes("Subscription")
        ? "#00ffff"
        : access?.canStream
          ? "#00ffff"
          : "#888";
  return (
    <span
      style={{
        fontSize: compact ? 8 : 9,
        fontWeight: 800,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}44`,
        padding: compact ? "2px 6px" : "3px 8px",
        borderRadius: 20,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}
