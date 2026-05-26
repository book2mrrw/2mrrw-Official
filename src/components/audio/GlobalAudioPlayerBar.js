"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";
import {
  FloatingMainPlayer,
  PlayerArtwork,
  SignaturePlayRing,
  useImmersivePlayback,
  usePlayerAmbience,
  usePlayerBodyState,
} from "@/components/player/ImmersivePlayerEngine";
import { useMediaEngine } from "@/media/useMediaEngine";
import { ClosePlayerButton } from "@/components/audio/PlayerControlButton";
import PlayerCsBarButton from "@/components/audio/PlayerCsBarButton";
import GiftIcon from "@/components/gifts/GiftIcon";
import { formatPlayerTime } from "@/lib/player/formatTime";
import { useRenderTracker } from "@/lib/dev/useRenderTracker";
import {
  DOUBLE_TAP_MS,
  HOLD_FADE_MS,
  RELEASE_FADE_MS,
  MOVE_CANCEL_PX,
  SWIPE_DISMISS_PX,
  EXPAND_SWIPE_CLOSE_MS,
} from "@/lib/player/constants";
import { registerModal, unregisterModal } from "@/state/ui/modalStackStore";


const PREVIEW_SCRUB_CAP_RATIO = 0.3;
const PREVIEW_MAX_SEC = 30;

function Skip15Icon({ direction }) {
  const back = direction === "back";
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d={back ? "M17 9 L11 16 L17 23" : "M15 9 L21 16 L15 23"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fontSize="9"
        fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        15
      </text>
    </svg>
  );
}

function Skip15Button({ direction, onClick, ariaLabel }) {
  return (
    <button type="button" className="player-bar-skip" onClick={onClick} aria-label={ariaLabel}>
      <Skip15Icon direction={direction} />
    </button>
  );
}

function PlayerBarScrub({
  currentTime,
  duration,
  previewOnly,
  onSeek,
}) {
  const scrubRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const maxSeek = useMemo(() => {
    if (!duration) return 0;
    if (!previewOnly) return duration;
    return Math.min(PREVIEW_MAX_SEC, duration * PREVIEW_SCRUB_CAP_RATIO);
  }, [duration, previewOnly]);

  const ratioFromEvent = useCallback((e) => {
    const el = scrubRef.current;
    if (!el || !maxSeek) return 0;
    const rect = el.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX ?? e.clientX;
    const raw = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (previewOnly && duration > 0) {
      const capRatio = maxSeek / duration;
      return Math.min(raw, capRatio);
    }
    return raw;
  }, [duration, maxSeek, previewOnly]);

  const seekFromEvent = useCallback(
    (e) => {
      if (!maxSeek) return;
      const ratio = ratioFromEvent(e);
      onSeek(ratio * maxSeek);
    },
    [maxSeek, onSeek, ratioFromEvent]
  );

  const onScrubStart = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(true);
      seekFromEvent(e);
    },
    [seekFromEvent]
  );

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => seekFromEvent(e);
    const onEnd = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [dragging, seekFromEvent]);

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const capPct =
    previewOnly && duration > 0 ? Math.min(100, (maxSeek / duration) * 100) : null;

  return (
    <div
      ref={scrubRef}
      className={["player-bar-scrub", dragging ? "is-dragging" : ""].filter(Boolean).join(" ")}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={maxSeek || 0}
      aria-valuenow={currentTime}
      tabIndex={0}
      onMouseDown={onScrubStart}
      onTouchStart={onScrubStart}
      onTouchMove={seekFromEvent}
      onTouchEnd={seekFromEvent}
      onClick={seekFromEvent}
    >
      <div className="player-bar-scrub__track">
        <div className="player-bar-scrub-fill" style={{ width: `${progressPct}%` }} />
        {capPct != null ? (
          <div className="player-bar-scrub-cap" style={{ left: `${capPct}%` }} aria-hidden />
        ) : null}
        <div className="player-bar-scrub-handle" style={{ left: `${progressPct}%` }} aria-hidden />
      </div>
    </div>
  );
}

function MiniPlayerDock({
  currentTrack,
  isMobile,
  cssVars,
  currentTime,
  duration,
  isPlaying,
  isBuffering,
  error,
  accessDenied,
  errorMessage,
  csOpacity,
  csMode,
  baseCoverUrl,
  baseCoverType,
  csCoverUrl,
  csCoverType,
  coverFrameStyle,
  onExpand,
  onStop,
  handlePlayToggle,
  onSeek,
  onSkipBack,
  onSkipForward,
  showCs,
  csActive,
  onToggleCs,
  progress,
  onCoverTouchStart,
  onCoverTouchMove,
  onCoverTouchEnd,
  previewOnly,
}) {
  const giftBadge =
    currentTrack?.source === "gift" || currentTrack?.gifted ? (
      <GiftIcon
        size={12}
        style={{
          marginLeft: 4,
          display: "inline-block",
          verticalAlign: "middle",
          animation: "giftIconSpin 4s ease-in-out infinite",
        }}
      />
    ) : null;

  const metaLine =
    error || accessDenied
      ? errorMessage
      : `${currentTrack.artist} · ${formatPlayerTime(currentTime)} / ${formatPlayerTime(duration)}`;

  return (
    <div
      role="region"
      aria-label="Global audio player"
      className="player-dock player-immersive-glass player-bar-mini-dock"
      style={cssVars}
    >
      <div
        className="player-dock-inner player-immersive-dock-inner"
        style={{ maxWidth: 1180, margin: "0 auto", padding: isMobile ? "10px 14px 12px" : "12px 20px" }}
      >
        <div className="player-bar-mini">
          <div className="player-bar-mini__row player-immersive-dock-row">
            <PlayerArtwork
              baseCoverUrl={baseCoverUrl}
              baseCoverType={baseCoverType}
              csCoverUrl={csCoverUrl}
              csCoverType={csCoverType}
              csOpacity={csOpacity}
              csMode={csMode}
              size={isMobile ? 52 : 56}
              borderRadius={isMobile ? 10 : 12}
              isPlaying={isPlaying}
              style={coverFrameStyle}
              role="button"
              tabIndex={0}
              aria-label="Cover art"
              onTouchStart={(e) => onCoverTouchStart(e, onExpand)}
              onTouchMove={onCoverTouchMove}
              onTouchEnd={(e) => onCoverTouchEnd(e, onExpand)}
              onClick={(e) => e.preventDefault()}
            />
            <button type="button" className="player-immersive-meta-btn" onClick={onExpand} aria-label="Expand player">
              <div className="player-track-title player-immersive-title">
                {currentTrack.title}
                {giftBadge}
              </div>
              <div
                className="player-track-meta player-immersive-meta"
                data-error={error || accessDenied ? "1" : undefined}
              >
                {metaLine}
              </div>
            </button>
            <Skip15Button direction="back" ariaLabel="Skip back 15 seconds" onClick={onSkipBack} />
            <SignaturePlayRing
              isPlaying={isPlaying}
              hasError={Boolean(error)}
              isBuffering={isBuffering}
              progress={progress}
              size={isMobile ? 50 : 54}
              onClick={handlePlayToggle}
              className="player-immersive-dock-ring"
            />
            <Skip15Button direction="forward" ariaLabel="Skip forward 15 seconds" onClick={onSkipForward} />
            {showCs ? (
              <PlayerCsBarButton active={csActive} onClick={onToggleCs} />
            ) : null}
            <ClosePlayerButton onClick={onStop} size={18} />
          </div>
          <PlayerBarScrub
            currentTime={currentTime}
            duration={duration}
            previewOnly={previewOnly}
            onSeek={onSeek}
          />
        </div>
      </div>
    </div>
  );
}

function WaveformBars({ playing }) {
  return (
    <div className={`player-immersive-island-wave${playing ? " is-playing" : ""}`} aria-hidden>
      <span />
      <span />
      <span />
    </div>
  );
}

function GlobalAudioPlayerBar() {
  useRenderTracker("GlobalAudioPlayerBar");
  const playback = useImmersivePlayback();
  const {
    state: {
      currentTime: engineCurrentTime,
      duration: engineDuration,
      isPlaying: engineIsPlaying,
      currentTrack: engineCurrentTrack,
      csMode: engineCsMode,
    },
    seek: engineSeek,
    toggleCSMode: engineToggleCSMode,
  } = useMediaEngine();
  const {
    currentTrack,
    hasStarted,
    isPlaying,
    currentTime,
    duration,
    error,
    isBuffering,
    accessDenied,
    streamRetryable,
    streamConflict,
    progress,
    handlePlayToggle,
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
    beginCsHoldPreview,
    setCsHoldPlaybackRate,
    endCsHoldPreview,
    overrideConcurrentStream,
    dismissStreamConflict,
    storeLinkHref,
    playbackState,
  } = playback;

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
  const touchMovedRef = useRef(false);
  const touchStartRef = useRef(null);
  const tapTimeoutRef = useRef(null);
  const csModeRef = useRef(csMode);

  const baseCover = currentTrack?.baseCover || currentTrack?.cover;
  const csCover = currentTrack?.csCover || null;
  const csAudio = currentTrack?.csAudio || null;
  const baseCoverType = currentTrack?.coverArtType || "image";
  const csCoverType = currentTrack?.csCoverType || "image";
  const hasCs = Boolean(csCover || csAudio);
  const { cssVars } = usePlayerAmbience(
    csMode && csCover ? csCover : baseCover,
    csMode && csCover ? csCoverType : baseCoverType
  );

  usePlayerBodyState({ playing: isPlaying && hasStarted, expanded });

  useEffect(() => {
    csModeRef.current = csMode;
    if (csMode) {
      setCsHoldOpacity(0);
      holdActiveRef.current = false;
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
    registerModal("global-audio-player-expanded");
    return () => unregisterModal("global-audio-player-expanded");
  }, [expanded]);

  useEffect(
    () => () => {
      if (holdRafRef.current) cancelAnimationFrame(holdRafRef.current);
      if (tapTimeoutRef.current) window.clearTimeout(tapTimeoutRef.current);
    },
    []
  );

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

  const applyHoldAudio = useCallback(
    (progressVal) => {
      if (csModeRef.current) return;
      if (csAudio) beginCsHoldPreview(csAudio);
      else setCsHoldPlaybackRate(progressVal);
    },
    [beginCsHoldPreview, csAudio, setCsHoldPlaybackRate]
  );

  const revertHoldPreview = useCallback(() => {
    if (csModeRef.current) return;
    cancelHoldAnim();
    holdActiveRef.current = false;
    endCsHoldPreview();
  }, [cancelHoldAnim, endCsHoldPreview]);

  const animateHoldOpacity = useCallback(
    (from, to, duration, onFrame, onComplete) => {
      cancelHoldAnim();
      const start = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - start) / duration);
        const value = from + (to - from) * p;
        setCsHoldOpacity(value);
        onFrame?.(value, p);
        if (p < 1) {
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
      animateHoldOpacity(0, 1, HOLD_FADE_MS, (value, p) => {
        applyHoldAudio(p);
        if (csCover) setAmbientCoverUrl(resolveAbsoluteArtworkUrl(csCover));
      });
    },
    [animateHoldOpacity, applyHoldAudio, cancelHoldAnim, csCover, hasCs, revertHoldPreview, toggleCSMode]
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


  const previewOnly = Boolean(
    engineCurrentTrack?.metadata?.access?.previewOnly ??
      currentTrack?.metadata?.access?.previewOnly
  );

  const dockCurrentTime = engineCurrentTime ?? currentTime;
  const dockDuration = engineDuration ?? duration;
  const dockIsPlaying = engineIsPlaying ?? isPlaying;

  const maxPreviewSeek = useMemo(() => {
    if (!previewOnly || !dockDuration) return dockDuration || 0;
    return Math.min(PREVIEW_MAX_SEC, dockDuration * PREVIEW_SCRUB_CAP_RATIO);
  }, [dockDuration, previewOnly]);

  const handleEngineSeek = useCallback(
    (seconds) => {
      const cap = previewOnly ? maxPreviewSeek : dockDuration;
      if (!cap) return;
      engineSeek(Math.max(0, Math.min(seconds, cap)));
    },
    [dockDuration, engineSeek, maxPreviewSeek, previewOnly]
  );

  const handleSkipBack15 = useCallback(() => {
    handleEngineSeek(Math.max(0, dockCurrentTime - 15));
  }, [dockCurrentTime, handleEngineSeek]);

  const handleSkipForward15 = useCallback(() => {
    handleEngineSeek(dockCurrentTime + 15);
  }, [dockCurrentTime, handleEngineSeek]);

  const dockProgress = useMemo(() => {
    if (!dockDuration) return 0;
    return Math.max(0, Math.min(100, (dockCurrentTime / dockDuration) * 100));
  }, [dockCurrentTime, dockDuration]);

  const showCs = Boolean(currentTrack?.hasCs || currentTrack?.csAudio);
  const dockCsMode = engineCsMode ?? csMode;
  const handleToggleCs = useCallback(() => {
    void (engineToggleCSMode ?? toggleCSMode)?.();
  }, [engineToggleCSMode, toggleCSMode]);

  const closeExpanded = useCallback(() => {
    setSwipeClosing(true);
    setSwipeOffset(120);
    window.setTimeout(() => {
      setExpanded(false);
      setSwipeClosing(false);
      setSwipeOffset(0);
    }, EXPAND_SWIPE_CLOSE_MS);
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
    if (touchDeltaY.current > SWIPE_DISMISS_PX) {
      closeExpanded();
    } else {
      setSwipeOffset(0);
    }
    touchStartY.current = null;
    touchDeltaY.current = 0;
  }, [closeExpanded]);

  const coverFrameStyle = useMemo(
    () => ({
      transform: flipPhase ? "scaleX(0)" : "scaleX(1)",
      transition: "transform 200ms ease",
      touchAction: "manipulation",
      flexShrink: 0,
    }),
    [flipPhase]
  );

  const handleExpand = useCallback(() => setExpanded(true), []);

  const csOpacity = csMode ? 1 : csHoldOpacity;
  const baseCoverUrl = resolveAbsoluteArtworkUrl(baseCover);
  const csCoverUrl = csCover ? resolveAbsoluteArtworkUrl(csCover) : null;
  const bottom = isMobile ? "calc(62px + env(safe-area-inset-bottom, 0px) + 8px)" : 0;

  const errorMessage = accessDenied ? (
    <span>
      Access unavailable —{" "}
      <a href={storeLinkHref || "/subscribe"} className="player-immersive-access-link">
        get access
      </a>
    </span>
  ) : (
    error
  );

  const sharedDockProps = useMemo(
    () => ({
      currentTrack,
      isMobile,
      cssVars,
      progress,
      currentTime,
      duration,
      isPlaying,
      isBuffering,
      error,
      accessDenied,
      errorMessage,
      csOpacity,
      csMode,
      baseCoverUrl,
      baseCoverType,
      csCoverUrl,
      csCoverType,
      coverFrameStyle,
      onExpand: handleExpand,
      onStop: stop,
      onSeekBarClick: handleSeek,
      handlePlayToggle,
      playPrevious,
      playNext,
      repeatMode,
      toggleRepeat,
      shuffle,
      toggleShuffle,
      onCoverTouchStart: handleCoverTouchStart,
      onCoverTouchMove: handleCoverTouchMove,
      onCoverTouchEnd: handleCoverTouchEnd,
    }),
    [
      accessDenied,
      baseCoverType,
      baseCoverUrl,
      coverFrameStyle,
      csCoverType,
      csCoverUrl,
      csMode,
      csOpacity,
      currentTime,
      currentTrack,
      duration,
      error,
      errorMessage,
      handleCoverTouchEnd,
      handleCoverTouchMove,
      handleCoverTouchStart,
      handleExpand,
      handlePlayToggle,
      handleSeek,
      isBuffering,
      isMobile,
      isPlaying,
      cssVars,
      playNext,
      playPrevious,
      progress,
      repeatMode,
      shuffle,
      stop,
      toggleRepeat,
      toggleShuffle,
    ]
  );

  const dockShellStyle = useMemo(
    () => ({
      position: "fixed",
      left: isMobile ? 12 : 0,
      right: isMobile ? 12 : 0,
      bottom,
      zIndex: 7600,
      borderRadius: isMobile ? 18 : 0,
      overflow: "hidden",
    }),
    [bottom, isMobile]
  );

  if (!hasStarted || !currentTrack) return null;

  const conflictDialog = streamConflict ? (
    <div role="alertdialog" aria-label="Concurrent stream" className="player-immersive-conflict">
      <div className="player-immersive-conflict__card">
        <div className="player-immersive-conflict__title">Already streaming</div>
        <p className="player-immersive-conflict__text">
          Already streaming on another device — stop other session?
        </p>
        <div className="player-immersive-conflict__actions">
          <button type="button" className="player-immersive-conflict__cancel" onClick={dismissStreamConflict}>
            Cancel
          </button>
          <button type="button" className="player-immersive-conflict__confirm" onClick={() => void overrideConcurrentStream()}>
            Stop other &amp; play
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const islandCoverUrl = csMode && csCoverUrl ? csCoverUrl : baseCoverUrl;
  const islandCoverType = csMode && csCover ? csCoverType : baseCoverType;
  const hasQueue = (queue || []).length > 1;
  const queuePos = queueIndex >= 0 && queue?.length ? queueIndex + 1 : 1;
  const queueTotal = queue?.length || 1;
  const queueLabel = hasQueue ? `${queuePos} of ${queueTotal}` : null;
  const coverSize = isMobile ? "min(80vw, 320px)" : 320;

  return (
    <>
      {conflictDialog}
      {isBuffering && (
        <div className="player-immersive-buffer-indicator" aria-live="polite" aria-label="Buffering" data-mobile={isMobile ? "1" : undefined} />
      )}
      {isMobile && !expanded && (
        <button
          type="button"
          onClick={handleExpand}
          aria-label="Expand audio player"
          className="player-island-pill player-immersive-island"
          style={cssVars}
        >
          <PlayerArtwork
            baseCoverUrl={islandCoverUrl}
            baseCoverType={islandCoverType}
            size={28}
            borderRadius="50%"
            isPlaying={isPlaying}
            layoutId={undefined}
          />
          <WaveformBars playing={isPlaying} />
          <SignaturePlayRing
            isPlaying={isPlaying}
            hasError={Boolean(error)}
            isBuffering={isBuffering}
            progress={progress}
            size={32}
            onClick={handlePlayToggle}
          />
        </button>
      )}

      {expanded && (
        <FloatingMainPlayer
          {...sharedDockProps}
          isSmallScreen={isSmallScreen}
          coverSize={coverSize}
          ambientCoverUrl={ambientCoverUrl}
          swipeOffset={swipeOffset}
          swipeClosing={swipeClosing}
          onClose={closeExpanded}
          onSeek={handleSeek}
          seek={seek}
          seekBack={playback.seekBack}
          seekForward={playback.seekForward}
          hasQueue={hasQueue}
          queueLabel={queueLabel}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />
      )}

      {!expanded && playbackState === "ended_preview" && currentTrack ? (
        <div className="player-preview-ended-cta" data-mobile={isMobile ? "1" : undefined}>
          <span className="player-preview-ended-label">PREVIEW ENDED</span>
          <a
            href={`/?track=${encodeURIComponent(currentTrack.slug)}&buy=1`}
            className="player-preview-ended-buy"
          >
            OWN IT
          </a>
        </div>
      ) : null}

      {!expanded && (
        <div style={dockShellStyle}>
          <MiniPlayerDock
            currentTrack={currentTrack}
            isMobile={isMobile}
            cssVars={cssVars}
            currentTime={dockCurrentTime}
            duration={dockDuration}
            isPlaying={dockIsPlaying}
            isBuffering={isBuffering}
            error={error}
            accessDenied={accessDenied}
            errorMessage={errorMessage}
            csOpacity={csOpacity}
            csMode={csMode}
            baseCoverUrl={baseCoverUrl}
            baseCoverType={baseCoverType}
            csCoverUrl={csCoverUrl}
            csCoverType={csCoverType}
            coverFrameStyle={coverFrameStyle}
            onExpand={handleExpand}
            onStop={stop}
            handlePlayToggle={handlePlayToggle}
            onSeek={handleEngineSeek}
            onSkipBack={handleSkipBack15}
            onSkipForward={handleSkipForward15}
            showCs={showCs}
            csActive={dockCsMode}
            onToggleCs={handleToggleCs}
            progress={dockProgress}
            previewOnly={previewOnly}
            onCoverTouchStart={handleCoverTouchStart}
            onCoverTouchMove={handleCoverTouchMove}
            onCoverTouchEnd={handleCoverTouchEnd}
          />
        </div>
      )}
    </>
  );
}

export default memo(GlobalAudioPlayerBar);
