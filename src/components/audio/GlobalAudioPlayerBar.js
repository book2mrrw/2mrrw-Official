"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useAudioPlayer } from "@/context/AudioContext";

const formatTime = (seconds) => {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const COVER_GRADIENT = "linear-gradient(135deg, rgba(0,255,255,0.12), rgba(162,89,255,0.12))";

const iconBtn = {
  background: "none",
  border: "none",
  color: "#666",
  cursor: "pointer",
  padding: "4px 6px",
  fontSize: 14,
  lineHeight: 1,
  flexShrink: 0,
};

function CoverArt({ cover, size }) {
  if (cover) {
    return (
      <img
        src={cover}
        alt=""
        style={{ width: size, height: size, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: COVER_GRADIENT,
        border: "1px solid #222",
        flexShrink: 0,
      }}
    />
  );
}

function GlobalAudioPlayerBar() {
  const {
    currentTrack,
    hasStarted,
    isPlaying,
    currentTime,
    duration,
    error,
    toggle,
    seek,
    stop,
    queue,
    queueIndex,
    playNext,
    playPrevious,
    shuffle,
    repeatMode,
    toggleShuffle,
    toggleRepeat,
  } = useAudioPlayer();
  const [isMobile, setIsMobile] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const touchStartY = useRef(null);
  const touchDeltaY = useRef(0);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!hasStarted || !currentTrack) setExpanded(false);
  }, [hasStarted, currentTrack]);

  useEffect(() => {
    if (!expanded) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  const handleSeek = useCallback(
    (event) => {
      if (!duration) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      seek(ratio * duration);
    },
    [duration, seek]
  );

  const onTouchStart = useCallback((e) => {
    touchStartY.current = e.touches[0]?.clientY ?? null;
    touchDeltaY.current = 0;
  }, []);

  const onTouchMove = useCallback((e) => {
    if (touchStartY.current == null) return;
    touchDeltaY.current = (e.touches[0]?.clientY ?? 0) - touchStartY.current;
  }, []);

  const onTouchEnd = useCallback(() => {
    if (touchDeltaY.current > 72) setExpanded(false);
    touchStartY.current = null;
    touchDeltaY.current = 0;
  }, []);

  if (!hasStarted || !currentTrack) return null;

  const progress = duration ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const bottom = isMobile ? "calc(62px + env(safe-area-inset-bottom, 0px) + 8px)" : 0;
  const sourceLabel = String(currentTrack.source || "audio").replace(/_/g, " ");
  const hasQueue = (queue || []).length > 1;
  const queuePos = queueIndex >= 0 && queue?.length ? queueIndex + 1 : 1;
  const queueTotal = queue?.length || 1;
  const queueLabel = hasQueue ? `${queuePos} of ${queueTotal}` : null;

  const playPauseLarge = (
    <button
      type="button"
      onClick={toggle}
      aria-label={isPlaying ? "Pause audio" : "Play audio"}
      style={{
        width: 64,
        height: 64,
        borderRadius: "50%",
        background: error ? "#333" : "#00ffff",
        border: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {isPlaying ? (
        <svg viewBox="0 0 24 24" fill="#000" width="22" height="22">
          <path d="M6 19h4V5H6zm8-14v14h4V5z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill={error ? "#aaa" : "#000"} width="22" height="22" style={{ marginLeft: 3 }}>
          <path d="M8 5v14l11-7z" />
        </svg>
      )}
    </button>
  );

  return (
    <>
      {expanded && (
        <div
          role="dialog"
          aria-label="Full screen audio player"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 8000,
            background: "rgba(4,4,4,0.98)",
            backdropFilter: "blur(28px)",
            WebkitBackdropFilter: "blur(28px)",
            display: "flex",
            flexDirection: "column",
            padding: `max(16px, env(safe-area-inset-top, 0px)) 20px max(24px, env(safe-area-inset-bottom, 0px))`,
            overflowY: "auto",
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Close expanded player"
              style={{
                background: "none",
                border: "none",
                color: "#888",
                fontSize: 28,
                lineHeight: 1,
                cursor: "pointer",
                padding: "4px 8px",
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 24,
              minHeight: 0,
            }}
          >
            <CoverArt cover={currentTrack.cover} size={isMobile ? 300 : 320} />

            <div style={{ textAlign: "center", width: "100%", maxWidth: 400, padding: "0 8px" }}>
              <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, marginBottom: 6 }}>{currentTrack.title}</div>
              <div style={{ fontSize: 14, color: "#888" }}>{currentTrack.artist}</div>
            </div>

            <div style={{ width: "100%", maxWidth: 480 }}>
              <div
                onClick={handleSeek}
                role="slider"
                aria-valuemin={0}
                aria-valuemax={duration || 0}
                aria-valuenow={currentTime}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (!duration) return;
                  if (e.key === "ArrowRight") seek(Math.min(duration, currentTime + 5));
                  if (e.key === "ArrowLeft") seek(Math.max(0, currentTime - 5));
                }}
                style={{
                  width: "100%",
                  height: 6,
                  background: "#222",
                  borderRadius: 3,
                  cursor: duration ? "pointer" : "default",
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    width: `${progress}%`,
                    height: "100%",
                    background: error ? "#ff8a8a" : "#00ffff",
                    borderRadius: 3,
                    transition: "width 0.1s linear",
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "#666",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20 }}>
              {hasQueue && (
                <button type="button" aria-label="Previous track" onClick={() => playPrevious()} style={{ ...iconBtn, fontSize: 22 }}>
                  ⏮
                </button>
              )}
              {playPauseLarge}
              {hasQueue && (
                <button type="button" aria-label="Next track" onClick={() => playNext()} style={{ ...iconBtn, fontSize: 22 }}>
                  ⏭
                </button>
              )}
            </div>

            {hasQueue && (
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <button
                  type="button"
                  aria-label="Shuffle"
                  onClick={() => toggleShuffle()}
                  style={{ ...iconBtn, fontSize: 16, color: shuffle ? "#00ffff" : "#666" }}
                >
                  ⇄ Shuffle
                </button>
                <button
                  type="button"
                  aria-label="Repeat"
                  onClick={() => toggleRepeat()}
                  style={{ ...iconBtn, fontSize: 16, color: repeatMode !== "off" ? "#00ffff" : "#666" }}
                >
                  {repeatMode === "one" ? "①" : "↻"} Repeat
                </button>
              </div>
            )}

            {queueLabel && (
              <div style={{ fontSize: 12, color: "#555", letterSpacing: 1.5, textTransform: "uppercase" }}>{queueLabel}</div>
            )}

            {error && <div style={{ fontSize: 12, color: "#ff8a8a", textAlign: "center" }}>{error}</div>}
          </div>
        </div>
      )}

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
        <div
          onClick={handleSeek}
          style={{ width: "100%", height: 3, background: "#111", cursor: duration ? "pointer" : "default" }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: error ? "#ff8a8a" : "#00ffff",
              transition: "width 0.1s linear",
              boxShadow: error ? "0 0 6px rgba(255,138,138,0.5)" : "0 0 6px rgba(0,255,255,0.5)",
            }}
          />
        </div>
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            padding: isMobile ? "8px 12px" : "10px 20px",
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 8 : 12,
          }}
        >
          {hasQueue && (
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button type="button" aria-label="Previous track" onClick={() => playPrevious()} style={iconBtn}>
                ⏮
              </button>
              <button type="button" aria-label="Next track" onClick={() => playNext()} style={iconBtn}>
                ⏭
              </button>
              <button
                type="button"
                aria-label="Shuffle"
                onClick={() => toggleShuffle()}
                style={{ ...iconBtn, color: shuffle ? "#00ffff" : "#666" }}
              >
                ⇄
              </button>
              <button
                type="button"
                aria-label="Repeat"
                onClick={() => toggleRepeat()}
                style={{ ...iconBtn, color: repeatMode !== "off" ? "#00ffff" : "#666", fontSize: 12 }}
              >
                {repeatMode === "one" ? "①" : "↻"}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Expand player"
            style={{
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 8 : 12,
              flex: 1,
              minWidth: 0,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              textAlign: "left",
              color: "inherit",
            }}
          >
            <CoverArt cover={currentTrack.cover} size={isMobile ? 40 : 38} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {currentTrack.title}
                </div>
                <div style={{ fontSize: 9, color: "#555", letterSpacing: 1.4, textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  {sourceLabel}
                </div>
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: error ? "#ff8a8a" : "#555",
                  letterSpacing: error ? 0.3 : 1,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {error || `${currentTrack.artist} · ${formatTime(currentTime)} / ${formatTime(duration)}`}
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-label={isPlaying ? "Pause audio" : "Play audio"}
            style={{
              width: isMobile ? 38 : 36,
              height: isMobile ? 38 : 36,
              borderRadius: "50%",
              background: error ? "#333" : "#00ffff",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="#000" width="14" height="14">
                <path d="M6 19h4V5H6zm8-14v14h4V5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill={error ? "#aaa" : "#000"} width="14" height="14" style={{ marginLeft: 2 }}>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={stop}
            aria-label="Close audio player"
            style={{
              background: "none",
              border: "none",
              color: "#555",
              cursor: "pointer",
              fontSize: isMobile ? 20 : 18,
              lineHeight: 1,
              padding: "0 4px",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      </div>
    </>
  );
}

export default memo(GlobalAudioPlayerBar);
