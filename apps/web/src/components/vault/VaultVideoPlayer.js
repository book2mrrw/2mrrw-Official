"use client";

/**
 * VaultVideoPlayer — Netflix-class full-screen overlay player for vault video content.
 *
 * Architecture:
 *   1. Tries HLS first: GET /api/vault/video/manifest?slug={contentSlug}
 *      - 200 → HLSVideoEngine attaches hls.js; encrypted segments from CDN
 *      - 404 → falls back to content_url (direct MP4 progressive download)
 *   2. VRM: registers at PRIORITY_SYSTEM — vault video takes priority over all artwork
 *   3. Progress: saved every 10 s to /api/vault/progress; also saved on close
 *   4. Portal: renders into document.body to escape any scroll container
 *
 * Opening the player also pauses the audio player (onPauseAudio prop).
 * Keyboard: Space=play/pause, ←/→=±10 s, F=fullscreen, Esc=close.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HLSVideoEngine } from "@/lib/hls/HLSVideoEngine";
import { VRM } from "@/lib/media/video-resource-manager";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function getBufferedRanges(el) {
  if (!el?.buffered) return [];
  const ranges = [];
  const dur = el.duration || 1;
  for (let i = 0; i < el.buffered.length; i++) {
    ranges.push({
      left:  (el.buffered.start(i) / dur) * 100,
      width: ((el.buffered.end(i) - el.buffered.start(i)) / dur) * 100,
    });
  }
  return ranges;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROGRESS_SAVE_INTERVAL_S = 10;
const CONTROLS_AUTOHIDE_MS     = 3000;

// ── Seek bar (pointer events for unified mouse + touch) ───────────────────────

function SeekBar({ currentTime, duration, buffered, onSeek }) {
  const barRef = useRef(null);
  const dragging = useRef(false);

  const getTimeFromPointer = (e) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || !duration) return 0;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return frac * duration;
  };

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    onSeek(getTimeFromPointer(e));
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    onSeek(getTimeFromPointer(e));
  };
  const onPointerUp = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    onSeek(getTimeFromPointer(e));
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={barRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: "relative",
        height: 20,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        userSelect: "none",
        touchAction: "none",
        flex: 1,
        padding: "0 2px",
      }}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Math.floor(currentTime)}
      aria-label="Seek"
    >
      {/* Track */}
      <div style={{ position: "absolute", left: 2, right: 2, height: 3, background: "rgba(255,255,255,0.2)", borderRadius: 2 }}>
        {/* Buffered ranges */}
        {buffered.map((r, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${r.left}%`,
            width: `${r.width}%`,
            height: "100%",
            background: "rgba(255,255,255,0.35)",
            borderRadius: 2,
          }} />
        ))}
        {/* Progress */}
        <div style={{
          position: "absolute",
          left: 0,
          width: `${progress}%`,
          height: "100%",
          background: "#a259ff",
          borderRadius: 2,
        }} />
        {/* Thumb */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: `${progress}%`,
          transform: "translate(-50%, -50%)",
          width: 12,
          height: 12,
          background: "#fff",
          borderRadius: "50%",
          boxShadow: "0 0 4px rgba(0,0,0,0.6)",
          transition: dragging.current ? "none" : "left 0.1s linear",
        }} />
      </div>
    </div>
  );
}

// ── Icon components (SVG, no external deps) ───────────────────────────────────

const IconPlay = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5,3 19,12 5,21" />
  </svg>
);

const IconPause = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

const IconVolume = ({ muted }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    {muted ? (
      <>
        <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
        <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="2" />
        <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" strokeWidth="2" />
      </>
    ) : (
      <>
        <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
  </svg>
);

const IconFullscreen = ({ active }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {active ? (
      <>
        <polyline points="8,3 3,3 3,8" /><line x1="10" y1="14" x2="3" y2="21" />
        <polyline points="16,21 21,21 21,16" /><line x1="14" y1="10" x2="21" y2="3" />
      </>
    ) : (
      <>
        <polyline points="15,3 21,3 21,9" /><line x1="10" y1="14" x2="21" y2="3" />
        <polyline points="9,21 3,21 3,15" /><line x1="14" y1="10" x2="3" y2="21" />
      </>
    )}
  </svg>
);

// ── Main player component ─────────────────────────────────────────────────────

/**
 * @param {{
 *   contentSlug: string,
 *   contentId?: string,
 *   title?: string,
 *   coverUrl?: string,
 *   fallbackUrl?: string,
 *   savedPositionSeconds?: number,
 *   onClose: () => void,
 *   onPauseAudio?: () => void,
 * }} props
 */
export function VaultVideoPlayer({
  contentSlug,
  contentId,
  title,
  coverUrl,
  fallbackUrl,
  savedPositionSeconds = 0,
  onClose,
  onPauseAudio,
}) {
  const videoRef    = useRef(null);
  const engineRef   = useRef(null);
  const containerRef = useRef(null);

  const [isPlaying, setIsPlaying]   = useState(false);
  const [isLoading, setIsLoading]   = useState(true);
  const [hasError, setHasError]     = useState(false);
  const [currentTime, setCurrentTime] = useState(savedPositionSeconds);
  const [duration, setDuration]     = useState(0);
  const [buffered, setBuffered]     = useState([]);
  const [volume, setVolume]         = useState(1);
  const [muted, setMuted]           = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [usingHLS, setUsingHLS]     = useState(false);

  const controlsTimerRef = useRef(null);
  const lastSavedPosRef  = useRef(savedPositionSeconds);
  const isMountedRef     = useRef(true);

  // ── Controls auto-hide ────────────────────────────────────────────────────

  const showControls = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (isMountedRef.current && isPlaying) setControlsVisible(false);
    }, CONTROLS_AUTOHIDE_MS);
  }, [isPlaying]);

  // Keep controls visible when paused
  useEffect(() => {
    if (!isPlaying) setControlsVisible(true);
  }, [isPlaying]);

  // ── Progress persistence ──────────────────────────────────────────────────

  const saveProgress = useCallback(async (pos, completed = false) => {
    if (!contentId && !contentSlug) return;
    if (Math.abs(pos - lastSavedPosRef.current) < 1 && !completed) return;
    lastSavedPosRef.current = pos;
    try {
      await fetch("/api/vault/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentId: contentId || undefined,
          slug: contentSlug,
          positionSeconds: Math.floor(pos),
          completed,
          deviceLabel: "web",
        }),
      });
    } catch {
      // Progress save is best-effort — never interrupt playback
    }
  }, [contentId, contentSlug]);

  // ── Video element event listeners + VRM ─────────────────────────────────

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    VRM.register(el, VRM.PRIORITY_SYSTEM);

    const onPlay     = () => { if (isMountedRef.current) setIsPlaying(true); setIsLoading(false); };
    const onPause    = () => { if (isMountedRef.current) setIsPlaying(false); };
    const onWaiting  = () => { if (isMountedRef.current) setIsLoading(true); };
    const onPlaying  = () => { if (isMountedRef.current) setIsLoading(false); };
    const onCanPlay  = () => { if (isMountedRef.current) setIsLoading(false); };
    const onDuration = () => { if (isMountedRef.current && el.duration) setDuration(el.duration); };
    const onError    = () => { if (isMountedRef.current) { setHasError(true); setIsLoading(false); } };
    const onEnded    = () => {
      if (!isMountedRef.current) return;
      setIsPlaying(false);
      saveProgress(el.currentTime, true);
    };

    let lastSaveTs = 0;
    const onTimeUpdate = () => {
      if (!isMountedRef.current) return;
      setCurrentTime(el.currentTime);
      setBuffered(getBufferedRanges(el));
      if (el.currentTime - lastSaveTs >= PROGRESS_SAVE_INTERVAL_S) {
        lastSaveTs = el.currentTime;
        saveProgress(el.currentTime);
      }
    };

    const onFullscreenChange = () => {
      if (isMountedRef.current) {
        setIsFullscreen(Boolean(document.fullscreenElement));
      }
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("durationchange", onDuration);
    el.addEventListener("error", onError);
    el.addEventListener("ended", onEnded);
    el.addEventListener("timeupdate", onTimeUpdate);
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      isMountedRef.current = false;
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("durationchange", onDuration);
      el.removeEventListener("error", onError);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("timeupdate", onTimeUpdate);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      VRM.requestPause(el);
      VRM.unregister(el);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── HLS engine lifecycle ─────────────────────────────────────────────────

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !contentSlug) return;

    // Pause audio player so vault video isn't competing with music
    onPauseAudio?.();

    el.volume = volume;
    el.muted  = muted;
    el.currentTime = savedPositionSeconds;

    const engine = new HLSVideoEngine();
    engineRef.current = engine;

    engine.onFallback = () => {
      // HLS manifest not available — fall back to direct progressive download
      if (fallbackUrl) {
        el.src = fallbackUrl;
        el.currentTime = savedPositionSeconds;
        el.load();
        VRM.requestPlay(el, () => el.play().catch(() => {}), () => { if (!el.paused) el.pause(); });
      } else {
        if (isMountedRef.current) { setHasError(true); setIsLoading(false); }
      }
    };

    engine.onError = (err) => {
      console.error("[VaultVideoPlayer] HLS error", err);
      if (isMountedRef.current) { setHasError(true); setIsLoading(false); }
    };

    engine.onSegmentFatalError = () => {
      if (isMountedRef.current) { setHasError(true); setIsLoading(false); }
    };

    engine.onDurationKnown = (sec) => {
      if (isMountedRef.current && sec > 0) setDuration(sec);
    };

    const manifestUrl = `/api/vault/video/manifest?slug=${encodeURIComponent(contentSlug)}`;

    engine.loadContent(manifestUrl, el, { startPosition: savedPositionSeconds })
      .then((hlsLoaded) => {
        if (!isMountedRef.current) return;
        if (hlsLoaded) {
          setUsingHLS(true);
          VRM.requestPlay(el,
            () => { if (isMountedRef.current) el.play().catch(() => {}); },
            () => { if (!el.paused) el.pause(); }
          );
        }
        // onFallback handles the !hlsLoaded case
      })
      .catch((err) => {
        console.error("[VaultVideoPlayer] loadContent threw", err);
        if (isMountedRef.current) { setHasError(true); setIsLoading(false); }
      });

    return () => {
      engine.destroy();
      engineRef.current = null;
      // Save position on unmount
      if (el.currentTime > 1) saveProgress(el.currentTime);
      el.pause();
      el.removeAttribute("src");
      el.load();
    };
  }, [contentSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      const el = videoRef.current;
      if (!el) return;
      switch (e.key) {
        case " ": case "k":
          e.preventDefault();
          el.paused ? el.play().catch(() => {}) : el.pause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          el.currentTime = Math.max(0, el.currentTime - 10);
          if (engineRef.current?.isLoaded) engineRef.current.seekTo(el.currentTime);
          showControls();
          break;
        case "ArrowRight":
          e.preventDefault();
          el.currentTime = Math.min(el.duration || Infinity, el.currentTime + 10);
          if (engineRef.current?.isLoaded) engineRef.current.seekTo(el.currentTime);
          showControls();
          break;
        case "f": case "F":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "m": case "M":
          e.preventDefault();
          toggleMute();
          break;
        case "Escape":
          if (!isFullscreen) onClose();
          break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen, showControls, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll lock while open ───────────────────────────────────────────────

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ── Cleanup timer ────────────────────────────────────────────────────────

  useEffect(() => () => clearTimeout(controlsTimerRef.current), []);

  // ── Controls ─────────────────────────────────────────────────────────────

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    el.paused ? el.play().catch(() => {}) : el.pause();
    showControls();
  };

  const handleSeek = (sec) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = sec;
    setCurrentTime(sec);
    if (engineRef.current?.isLoaded) engineRef.current.seekTo(sec);
  };

  const toggleMute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const handleVolume = (e) => {
    const el = videoRef.current;
    if (!el) return;
    const vol = parseFloat(e.target.value);
    el.volume = vol;
    el.muted  = vol === 0;
    setVolume(vol);
    setMuted(vol === 0);
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      container.requestFullscreen().catch(() => {});
    }
  };

  const handleClose = () => {
    const el = videoRef.current;
    if (el && el.currentTime > 1) saveProgress(el.currentTime);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {}).finally(() => onClose());
    } else {
      onClose();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (typeof window === "undefined") return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
      }}
      onMouseMove={showControls}
      onPointerDown={showControls}
    >
      {/* Video container */}
      <div
        ref={containerRef}
        style={{ position: "relative", flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
        onDoubleClick={toggleFullscreen}
      >
        {/* Cover image shown while loading */}
        {(isLoading && coverUrl) ? (
          <img
            src={coverUrl}
            alt=""
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "contain", opacity: 0.35, filter: "blur(4px)",
            }}
          />
        ) : null}

        {/* Video element */}
        <video
          ref={videoRef}
          playsInline
          style={{
            width: "100%", height: "100%",
            objectFit: "contain",
            display: "block",
            background: "#000",
          }}
        />

        {/* Loading spinner */}
        {isLoading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.15)",
              borderTopColor: "#a259ff",
              animation: "vvp-spin 0.8s linear infinite",
            }} />
          </div>
        )}

        {/* Error state */}
        {hasError && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
          }}>
            <span style={{ fontSize: 36, opacity: 0.4 }}>⚠</span>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 14 }}>Video unavailable</span>
          </div>
        )}

        {/* Big play button when paused and not loading */}
        {!isPlaying && !isLoading && !hasError && (
          <button
            type="button"
            onClick={togglePlay}
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              background: "transparent", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            aria-label="Play"
          >
            <div style={{
              width: 72, height: 72, borderRadius: "50%",
              background: "rgba(162,89,255,0.85)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 32px rgba(162,89,255,0.5)",
              backdropFilter: "blur(4px)",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff">
                <polygon points="6,3 20,12 6,21" />
              </svg>
            </div>
          </button>
        )}

        {/* Top bar: title + close */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          padding: "16px 20px",
          background: "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          opacity: controlsVisible ? 1 : 0,
          transition: "opacity 0.3s",
          pointerEvents: controlsVisible ? "auto" : "none",
        }}>
          {title ? (
            <span style={{
              color: "#fff", fontSize: 14, fontWeight: 700,
              letterSpacing: 0.5, textShadow: "0 1px 4px rgba(0,0,0,0.8)",
              maxWidth: "70%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{title}</span>
          ) : <span />}
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            style={{
              background: "rgba(0,0,0,0.45)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "50%",
              width: 36, height: 36,
              cursor: "pointer", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, fontWeight: 300, lineHeight: 1,
            }}
          >✕</button>
        </div>
      </div>

      {/* Bottom controls bar */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        padding: "0 16px max(16px, env(safe-area-inset-bottom)) 16px",
        background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)",
        opacity: controlsVisible ? 1 : 0,
        transition: "opacity 0.3s",
        pointerEvents: controlsVisible ? "auto" : "none",
      }}>
        {/* Seek bar */}
        <div style={{ marginBottom: 8, padding: "4px 0" }}>
          <SeekBar
            currentTime={currentTime}
            duration={duration}
            buffered={buffered}
            onSeek={handleSeek}
          />
        </div>

        {/* Controls row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Play/Pause */}
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 4, lineHeight: 0 }}
          >
            {isPlaying ? <IconPause /> : <IconPlay />}
          </button>

          {/* Time display */}
          <span style={{
            color: "rgba(255,255,255,0.85)", fontSize: 12,
            fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
            fontFamily: "ui-monospace, monospace",
          }}>
            {formatTime(currentTime)}{duration > 0 ? ` / ${formatTime(duration)}` : ""}
          </span>

          {/* Flex spacer */}
          <div style={{ flex: 1 }} />

          {/* Volume */}
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 4, lineHeight: 0 }}
          >
            <IconVolume muted={muted} />
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={handleVolume}
            aria-label="Volume"
            style={{ width: 80, accentColor: "#a259ff", cursor: "pointer" }}
          />

          {/* Fullscreen */}
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 4, lineHeight: 0 }}
          >
            <IconFullscreen active={isFullscreen} />
          </button>
        </div>

        {/* Stream quality indicator (dev) */}
        {usingHLS && process.env.NODE_ENV === "development" && (
          <div style={{ position: "absolute", top: -20, right: 16, fontSize: 10, color: "rgba(162,89,255,0.8)", fontFamily: "monospace" }}>
            HLS
          </div>
        )}
      </div>

      {/* Spinner keyframe */}
      <style>{`
        @keyframes vvp-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>,
    document.body
  );
}
