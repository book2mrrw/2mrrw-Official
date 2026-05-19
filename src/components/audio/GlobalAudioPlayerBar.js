"use client";

import { memo, useEffect, useState } from "react";
import { useAudioPlayer } from "@/context/AudioContext";

const formatTime = (seconds) => {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

function GlobalAudioPlayerBar() {
  const { currentTrack, hasStarted, isPlaying, currentTime, duration, error, toggle, seek, stop } = useAudioPlayer();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (!hasStarted || !currentTrack) return null;

  const progress = duration ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const bottom = isMobile ? "calc(62px + env(safe-area-inset-bottom, 0px) + 8px)" : 0;
  const sourceLabel = String(currentTrack.source || "audio").replace(/_/g, " ");

  const handleSeek = (event) => {
    if (!duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    seek(ratio * duration);
  };

  return (
    <div
      role="region"
      aria-label="Global audio player"
      style={{
        position: "fixed",
        left: isMobile ? 12 : 0,
        right: isMobile ? 12 : 0,
        bottom,
        zIndex: 7600,
        borderRadius: isMobile ? 16 : 0,
        overflow: "hidden",
        background: "rgba(4,4,4,0.96)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        border: isMobile ? "1px solid rgba(255,255,255,0.08)" : undefined,
        boxShadow: "0 -8px 34px rgba(0,0,0,0.62),0 0 26px rgba(0,255,255,0.06)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
      }}
    >
      <div onClick={handleSeek} style={{ width: "100%", height: 3, background: "#111", cursor: duration ? "pointer" : "default" }}>
        <div style={{ width: `${progress}%`, height: "100%", background: error ? "#ff8a8a" : "#00ffff", transition: "width 0.1s linear", boxShadow: error ? "0 0 6px rgba(255,138,138,0.5)" : "0 0 6px rgba(0,255,255,0.5)" }} />
      </div>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: isMobile ? "8px 12px" : "10px 20px", display: "flex", alignItems: "center", gap: isMobile ? 10 : 14 }}>
        {currentTrack.cover ? (
          <img src={currentTrack.cover} alt="" style={{ width: isMobile ? 40 : 38, height: isMobile ? 40 : 38, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <div style={{ width: isMobile ? 40 : 38, height: isMobile ? 40 : 38, borderRadius: 8, background: "linear-gradient(135deg,rgba(0,255,255,0.12),rgba(162,89,255,0.12))", border: "1px solid #222", flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentTrack.title}</div>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: 1.4, textTransform: "uppercase", whiteSpace: "nowrap" }}>{sourceLabel}</div>
          </div>
          <div style={{ fontSize: 10, color: error ? "#ff8a8a" : "#555", letterSpacing: error ? 0.3 : 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {error || `${currentTrack.artist} · ${formatTime(currentTime)} / ${formatTime(duration)}`}
          </div>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? "Pause audio" : "Play audio"}
          style={{ width: isMobile ? 38 : 36, height: isMobile ? 38 : 36, borderRadius: "50%", background: error ? "#333" : "#00ffff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
        >
          {isPlaying
            ? <svg viewBox="0 0 24 24" fill="#000" width="14" height="14"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
            : <svg viewBox="0 0 24 24" fill={error ? "#aaa" : "#000"} width="14" height="14" style={{ marginLeft: 2 }}><path d="M8 5v14l11-7z"/></svg>}
        </button>
        <button type="button" onClick={stop} aria-label="Close audio player" style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: isMobile ? 20 : 18, lineHeight: 1, padding: "0 4px", flexShrink: 0 }}>×</button>
      </div>
    </div>
  );
}

export default memo(GlobalAudioPlayerBar);
