"use client";

import { useAudioPlayer } from "@/context/AudioContext";

const inactiveStyle = {
  background: "#111",
  color: "#555",
  border: "1px solid #333",
  boxShadow: "none",
};

const activeStyle = {
  background: "#111",
  color: "#a259ff",
  border: "1px solid #a259ff",
  boxShadow: "0 0 12px rgba(162,89,255,0.45)",
};

export default function ChoppedSlowedToggle({ compact = false, style: styleOverride }) {
  const { csMode, toggleCSMode } = useAudioPlayer();

  return (
    <button
      type="button"
      aria-label={csMode ? "Turn off chopped and slowed" : "Turn on chopped and slowed"}
      aria-pressed={csMode}
      onClick={(e) => {
        e.stopPropagation();
        toggleCSMode();
      }}
      style={{
        height: compact ? 36 : 40,
        padding: compact ? "0 12px" : "0 14px",
        borderRadius: 8,
        fontSize: compact ? 10 : 11,
        fontWeight: 700,
        letterSpacing: 1.2,
        cursor: "pointer",
        flexShrink: 0,
        transition: "border-color 0.2s, box-shadow 0.2s, color 0.2s",
        ...(csMode ? activeStyle : inactiveStyle),
        ...styleOverride,
      }}
    >
      C&amp;S
    </button>
  );
}
