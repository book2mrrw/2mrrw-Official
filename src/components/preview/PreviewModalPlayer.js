"use client";

import { memo, useCallback } from "react";
import { useImmersivePlayback } from "@/lib/player/useImmersivePlayback";

const formatTime = (s) => {
  if (!s || isNaN(s) || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

function PreviewModalPlayer({ compact }) {
  const {
    isPlaying,
    currentTime,
    duration,
    error,
    streamRetryable,
    handlePlayToggle,
    seek,
    retryStreamPlayback,
  } = useImmersivePlayback();

  const seekTo = useCallback(
    (e) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seek(ratio * duration);
    },
    [duration, seek]
  );

  const togglePlay = useCallback(() => {
    if (streamRetryable && error) {
      void retryStreamPlayback();
      return;
    }
    handlePlayToggle();
  }, [error, handlePlayToggle, retryStreamPlayback, streamRetryable]);

  const btnSize = compact ? 40 : 44;

  return (
    <div style={{ width: "100%" }}>
      <div
        onClick={seekTo}
        style={{
          width: "100%",
          height: 4,
          background: "#1e1e1e",
          borderRadius: 3,
          cursor: "pointer",
          marginBottom: compact ? 6 : 8,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "#00ffff",
            borderRadius: 3,
            transform: duration ? `scaleX(${currentTime / duration})` : "scaleX(0)",
            transformOrigin: "left",
            transition: "transform 0.1s linear",
            boxShadow: "0 0 6px rgba(0,255,255,0.5)",
          }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 10, color: "#555", fontVariantNumeric: "tabular-nums", minWidth: 32 }}>
          {formatTime(currentTime)}
        </span>
        <button
          type="button"
          onClick={togglePlay}
          style={{
            width: btnSize,
            height: btnSize,
            borderRadius: "50%",
            background: "#00ffff",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
            boxShadow: "0 0 16px rgba(0,255,255,0.4)",
          }}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" fill="#000" width="16" height="16">
              <path d="M6 19h4V5H6zm8-14v14h4V5z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="#000" width="16" height="16" style={{ marginLeft: 2 }}>
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <span
          style={{
            fontSize: 10,
            color: "#555",
            fontVariantNumeric: "tabular-nums",
            minWidth: 32,
            textAlign: "right",
          }}
        >
          {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

export default memo(PreviewModalPlayer);
