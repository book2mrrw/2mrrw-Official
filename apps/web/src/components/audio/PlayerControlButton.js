"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Play,
  Pause,
} from "lucide-react";

const TAP_MAX_MS = 300;
const HOLD_DELAY_MS = 300;
const SCRUB_INTERVAL_MS = 100;

const pressSpring = { type: "spring", stiffness: 520, damping: 28, mass: 0.55 };

function scrubMultiplier(holdMs) {
  const s = holdMs / 1000;
  if (s >= 12) return 16;
  if (s >= 9) return 8;
  if (s >= 6) return 4;
  if (s >= 3.5) return 2;
  return 1;
}

export const PlayerControlButton = memo(function PlayerControlButton({
  children,
  className = "",
  active = false,
  size = 40,
  variant = "square",
  ariaLabel,
  onClick,
  disabled,
  style: styleOverride,
}) {
  const radius = variant === "round" ? "50%" : variant === "capsule" ? 999 : 10;

  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={[
        "player-glass-btn",
        active ? "player-glass-btn--active" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      whileTap={{ scale: disabled ? 1 : 0.96 }}
      transition={pressSpring}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        ...styleOverride,
      }}
    >
      {children}
    </motion.button>
  );
});

export const TrackTransportButton = memo(function TrackTransportButton({
  direction,
  size = 40,
  onClick,
}) {
  const Icon = direction === "back" ? SkipBack : SkipForward;
  return (
    <PlayerControlButton
      ariaLabel={direction === "back" ? "Previous track" : "Next track"}
      size={size}
      variant="square"
      onClick={onClick}
    >
      <Icon size={Math.round(size * 0.42)} strokeWidth={2} aria-hidden />
    </PlayerControlButton>
  );
});

export const HoldSeekButton = memo(function HoldSeekButton({
  direction,
  size = 44,
  onTapSeek,
  onScrubTick,
}) {
  const [pressing, setPressing] = useState(false);
  const [badge, setBadge] = useState(null);
  const holdStartRef = useRef(0);
  const intervalRef = useRef(null);
  const tapHandledRef = useRef(false);

  const clearScrub = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setBadge(null);
    setPressing(false);
  }, []);

  const endHold = useCallback(() => {
    const started = holdStartRef.current;
    if (!started) return;
    const held = Date.now() - started;
    const wasScrubbing = Boolean(intervalRef.current);
    clearScrub();
    holdStartRef.current = 0;
    if (!wasScrubbing && !tapHandledRef.current && held < TAP_MAX_MS) {
      tapHandledRef.current = true;
      onTapSeek?.();
    }
  }, [clearScrub, onTapSeek]);

  const startHold = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      tapHandledRef.current = false;
      holdStartRef.current = Date.now();
      setPressing(true);

      window.setTimeout(() => {
        if (!holdStartRef.current) return;
        const elapsed = Date.now() - holdStartRef.current;
        if (elapsed < HOLD_DELAY_MS) return;

        tapHandledRef.current = true;
        intervalRef.current = window.setInterval(() => {
          const holdMs = Date.now() - holdStartRef.current;
          const mult = scrubMultiplier(holdMs);
          if (mult > 1) setBadge(`${mult}×`);
          else setBadge(null);
          onScrubTick?.(direction === "back" ? -mult : mult);
        }, SCRUB_INTERVAL_MS);
      }, HOLD_DELAY_MS);
    },
    [direction, onScrubTick]
  );

  useEffect(() => () => clearScrub(), [clearScrub]);

  const label = direction === "back" ? "-15" : "+15";

  return (
    <div className="player-hold-seek" style={{ position: "relative" }}>
      {badge && (
        <span className="player-scrub-badge" aria-live="polite">
          {badge}
        </span>
      )}
      <motion.button
        type="button"
        aria-label={direction === "back" ? "Rewind 15 seconds" : "Forward 15 seconds"}
        className={[
          "player-glass-btn",
          "player-hold-seek-btn",
          pressing ? "player-hold-seek-btn--pressing" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ width: size, height: size, borderRadius: 10 }}
        whileTap={{ scale: 0.94 }}
        transition={pressSpring}
        onPointerDown={startHold}
        onPointerUp={(e) => {
          e.stopPropagation();
          endHold();
        }}
        onPointerLeave={() => endHold()}
        onPointerCancel={endHold}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="player-hold-seek-label">{label}</span>
        {direction === "back" ? (
          <SkipBack size={Math.round(size * 0.34)} strokeWidth={2.2} aria-hidden />
        ) : (
          <SkipForward size={Math.round(size * 0.34)} strokeWidth={2.2} aria-hidden />
        )}
      </motion.button>
    </div>
  );
});

export const ShuffleButton = memo(function ShuffleButton({ active, size = 40, onClick }) {
  return (
    <PlayerControlButton
      ariaLabel="Shuffle"
      size={size}
      active={active}
      onClick={onClick}
    >
      <Shuffle size={Math.round(size * 0.38)} strokeWidth={2} aria-hidden />
    </PlayerControlButton>
  );
});

export const RepeatButton = memo(function RepeatButton({ repeatMode, size = 40, onClick }) {
  const active = repeatMode !== "off";
  const Icon = repeatMode === "one" ? Repeat1 : Repeat;
  const modeStyle = repeatMode === "one"
    ? { color: "#00ffff", borderColor: "rgba(0,255,255,0.45)", boxShadow: "0 0 16px rgba(0,255,255,0.35), 0 0 28px rgba(0,255,255,0.15), inset 0 1px 0 rgba(255,255,255,0.1)" }
    : repeatMode === "all"
      ? { color: "#a259ff", borderColor: "rgba(162,89,255,0.45)", boxShadow: "0 0 16px rgba(162,89,255,0.35), 0 0 28px rgba(162,89,255,0.15), inset 0 1px 0 rgba(255,255,255,0.1)" }
      : undefined;
  return (
    <PlayerControlButton
      ariaLabel="Repeat"
      size={size}
      active={active}
      onClick={onClick}
      style={modeStyle}
    >
      <Icon size={Math.round(size * 0.38)} strokeWidth={2} aria-hidden />
    </PlayerControlButton>
  );
});

export const PlayPauseHero = memo(function PlayPauseHero({
  isPlaying,
  hasError,
  size = 72,
  onClick,
}) {
  const iconSize = size >= 64 ? 26 : 16;

  return (
    <div className="player-hero-wrap" style={{ width: size, height: size }}>
      <div className={`player-hero-ambient${isPlaying && !hasError ? " is-playing" : ""}`} aria-hidden />
      <motion.button
        type="button"
        aria-label={isPlaying ? "Pause audio" : "Play audio"}
        className={[
          "player-hero-btn",
          hasError ? "player-hero-btn--error" : "",
          isPlaying && !hasError ? "player-hero-btn--playing" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ width: size, height: size }}
        whileTap={{ scale: 0.97 }}
        transition={pressSpring}
        onClick={onClick}
      >
        <span className="player-hero-ring" aria-hidden />
        <span className="player-hero-core" aria-hidden />
        <span className="player-hero-reflect" aria-hidden />
        <span style={{ position: "relative", zIndex: 3, display: "flex" }}>
          {isPlaying ? (
            <Pause size={iconSize} fill="currentColor" strokeWidth={0} aria-hidden />
          ) : (
            <Play
              size={iconSize}
              fill="currentColor"
              strokeWidth={0}
              style={{ marginLeft: size >= 64 ? 3 : 2 }}
              aria-hidden
            />
          )}
        </span>
      </motion.button>
    </div>
  );
});

export const ClosePlayerButton = memo(function ClosePlayerButton({ onClick, size = 20 }) {
  return (
    <motion.button
      type="button"
      aria-label="Close audio player"
      className="player-close-btn"
      whileTap={{ scale: 0.97 }}
      transition={pressSpring}
      onClick={onClick}
    >
      <span style={{ fontSize: size, lineHeight: 1 }} aria-hidden>
        ×
      </span>
    </motion.button>
  );
});
