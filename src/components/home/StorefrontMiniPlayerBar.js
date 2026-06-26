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

// SVG icon paths — standard playback controls
const ICON_SKIP_PREV = "M6 6h2v12H6zm3.5 6 8.5 6V6z";
const ICON_REWIND = "M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z";
const ICON_FAST_FWD = "M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z";
const ICON_SKIP_NEXT = "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z";
const ICON_PAUSE = "M6 19h4V5H6zm8-14v14h4V5z";
const ICON_PLAY = "M8 5v14l11-7z";
const ICON_SHUFFLE =
  "M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z";

function CtrlBtn({ onClick, title, children, active, size = 30 }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "none",
        border: `1px solid ${active ? "rgba(0,255,255,0.4)" : "rgba(255,255,255,0.1)"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: active ? "#00ffff" : "#777",
        flexShrink: 0,
        padding: 0,
        touchAction: "manipulation",
      }}
    >
      {children}
    </button>
  );
}

function SvgIcon({ path, size = 13, playOffset = false }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size}>
      <path d={path} style={playOffset ? { marginLeft: 2 } : undefined} />
    </svg>
  );
}

const StorefrontMiniPlayerBar = memo(function StorefrontMiniPlayerBar({
  nowPlaying,
  isPlaying,
  onSeekRatio,
  onToggle,
  onDismiss,
  onPlayNext,
  onPlayPrev,
  onSeekForward,
  onSeekBack,
  onToggleShuffle,
  shuffleEnabled,
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
  const ctrlSize = isMobile ? 27 : 30;
  const iconSize = isMobile ? 12 : 13;

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
        <motion.div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <img src={nowPlaying.cover} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
          <motion.div style={{ flex: 1, minWidth: 0 }}>
            <motion.div style={{ fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayTitle}</motion.div>
            <motion.div style={{ fontSize: 10, color: "#555", fontVariantNumeric: "tabular-nums" }}>{timeLabel}</motion.div>
          </motion.div>
          <CtrlBtn onClick={onPlayPrev} title="Previous" size={ctrlSize}>
            <SvgIcon path={ICON_SKIP_PREV} size={iconSize} />
          </CtrlBtn>
          <CtrlBtn onClick={onSeekBack} title="Rewind 15s" size={ctrlSize}>
            <SvgIcon path={ICON_REWIND} size={iconSize} />
          </CtrlBtn>
          <button
            onClick={onToggle}
            style={{ width: 36, height: 36, borderRadius: "50%", background: "#00ffff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, touchAction: "manipulation" }}
          >
            <svg viewBox="0 0 24 24" fill="#000" width="14" height="14">
              <path d={isPlaying ? ICON_PAUSE : ICON_PLAY} style={isPlaying ? undefined : { marginLeft: 2 }} />
            </svg>
          </button>
          <CtrlBtn onClick={onSeekForward} title="Forward 15s" size={ctrlSize}>
            <SvgIcon path={ICON_FAST_FWD} size={iconSize} />
          </CtrlBtn>
          <CtrlBtn onClick={onPlayNext} title="Next" size={ctrlSize}>
            <SvgIcon path={ICON_SKIP_NEXT} size={iconSize} />
          </CtrlBtn>
          <CtrlBtn onClick={onToggleShuffle} title="Shuffle" size={ctrlSize} active={shuffleEnabled}>
            <SvgIcon path={ICON_SHUFFLE} size={iconSize} />
          </CtrlBtn>
          <button onClick={onDismiss} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>×</button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <div style={{ flexShrink: 0, borderTop: "1px solid #141414", background: "rgba(4,4,4,0.97)", backdropFilter: "blur(20px)", zIndex: 1 }}>
      <div onClick={handleSeek} style={{ width: "100%", height: 3, background: "#111", cursor: "pointer", position: "relative" }}>
        <div style={{ width: progressWidth, height: "100%", background: "#00ffff", transition: "width 0.1s linear", boxShadow: "0 0 4px rgba(0,255,255,0.5)" }} />
      </div>
      <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 -4px 30px rgba(0,0,0,0.5)" }}>
        <img src={nowPlaying.cover} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} alt="" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayTitle}</div>
          <div style={{ fontSize: 10, color: "#555", letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>{timeLabel}</div>
        </div>
        <CtrlBtn onClick={onPlayPrev} title="Previous" size={ctrlSize}>
          <SvgIcon path={ICON_SKIP_PREV} size={iconSize} />
        </CtrlBtn>
        <CtrlBtn onClick={onSeekBack} title="Rewind 15s" size={ctrlSize}>
          <SvgIcon path={ICON_REWIND} size={iconSize} />
        </CtrlBtn>
        <button
          onClick={onToggle}
          style={{ width: 36, height: 36, borderRadius: "50%", background: "#00ffff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, touchAction: "manipulation" }}
        >
          <svg viewBox="0 0 24 24" fill="#000" width="14" height="14">
            <path d={isPlaying ? ICON_PAUSE : ICON_PLAY} style={isPlaying ? undefined : { marginLeft: 2 }} />
          </svg>
        </button>
        <CtrlBtn onClick={onSeekForward} title="Forward 15s" size={ctrlSize}>
          <SvgIcon path={ICON_FAST_FWD} size={iconSize} />
        </CtrlBtn>
        <CtrlBtn onClick={onPlayNext} title="Next" size={ctrlSize}>
          <SvgIcon path={ICON_SKIP_NEXT} size={iconSize} />
        </CtrlBtn>
        <CtrlBtn onClick={onToggleShuffle} title="Shuffle" size={ctrlSize} active={shuffleEnabled}>
          <SvgIcon path={ICON_SHUFFLE} size={iconSize} />
        </CtrlBtn>
        <button onClick={onDismiss} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
      </div>
    </div>
  );
});

export default StorefrontMiniPlayerBar;
