"use client";

import { memo } from "react";
import { motion } from "framer-motion";

const pressSpring = { type: "spring", stiffness: 520, damping: 28, mass: 0.55 };

function PlayIcon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5L8 5.5z" />
    </svg>
  );
}

function PauseIcon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

/**
 * Signature glass play control with animated progress ring + subtle visualizer.
 */
function SignaturePlayRing({
  isPlaying = false,
  hasError = false,
  isBuffering = false,
  progress = 0,
  size = 56,
  onClick,
  className = "",
  layoutId,
  "aria-label": ariaLabel,
}) {
  const stroke = Math.max(2, Math.round(size * 0.04));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;
  const iconSize = Math.round(size * 0.34);
  const ringClass = [
    "player-signature-ring",
    isPlaying && !hasError ? "player-signature-ring--playing" : "",
    hasError ? "player-signature-ring--error" : "",
    isBuffering ? "player-signature-ring--buffering" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="player-signature-wrap" style={{ width: size, height: size }}>
      <div
        className={`player-signature-bloom${isPlaying && !hasError ? " is-active" : ""}`}
        aria-hidden
      />
      <motion.button
        type="button"
        layoutId={layoutId}
        aria-label={ariaLabel || (isPlaying ? "Pause" : "Play")}
        className={ringClass}
        style={{ width: size, height: size }}
        whileTap={{ scale: 0.94 }}
        transition={pressSpring}
        onClick={onClick}
      >
        <svg
          className="player-signature-ring__svg"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden
        >
          <circle
            className="player-signature-ring__track"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
          />
          <circle
            className="player-signature-ring__progress"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeDasharray={circumference}
            strokeDashoffset={hasError ? circumference : offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className="player-signature-ring__glass" aria-hidden />
        <span className="player-signature-ring__viz" aria-hidden>
          <span />
          <span />
          <span />
          <span />
          <span />
        </span>
        <span className="player-signature-ring__icon">
          {hasError ? (
            <svg className="player-signature-ring__retry-hint" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5" />
              <path d="M16 5h4V1M8 19H4v4" />
            </svg>
          ) : isPlaying ? (
            <PauseIcon size={iconSize} />
          ) : (
            <PlayIcon size={iconSize} />
          )}
        </span>
        {isBuffering ? <span className="player-signature-ring__buffer" aria-hidden /> : null}
      </motion.button>
    </div>
  );
}

export default memo(SignaturePlayRing);
