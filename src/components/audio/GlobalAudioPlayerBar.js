"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";
import {
  CompactDockPlayer,
  FloatingMainPlayer,
  PlayerArtwork,
  SignaturePlayRing,
  useImmersivePlayback,
  usePlayerAmbience,
  usePlayerBodyState,
} from "@/components/player/ImmersivePlayerEngine";
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

      {!expanded && (
        <div style={dockShellStyle}>
          <CompactDockPlayer {...sharedDockProps} />
        </div>
      )}
    </>
  );
}

export default memo(GlobalAudioPlayerBar);
