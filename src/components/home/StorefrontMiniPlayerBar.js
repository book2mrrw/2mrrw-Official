"use client";

import { memo, useCallback } from "react";
import { motion } from "framer-motion";
import { usePlaybackProgress } from "@/context/AudioContext";
import { resolvePlayerDisplayTitle } from "@/lib/playback/resolve-player-display-title";

const SPRING_SOFT = { type: "spring", stiffness: 280, damping: 32 };

const formatTime = (s) => {
  if (!s || isNaN(s) || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const StorefrontMiniPlayerBar = memo(function StorefrontMiniPlayerBar({
  nowPlaying,
  isPlaying,
  onSeekRatio,
  onToggle,
  onDismiss,
  isMobile,
  bottom,
}) {
  const { currentTime, duration } = usePlaybackProgress();
  const displayTitle = resolvePlayerDisplayTitle(nowPlaying);

  const handleSeek = useCallback(
    (e) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeekRatio(ratio * duration);
    },
    [duration, onSeekRatio]
  );

  const progressWidth = duration ? `${(currentTime / duration) * 100}%` : "0%";
  const timeLabel = `${formatTime(currentTime)} / ${formatTime(duration)}`;

  if (isMobile) {
    return (
      <motion.div
        key="mobile-mini-player"
        initial={{ y: 72, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 72, opacity: 0 }}
        transition={SPRING_SOFT}
        style={{
          position: "fixed",
          left: 12,
          right: 12,
          bottom,
          zIndex: 6750,
          borderRadius: 16,
          overflow: "hidden",
          background: "rgba(10,10,10,0.9)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,255,255,0.05)",
        }}
      >
        <motion.div onClick={handleSeek} style={{ width: "100%", height: 3, background: "#111", cursor: "pointer" }}>
          <motion.div style={{ width: progressWidth, height: "100%", background: "#00ffff", transition: "width 0.1s linear" }} />
        </motion.div>
        <motion.div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <img src={nowPlaying.cover} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
          <motion.div style={{ flex: 1, minWidth: 0 }}>
            <motion.div style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayTitle}</motion.div>
            <motion.div style={{ fontSize: 10, color: "#555", fontVariantNumeric: "tabular-nums" }}>{timeLabel}</motion.div>
          </motion.div>
          <button onClick={onToggle} style={{ width: 38, height: 38, borderRadius: "50%", background: "#00ffff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
            {isPlaying
              ? <svg viewBox="0 0 24 24" fill="#000" width="14" height="14"><path d="M6 19h4V5H6zm8-14v14h4V5z" /></svg>
              : <svg viewBox="0 0 24 24" fill="#000" width="14" height="14" style={{ marginLeft: 2 }}><path d="M8 5v14l11-7z" /></svg>}
          </button>
          <button onClick={onDismiss} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 4px" }}>×</button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <div style={{ flexShrink: 0, borderTop: "1px solid #141414", background: "rgba(4,4,4,0.97)", backdropFilter: "blur(20px)", zIndex: 1 }}>
      <div onClick={handleSeek} style={{ width: "100%", height: 3, background: "#111", cursor: "pointer", position: "relative" }}>
        <div style={{ width: progressWidth, height: "100%", background: "#00ffff", transition: "width 0.1s linear", boxShadow: "0 0 4px rgba(0,255,255,0.5)" }} />
      </div>
      <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 -4px 30px rgba(0,0,0,0.5)" }}>
        <img src={nowPlaying.cover} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} alt="" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayTitle}</div>
          <div style={{ fontSize: 10, color: "#555", letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>{timeLabel}</div>
        </div>
        <button onClick={onToggle} style={{ width: 36, height: 36, borderRadius: "50%", background: "#00ffff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          {isPlaying
            ? <svg viewBox="0 0 24 24" fill="#000" width="14" height="14"><path d="M6 19h4V5H6zm8-14v14h4V5z" /></svg>
            : <svg viewBox="0 0 24 24" fill="#000" width="14" height="14" style={{ marginLeft: 2 }}><path d="M8 5v14l11-7z" /></svg>}
        </button>
        <button onClick={onDismiss} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
    </div>
  );
});

export default StorefrontMiniPlayerBar;
