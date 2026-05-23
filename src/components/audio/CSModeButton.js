"use client";

import { useAudioPlayer } from "@/context/AudioContext";

const inactiveStyle = {
  background: "#111",
  color: "#555",
  border: "1px solid #333",
  boxShadow: "none",
};

const activeStyle = {
  background: "rgba(162, 89, 255, 0.12)",
  color: "#a259ff",
  border: "1px solid #a259ff",
  boxShadow: "0 0 12px rgba(162,89,255,0.45)",
};

function CassetteIcon({ active, paused }) {
  const stroke = active ? "#a259ff" : "#555";
  const reelClass = active && !paused ? "cs-reel-spin" : "";

  return (
    <svg viewBox="0 0 24 18" width={24} height={18} aria-hidden>
      <rect x="1" y="2" width="22" height="14" rx="2" fill="none" stroke={stroke} strokeWidth="1.2" />
      <rect x="4" y="5" width="16" height="8" rx="1" fill="none" stroke={stroke} strokeWidth="1" />
      <circle className={reelClass} cx="8" cy="9" r="2.5" fill="none" stroke={stroke} strokeWidth="1" />
      <circle className={reelClass} cx="16" cy="9" r="2.5" fill="none" stroke={stroke} strokeWidth="1" />
      <line x1="1" y1="2" x2="23" y2="2" stroke={stroke} strokeWidth="1.2" />
    </svg>
  );
}

export default function CSModeButton({ style: styleOverride }) {
  const { csMode, toggleCSMode, isPlaying } = useAudioPlayer();

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
        width: 44,
        height: 44,
        padding: 8,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        cursor: "pointer",
        flexShrink: 0,
        transition: "border-color 0.2s, box-shadow 0.2s, color 0.2s, background 0.2s",
        ...(csMode ? activeStyle : inactiveStyle),
        ...styleOverride,
      }}
    >
      <CassetteIcon active={csMode} paused={!isPlaying} />
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          lineHeight: 1,
        }}
      >
        {csMode ? "SLOWED" : "C&S"}
      </span>
    </button>
  );
}
