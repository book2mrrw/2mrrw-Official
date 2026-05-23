"use client";

import { useCallback, useEffect, useState } from "react";
import { useAudioPlayer } from "@/context/AudioContext";

const BAR_HEIGHTS = [6, 12, 20, 12, 6];
const BAR_X = [2, 8, 14, 20, 26];
const BAR_WIDTH = 4;

function FrequencyPulseIcon({ active, animateBars }) {
  const color = active ? "#1E90FF" : "#444";
  const baseY = 22;

  return (
    <svg viewBox="0 0 32 28" width={28} height={24} aria-hidden className={animateBars ? "cs-pulse-icon" : undefined}>
      {BAR_HEIGHTS.map((h, i) => (
        <rect
          key={i}
          className={animateBars ? "cs-bar-pulse" : undefined}
          x={BAR_X[i]}
          y={baseY - h}
          width={BAR_WIDTH}
          height={h}
          rx={1}
          fill={color}
          style={{ transformOrigin: `${BAR_X[i] + BAR_WIDTH / 2}px ${baseY}px` }}
        />
      ))}
      <path
        d="M16 24 L12 28 L20 28 Z"
        fill={color}
        className={animateBars ? "cs-arrow-glow" : undefined}
      />
    </svg>
  );
}

export default function CSModeButton({ style: styleOverride }) {
  const { csMode, toggleCSMode, isPlaying } = useAudioPlayer();
  const [animating, setAnimating] = useState(false);
  const active = csMode;
  const showMotion = active && isPlaying;

  const handleClick = useCallback(
    (e) => {
      e.stopPropagation();
      setAnimating(true);
      toggleCSMode();
    },
    [toggleCSMode]
  );

  useEffect(() => {
    if (!animating) return undefined;
    const t = window.setTimeout(() => setAnimating(false), 350);
    return () => window.clearTimeout(t);
  }, [animating]);

  return (
    <button
      type="button"
      aria-label={active ? "Turn off chopped and slowed" : "Turn on chopped and slowed"}
      aria-pressed={active}
      onClick={handleClick}
      className={[
        "cs-mode-btn",
        active ? "cs-mode-btn--active" : "",
        animating ? "cs-mode-btn--ripple" : "",
        showMotion ? "cs-mode-btn--breath" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: 44,
        height: 44,
        padding: "6px 8px",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        cursor: "pointer",
        flexShrink: 0,
        background: active ? "rgba(30, 144, 255, 0.1)" : "#111",
        color: active ? "#1E90FF" : "#444",
        border: active ? "1px solid #1E90FF" : "1px solid #333",
        ...styleOverride,
      }}
    >
      <FrequencyPulseIcon active={active} animateBars={showMotion} />
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          lineHeight: 1,
          color: active ? "#1E90FF" : "#444",
        }}
      >
        {active ? "SLOWED" : "SLOW"}
      </span>
    </button>
  );
}
