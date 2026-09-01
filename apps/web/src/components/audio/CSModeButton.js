"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { motion } from "framer-motion";
import { useAudioPlayer } from "@/context/AudioContext";

const pressSpring = { type: "spring", stiffness: 520, damping: 28, mass: 0.55 };

function TimeDistortionIcon({ active, animate, gradId, glowId }) {
  const stroke = active ? "#00BFFF" : "rgba(255,255,255,0.35)";
  const fillWave = active ? `url(#${gradId})` : "rgba(255,255,255,0.12)";

  return (
    <svg viewBox="0 0 32 32" width={22} height={22} aria-hidden className={animate ? "cs-distort-icon--pulse" : undefined}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00BFFF" />
          <stop offset="100%" stopColor="#1B9FFF" />
        </linearGradient>
        <filter id={glowId}>
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx="16" cy="16" r="13" fill="none" stroke={stroke} strokeWidth="1.2" opacity={active ? 0.85 : 0.45} />
      <path
        d="M6 18 C9 12, 13 22, 16 14 C19 6, 23 16, 26 10"
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        filter={active ? `url(#${glowId})` : undefined}
        className={animate ? "cs-distort-wave" : undefined}
      />
      <path
        d="M8 20 C11 14, 14 24, 17 16 C20 8, 24 18, 27 12"
        fill="none"
        stroke={fillWave}
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity={active ? 0.9 : 0.35}
        className={animate ? "cs-distort-wave cs-distort-wave--lag" : undefined}
      />
      <circle cx="16" cy="16" r="2.5" fill={active ? "#1B9FFF" : "rgba(255,255,255,0.2)"} />
    </svg>
  );
}

export default function CSModeButton({ style: styleOverride }) {
  const { csMode, toggleCSMode, isPlaying } = useAudioPlayer();
  const uid = useId().replace(/:/g, "");
  const gradId = `csWaveGrad-${uid}`;
  const glowId = `csGlow-${uid}`;
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
    <motion.button
      type="button"
      aria-label={active ? "Turn off chopped and slowed" : "Turn on chopped and slowed"}
      aria-pressed={active}
      onClick={handleClick}
      className={[
        "cs-mode-btn",
        "player-glass-btn",
        active ? "cs-mode-btn--active" : "",
        animating ? "cs-mode-btn--ripple" : "",
        showMotion ? "cs-mode-btn--breath" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      whileTap={{ scale: 0.96 }}
      transition={pressSpring}
      style={{
        width: 44,
        height: 44,
        padding: 0,
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        ...styleOverride,
      }}
    >
      <TimeDistortionIcon active={active} animate={showMotion} gradId={gradId} glowId={glowId} />
    </motion.button>
  );
}
