"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";
import CSModeButton from "@/components/audio/CSModeButton";
import {
  ClosePlayerButton,
  HoldSeekButton,
  PlayPauseHero,
  RepeatButton,
  ShuffleButton,
  TrackTransportButton,
} from "@/components/audio/PlayerControlButton";
import CoverArt from "@/components/ui/CoverArt";
import CoverArtCS from "@/components/ui/CoverArtCS";

const formatTime = (seconds) => {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const DOUBLE_TAP_MS = 300;
const HOLD_FADE_MS = 300;
const RELEASE_FADE_MS = 200;
const MOVE_CANCEL_PX = 10;
const CS_PLAYBACK_RATE = 0.75;

function WaveformBars({ playing }) {
  return (
    <div className={`audio-island-waveform${playing ? " is-playing" : ""}`} aria-hidden>
      <span />
      <span />
      <span />
    </div>
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
    csMode,
    toggleCSMode,
    seekBack,
    seekForward,
    audioRef,
    suppressPauseInterruptionRef,
  } = useAudioPlayer();
  const [isMobile, setIsMobile] = useState(false);
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 768
  );
  const [expanded, setExpanded] = useState(false);
  const [ambientCoverUrl, setAmbientCoverUrl] = useState(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeClosing, setSwipeClosing] = useState(false);
  const [csHoldOpacity, setCsHoldOpacity] = useState(0);
  const [flipPhase, setFlipPhase] = useState(false);
  const touchStartY = useRef(null);
  const touchDeltaY = useRef(0);
  const lastTapTimeRef = useRef(0);
  const holdRafRef = useRef(null);
  const holdActiveRef = useRef(false);
  const previewActiveRef = useRef(false);
  const savedAudioRef = useRef(null);
  const touchMovedRef = useRef(false);
  const touchStartRef = useRef(null);
  const tapTimeoutRef = useRef(null);
  const csModeRef = useRef(csMode);

  useEffect(() => {
    csModeRef.current = csMode;
    if (csMode) {
      setCsHoldOpacity(0);
      holdActiveRef.current = false;
      previewActiveRef.current = false;
    }
  }, [csMode]);

  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      setWindowWidth(w);
      setIsMobile(w < 768);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const isSmallScreen = windowWidth < 360;

  useEffect(() => {
    if (!hasStarted || !currentTrack) {
      setExpanded(false);
      setSwipeOffset(0);
    }
  }, [hasStarted, currentTrack]);

  useEffect(() => {
    if (!expanded) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  useEffect(
    () => () => {
      if (holdRafRef.current) cancelAnimationFrame(holdRafRef.current);
      if (tapTimeoutRef.current) window.clearTimeout(tapTimeoutRef.current);
    },
    []
  );

  const baseCover = currentTrack?.baseCover || currentTrack?.cover;
  const csCover = currentTrack?.csCover || null;
  const csAudio = currentTrack?.csAudio || null;
  const baseCoverType = currentTrack?.coverArtType || "image";
  const csCoverType = currentTrack?.csCoverType || "image";
  const hasCs = Boolean(csCover || csAudio);
  const coverFlipKey = currentTrack
    ? `${currentTrack.id || currentTrack.slug}:${baseCover}:${currentTrack.title}:${csMode}`
    : null;

  useEffect(() => {
    if (!coverFlipKey) return undefined;
    setFlipPhase(true);
    const t = window.setTimeout(() => setFlipPhase(false), 200);
    return () => window.clearTimeout(t);
  }, [coverFlipKey]);

  useEffect(() => {
    if (!currentTrack) return;
    const ambient = csMode && csCover ? csCover : baseCover;
    if (ambient) setAmbientCoverUrl(resolveAbsoluteArtworkUrl(ambient));
  }, [baseCover, csCover, csMode, currentTrack]);

  const cancelHoldAnim = useCallback(() => {
    if (holdRafRef.current) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
  }, []);

  const markProgrammaticPause = useCallback(() => {
    if (suppressPauseInterruptionRef) suppressPauseInterruptionRef.current = true;
  }, [suppressPauseInterruptionRef]);

  const applyHoldAudio = useCallback(
    (progress) => {
      const audio = audioRef?.current;
      if (!audio || csModeRef.current) return;

      if (csAudio) {
        if (!previewActiveRef.current) {
          savedAudioRef.current = {
            src: audio.currentSrc || audio.src,
            currentTime: audio.currentTime,
            playbackRate: audio.playbackRate,
            wasPlaying: !audio.paused,
          };
          markProgrammaticPause();
          audio.pause();
          audio.src = csAudio;
          audio.load();
          const seekTo = savedAudioRef.current.currentTime;
          const applySeek = () => {
            if (seekTo > 0 && isFinite(audio.duration)) {
              audio.currentTime = Math.min(seekTo, Math.max(0, audio.duration - 0.25));
            }
            audio.removeEventListener("loadedmetadata", applySeek);
          };
          audio.addEventListener("loadedmetadata", applySeek);
          if (isFinite(audio.duration) && audio.duration > 0) applySeek();
          audio.playbackRate = 1;
          if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
          if (savedAudioRef.current.wasPlaying) audio.play().catch(() => {});
          previewActiveRef.current = true;
        }
      } else {
        audio.playbackRate = 1 - (1 - CS_PLAYBACK_RATE) * progress;
        if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
      }
    },
    [audioRef, csAudio, markProgrammaticPause]
  );

  const revertHoldPreview = useCallback(() => {
    const audio = audioRef?.current;
    if (!audio || csModeRef.current) return;

    cancelHoldAnim();
    holdActiveRef.current = false;

    const saved = savedAudioRef.current;
    if (previewActiveRef.current && saved) {
      const currentUrl = audio.currentSrc || audio.src;
      const savedUrl = saved.src ? new URL(saved.src, window.location.href).href : "";
      const needsSwap = csAudio && savedUrl && currentUrl !== savedUrl;
      if (needsSwap) {
        markProgrammaticPause();
        audio.pause();
        audio.src = saved.src;
        audio.load();
        const seekTo = saved.currentTime;
        const applySeek = () => {
          if (seekTo > 0 && isFinite(audio.duration)) {
            audio.currentTime = Math.min(seekTo, Math.max(0, audio.duration - 0.25));
          }
          audio.removeEventListener("loadedmetadata", applySeek);
        };
        audio.addEventListener("loadedmetadata", applySeek);
      } else if (saved.currentTime > 0) {
        audio.currentTime = saved.currentTime;
      }
      audio.playbackRate = saved.playbackRate ?? 1;
      if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
      if (saved.wasPlaying && audio.paused) audio.play().catch(() => {});
    } else if (audio) {
      audio.playbackRate = 1;
      if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
    }

    previewActiveRef.current = false;
    savedAudioRef.current = null;
  }, [audioRef, cancelHoldAnim, csAudio, markProgrammaticPause]);

  const animateHoldOpacity = useCallback(
    (from, to, duration, onFrame, onComplete) => {
      cancelHoldAnim();
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        const value = from + (to - from) * progress;
        setCsHoldOpacity(value);
        onFrame?.(value, progress);
        if (progress < 1) {
          holdRafRef.current = requestAnimationFrame(step);
        } else {
          holdRafRef.current = null;
          onComplete?.();
        }
      };
      holdRafRef.current = requestAnimationFrame(step);
    },
    [cancelHoldAnim]
  );

  const handleCoverTouchStart = useCallback(
    (e, onSingleTap) => {
      e.stopPropagation();
      touchMovedRef.current = false;
      touchStartRef.current = { x: e.touches[0]?.clientX ?? 0, y: e.touches[0]?.clientY ?? 0 };

      const now = Date.now();
      const sinceLast = now - lastTapTimeRef.current;
      if (sinceLast < DOUBLE_TAP_MS && lastTapTimeRef.current > 0 && hasCs) {
        window.clearTimeout(tapTimeoutRef.current);
        lastTapTimeRef.current = 0;
        cancelHoldAnim();
        revertHoldPreview();
        setCsHoldOpacity(0);
        void toggleCSMode?.();
        return;
      }
      lastTapTimeRef.current = now;

      if (!hasCs || csModeRef.current) {
        if (onSingleTap) {
          tapTimeoutRef.current = window.setTimeout(() => {
            onSingleTap();
            lastTapTimeRef.current = 0;
          }, DOUBLE_TAP_MS);
        }
        return;
      }

      holdActiveRef.current = true;
      animateHoldOpacity(0, 1, HOLD_FADE_MS, (value, progress) => {
        applyHoldAudio(progress);
        if (csCover) setAmbientCoverUrl(resolveAbsoluteArtworkUrl(csCover));
      });
    },
    [
      animateHoldOpacity,
      applyHoldAudio,
      cancelHoldAnim,
      csCover,
      hasCs,
      revertHoldPreview,
      toggleCSMode,
    ]
  );

  const handleCoverTouchMove = useCallback(
    (e) => {
      if (!touchStartRef.current) return;
      const dx = (e.touches[0]?.clientX ?? 0) - touchStartRef.current.x;
      const dy = (e.touches[0]?.clientY ?? 0) - touchStartRef.current.y;
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        touchMovedRef.current = true;
        if (holdActiveRef.current && !csModeRef.current) {
          animateHoldOpacity(csHoldOpacity, 0, RELEASE_FADE_MS, null, () => {
            revertHoldPreview();
            if (baseCover) setAmbientCoverUrl(resolveAbsoluteArtworkUrl(baseCover));
          });
        }
      }
    },
    [animateHoldOpacity, baseCover, csHoldOpacity, revertHoldPreview]
  );

  const handleCoverTouchEnd = useCallback(
    (e, onSingleTap) => {
      e.preventDefault();
      e.stopPropagation();

      if (touchMovedRef.current) {
        touchStartRef.current = null;
        return;
      }

      if (csModeRef.current) {
        touchStartRef.current = null;
        return;
      }

      if (holdActiveRef.current) {
        animateHoldOpacity(csHoldOpacity, 0, RELEASE_FADE_MS, null, () => {
          revertHoldPreview();
          if (baseCover) setAmbientCoverUrl(resolveAbsoluteArtworkUrl(baseCover));
        });
        touchStartRef.current = null;
        return;
      }

      if (onSingleTap) {
        tapTimeoutRef.current = window.setTimeout(() => {
          onSingleTap();
          lastTapTimeRef.current = 0;
        }, DOUBLE_TAP_MS);
      }

      touchStartRef.current = null;
    },
    [animateHoldOpacity, baseCover, csHoldOpacity, revertHoldPreview]
  );

  const handleSeek = useCallback(
    (event) => {
      if (!duration) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      seek(ratio * duration);
    },
    [duration, seek]
  );

  const closeExpanded = useCallback(() => {
    setSwipeClosing(true);
    setSwipeOffset(120);
    window.setTimeout(() => {
      setExpanded(false);
      setSwipeClosing(false);
      setSwipeOffset(0);
    }, 220);
  }, []);

  const onTouchStart = useCallback((e) => {
    touchStartY.current = e.touches[0]?.clientY ?? null;
    touchDeltaY.current = 0;
    setSwipeOffset(0);
  }, []);

  const onTouchMove = useCallback((e) => {
    if (touchStartY.current == null) return;
    const delta = (e.touches[0]?.clientY ?? 0) - touchStartY.current;
    touchDeltaY.current = delta;
    if (delta > 0) setSwipeOffset(Math.min(delta, 160));
  }, []);

  const onTouchEnd = useCallback(() => {
    if (touchDeltaY.current > 80) {
      closeExpanded();
    } else {
      setSwipeOffset(0);
    }
    touchStartY.current = null;
    touchDeltaY.current = 0;
  }, [closeExpanded]);

  const handlePlayToggle = useCallback(
    (e) => {
      e?.stopPropagation?.();
      toggle();
    },
    [toggle]
  );

  if (!hasStarted || !currentTrack) return null;

  const csOpacity = csMode ? 1 : csHoldOpacity;
  const baseCoverUrl = resolveAbsoluteArtworkUrl(baseCover);
  const csCoverUrl = csCover ? resolveAbsoluteArtworkUrl(csCover) : null;
  const islandCoverUrl = csMode && csCoverUrl ? csCoverUrl : baseCoverUrl;
  const islandCoverType = csMode && csCover ? csCoverType : baseCoverType;
  const progress = duration ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const bottom = isMobile ? "calc(62px + env(safe-area-inset-bottom, 0px) + 8px)" : 0;
  const sourceLabel = String(currentTrack.source || "audio").replace(/_/g, " ");
  const hasQueue = (queue || []).length > 1;
  const queuePos = queueIndex >= 0 && queue?.length ? queueIndex + 1 : 1;
  const queueTotal = queue?.length || 1;
  const queueLabel = hasQueue ? `${queuePos} of ${queueTotal}` : null;
  const coverSize = isMobile ? "min(80vw, 320px)" : 320;

  const coverFrameStyle = (dim, radius) => ({
    transform: flipPhase ? "scaleX(0)" : "scaleX(1)",
    transition: "transform 200ms ease",
    touchAction: "manipulation",
    flexShrink: 0,
  });

  const renderSecondaryControls = (btnSize) => (
    <div className="player-controls-row" style={{ gap: 20, marginTop: 8 }}>
      <RepeatButton
        repeatMode={repeatMode}
        size={btnSize}
        onClick={(e) => {
          e.stopPropagation();
          toggleRepeat();
        }}
      />
      <CSModeButton />
    </div>
  );

  const renderTransportRow = ({
    playSize,
    transportSize,
    skipSize,
    gap,
    hidePrevNext = false,
    shuffleSize,
  }) => (
    <div className="player-controls-row player-controls-row--primary" style={{ gap }}>
      {hidePrevNext ? (
        <div style={{ width: transportSize, flexShrink: 0 }} aria-hidden />
      ) : (
        <TrackTransportButton direction="back" size={transportSize} onClick={() => playPrevious()} />
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap, flex: 1 }}>
        <HoldSeekButton
          direction="back"
          size={skipSize}
          onTapSeek={() => seekBack(15)}
          onScrubTick={(secs) => seekBack(Math.abs(secs))}
        />
        <PlayPauseHero
          isPlaying={isPlaying}
          hasError={Boolean(error)}
          size={playSize}
          onClick={handlePlayToggle}
        />
        <HoldSeekButton
          direction="forward"
          size={skipSize}
          onTapSeek={() => seekForward(15)}
          onScrubTick={(secs) => seekForward(Math.abs(secs))}
        />
      </div>
      {hidePrevNext ? (
        <div style={{ width: transportSize, flexShrink: 0 }} aria-hidden />
      ) : (
        <TrackTransportButton direction="forward" size={transportSize} onClick={() => playNext()} />
      )}
      <ShuffleButton
        active={shuffle}
        size={shuffleSize || transportSize}
        onClick={(e) => {
          e.stopPropagation();
          toggleShuffle();
        }}
      />
    </div>
  );

  const playPauseCompact = (size) => (
    <PlayPauseHero
      isPlaying={isPlaying}
      hasError={Boolean(error)}
      size={size}
      onClick={handlePlayToggle}
    />
  );

  return (
    <>
      {isMobile && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Expand audio player"
          className="player-island-pill"
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 12px) + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9000,
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 120,
            height: 36,
            padding: "0 12px 0 6px",
            borderRadius: 20,
            cursor: "pointer",
            color: "inherit",
          }}
        >
          <CoverArt
            src={islandCoverUrl}
            type={islandCoverType}
            width={24}
            height={24}
            borderRadius="50%"
            style={coverFrameStyle(24, "50%")}
          />
          <WaveformBars playing={isPlaying} />
          {playPauseCompact(28)}
        </button>
      )}

      {expanded && (
        <div
          role="dialog"
          aria-label="Full screen audio player"
          className={["audio-immersive-enter", "player-immersive"].filter(Boolean).join(" ")}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 8500,
            background: "rgba(4,4,4,0.97)",
            backdropFilter: "blur(40px)",
            WebkitBackdropFilter: "blur(40px)",
            display: "flex",
            flexDirection: "column",
            padding: `max(12px, env(safe-area-inset-top, 0px)) 20px max(24px, env(safe-area-inset-bottom, 0px))`,
            overflowY: "auto",
            transform: swipeOffset ? `translateY(${swipeOffset}px)` : undefined,
            transition: swipeClosing || swipeOffset === 0 ? "transform 0.22s ease-out" : "none",
          }}
        >
          {(ambientCoverUrl || baseCoverUrl) && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `url(${ambientCoverUrl || baseCoverUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(48px) brightness(0.35)",
                opacity: 0.55,
                pointerEvents: "none",
                zIndex: 0,
              }}
            />
          )}

          <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div
              className="player-sheet-handle"
              style={{
                width: 40,
                height: 5,
                borderRadius: 3,
                background: "rgba(140,140,148,0.55)",
                margin: "6px auto 16px",
                flexShrink: 0,
              }}
            />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: "#555", letterSpacing: 2.5, textTransform: "uppercase", fontWeight: 700 }}>
                Now Playing
              </div>
              <button
                type="button"
                onClick={closeExpanded}
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
                gap: 20,
                minHeight: 0,
              }}
            >
              <div style={{ width: coverSize, height: coverSize, maxWidth: 320, maxHeight: 320 }}>
                <CoverArtCS
                  originalSrc={baseCoverUrl}
                  originalType={baseCoverType}
                  csSrc={csCoverUrl}
                  csType={csCoverType}
                  csOpacity={csOpacity}
                  isLocked={csMode}
                  width="100%"
                  height="100%"
                  borderRadius={20}
                  className={isPlaying ? "audio-immersive-cover-pulse" : undefined}
                  style={coverFrameStyle(320, 20)}
                  onTouchStart={(e) => handleCoverTouchStart(e)}
                  onTouchMove={handleCoverTouchMove}
                  onTouchEnd={(e) => handleCoverTouchEnd(e)}
                  onClick={(e) => e.preventDefault()}
                />
              </div>

              <div style={{ textAlign: "center", width: "100%", maxWidth: 400, padding: "0 8px" }}>
                <div className="player-track-title" style={{ fontSize: 24, lineHeight: 1.2, marginBottom: 6 }}>
                  {currentTrack.title}
                </div>
                <div className="player-track-meta" style={{ fontSize: 14, marginBottom: 4, opacity: 0.55 }}>
                  {currentTrack.artist}
                </div>
                <div className="player-track-meta" style={{ fontSize: 10, letterSpacing: 1.6, textTransform: "uppercase", opacity: 0.4 }}>
                  {sourceLabel}
                </div>
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

              {renderTransportRow({
                playSize: 72,
                transportSize: 44,
                skipSize: 44,
                gap: 20,
                hidePrevNext: isSmallScreen,
                shuffleSize: 40,
              })}

              {renderSecondaryControls(isSmallScreen ? 40 : 44)}

              {hasQueue && queueLabel && (
                <div style={{ fontSize: 12, color: "#555", letterSpacing: 1.5, textTransform: "uppercase", textAlign: "center" }}>
                  {queueLabel}
                </div>
              )}

              {error && <div style={{ fontSize: 12, color: "#ff8a8a", textAlign: "center" }}>{error}</div>}
            </div>
          </div>
        </div>
      )}

      {!expanded && (
        <div
          role="region"
          aria-label="Global audio player"
          className="player-dock"
          style={{
            position: "fixed",
            left: isMobile ? 12 : 0,
            right: isMobile ? 12 : 0,
            bottom,
            zIndex: 7600,
            borderRadius: isMobile ? 16 : 0,
            overflow: "hidden",
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
          <div className="player-dock-inner" style={{ maxWidth: 1180, margin: "0 auto", padding: isMobile ? "8px 12px 10px" : "10px 20px" }}>
            {isMobile ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <CoverArtCS
                    originalSrc={baseCoverUrl}
                    originalType={baseCoverType}
                    csSrc={csCoverUrl}
                    csType={csCoverType}
                    csOpacity={csOpacity}
                    isLocked={csMode}
                    width={40}
                    height={40}
                    borderRadius={8}
                    style={coverFrameStyle(40, 8)}
                    role="button"
                    tabIndex={0}
                    aria-label="Cover art"
                    onTouchStart={(e) => handleCoverTouchStart(e, () => setExpanded(true))}
                    onTouchMove={handleCoverTouchMove}
                    onTouchEnd={(e) => handleCoverTouchEnd(e, () => setExpanded(true))}
                    onClick={(e) => e.preventDefault()}
                  />
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    aria-label="Expand player"
                    style={{
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
                    <div
                      className="player-track-title"
                      style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {currentTrack.title}
                    </div>
                    <div
                      className="player-track-meta"
                      style={{
                        fontSize: 10,
                        color: error ? "#ff8a8a" : undefined,
                        opacity: error ? 1 : 0.48,
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {error || `${currentTrack.artist} · ${formatTime(currentTime)} / ${formatTime(duration)}`}
                    </div>
                  </button>
                  <ClosePlayerButton onClick={stop} size={18} />
                </div>
                {renderTransportRow({
                  playSize: 44,
                  transportSize: 36,
                  skipSize: 36,
                  gap: isSmallScreen ? 6 : 10,
                  hidePrevNext: isSmallScreen,
                  shuffleSize: 34,
                })}
                {renderSecondaryControls(isSmallScreen ? 36 : 40)}
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <CoverArtCS
                    originalSrc={baseCoverUrl}
                    originalType={baseCoverType}
                    csSrc={csCoverUrl}
                    csType={csCoverType}
                    csOpacity={csOpacity}
                    isLocked={csMode}
                    width={42}
                    height={42}
                    borderRadius={8}
                    style={coverFrameStyle(42, 8)}
                    role="button"
                    tabIndex={0}
                    aria-label="Cover art"
                    onTouchStart={(e) => handleCoverTouchStart(e, () => setExpanded(true))}
                    onTouchMove={handleCoverTouchMove}
                    onTouchEnd={(e) => handleCoverTouchEnd(e, () => setExpanded(true))}
                    onClick={(e) => e.preventDefault()}
                  />
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    aria-label="Expand player"
                    style={{
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
                    <div
                      className="player-track-title"
                      style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {currentTrack.title}
                    </div>
                    <div
                      className="player-track-meta"
                      style={{
                        fontSize: 10,
                        color: error ? "#ff8a8a" : undefined,
                        opacity: error ? 1 : 0.45,
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {error || `${currentTrack.artist} · ${formatTime(currentTime)} / ${formatTime(duration)}`}
                    </div>
                  </button>
                  <ClosePlayerButton onClick={stop} size={18} />
                </div>
                {renderTransportRow({
                  playSize: 40,
                  transportSize: 36,
                  skipSize: 36,
                  gap: 12,
                  hidePrevNext: false,
                  shuffleSize: 36,
                })}
                {renderSecondaryControls(40)}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default memo(GlobalAudioPlayerBar);
