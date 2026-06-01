"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";
import { SignaturePlayRing, useImmersivePlayback, usePlayerBodyState } from "@/components/player/ImmersivePlayerEngine";
import { useMediaEngine } from "@/media/useMediaEngine";
import PlayerCsBarButton from "@/components/audio/PlayerCsBarButton";
import GiftIcon from "@/components/gifts/GiftIcon";
import { useRenderTracker } from "@/lib/dev/useRenderTracker";
import { useEntitlementAccountState } from "@/context/AuthContext";
import { resolveSubscriptionEntitlements } from "@/lib/commerce/entitlements";
import {
  DOUBLE_TAP_MS,
  HOLD_FADE_MS,
  RELEASE_FADE_MS,
  MOVE_CANCEL_PX,
} from "@/lib/player/constants";

const PREVIEW_SCRUB_CAP_RATIO = 0.3;
const PREVIEW_MAX_SEC = 30;

function Skip15Icon({ direction }) {
  const back = direction === "back";
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <g transform={back ? undefined : "scale(-1,1) translate(-32,0)"}>
        <path
          d="M22.5 11.5a7.2 7.2 0 1 0 0 9"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M21.5 8.5l3.5 3.5-3.5 2.8"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>
      <text
        x="16"
        y="18"
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

function PlayerBarScrub({ currentTime, duration, previewOnly, onSeek }) {
  const scrubRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const maxSeek = useMemo(() => {
    if (!duration) return 0;
    if (!previewOnly) return duration;
    return Math.min(PREVIEW_MAX_SEC, duration * PREVIEW_SCRUB_CAP_RATIO);
  }, [duration, previewOnly]);

  const ratioFromEvent = useCallback(
    (e) => {
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
    },
    [duration, maxSeek, previewOnly]
  );

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
  const capPct = previewOnly && duration > 0 ? Math.min(100, (maxSeek / duration) * 100) : null;

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
        {capPct != null ? <div className="player-bar-scrub-cap" style={{ left: `${capPct}%` }} aria-hidden /> : null}
        <div className="player-bar-scrub-handle" style={{ left: `${progressPct}%` }} aria-hidden />
      </div>
    </div>
  );
}

function MiniCoverHit({
  title,
  baseCoverUrl,
  csCoverUrl,
  csMode,
  csOpacity,
  hasCs,
  isPlaying,
  onCoverTouchStart,
  onCoverTouchMove,
  onCoverTouchEnd,
}) {
  const [baseFailed, setBaseFailed] = useState(false);
  const [overlayFailed, setOverlayFailed] = useState(false);

  useEffect(() => {
    setBaseFailed(false);
    setOverlayFailed(false);
  }, [baseCoverUrl, csCoverUrl]);

  const letter = (title && String(title).trim()[0]) || "♪";
  const baseLayerUrl = baseCoverUrl || csCoverUrl || null;
  const overlayUrl = baseCoverUrl && csCoverUrl && hasCs ? csCoverUrl : null;
  const showBaseLayer = Boolean(baseLayerUrl) && !baseFailed;
  const showOverlay =
    Boolean(overlayUrl) && !overlayFailed && (csMode || csOpacity > 0.01);

  return (
    <div
      className="player-bar-cover-hit"
      role="button"
      tabIndex={0}
      aria-label="Cover art"
      onTouchStart={(e) => onCoverTouchStart(e, undefined)}
      onTouchMove={onCoverTouchMove}
      onTouchEnd={(e) => onCoverTouchEnd(e, undefined)}
      onClick={(e) => e.preventDefault()}
    >
      {!showBaseLayer && !showOverlay ? <div className="player-bar-cover-fallback">{letter}</div> : null}
      {showBaseLayer ? (
        <img
          src={baseLayerUrl}
          alt=""
          className="player-bar-cover-img player-bar-cover-img--base"
          data-playing={isPlaying ? "1" : undefined}
          onError={() => setBaseFailed(true)}
        />
      ) : null}
      {showOverlay ? (
        <img
          src={overlayUrl}
          alt=""
          className="player-bar-cover-img player-bar-cover-img--cs"
          style={{ opacity: csMode ? 1 : csOpacity }}
          onError={() => setOverlayFailed(true)}
        />
      ) : null}
    </div>
  );
}

function MiniPlayerDock({
  currentTrack,
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
  csCoverUrl,
  hasCs,
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

  const artistLine = error || accessDenied ? errorMessage : currentTrack.artist;

  return (
    <div role="region" aria-label="Global audio player" className="player-bar-compact">
      <div className="player-bar-compact__pad">
        <div className="player-bar-compact__row">
          <MiniCoverHit
            title={currentTrack.title}
            baseCoverUrl={baseCoverUrl}
            csCoverUrl={csCoverUrl}
            csMode={csMode}
            csOpacity={csOpacity}
            hasCs={hasCs}
            isPlaying={isPlaying}
            onCoverTouchStart={onCoverTouchStart}
            onCoverTouchMove={onCoverTouchMove}
            onCoverTouchEnd={onCoverTouchEnd}
          />
          <div className="player-bar-compact-meta">
            <div className="player-bar-compact-title">
              {currentTrack.title}
              {giftBadge}
            </div>
            <div
              className="player-bar-compact-artist"
              data-error={error || accessDenied ? "1" : undefined}
            >
              {artistLine}
            </div>
          </div>
          <Skip15Button direction="back" ariaLabel="Skip back 15 seconds" onClick={onSkipBack} />
          <SignaturePlayRing
            isPlaying={isPlaying}
            hasError={Boolean(error)}
            isBuffering={isBuffering}
            progress={progress}
            size={38}
            onClick={handlePlayToggle}
            className="player-bar-compact-play"
          />
          <Skip15Button direction="forward" ariaLabel="Skip forward 15 seconds" onClick={onSkipForward} />
          {showCs ? <PlayerCsBarButton active={csActive} onClick={onToggleCs} /> : null}
        </div>
      </div>
      <div className="player-bar-compact-scrub">
        <PlayerBarScrub currentTime={currentTime} duration={duration} previewOnly={previewOnly} onSeek={onSeek} />
      </div>
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
    streamConflict,
    progress,
    handlePlayToggle,
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
  const [csHoldOpacity, setCsHoldOpacity] = useState(0);
  const touchMovedRef = useRef(false);
  const touchStartRef = useRef(null);
  const tapTimeoutRef = useRef(null);
  const holdRafRef = useRef(null);
  const lastHoldOpacityRef = useRef(0);
  const holdActiveRef = useRef(false);
  const lastTapTimeRef = useRef(0);
  const csModeRef = useRef(csMode);

  const baseCover = currentTrack?.baseCover || currentTrack?.cover;
  const csCover = currentTrack?.csCover || null;
  const csAudio = currentTrack?.csAudio || null;
  const hasCs = Boolean(csCover || csAudio);

  usePlayerBodyState({ playing: isPlaying && hasStarted, expanded: false });

  useEffect(() => {
    csModeRef.current = csMode;
    if (csMode) {
      lastHoldOpacityRef.current = 0;
      setCsHoldOpacity(0);
      holdActiveRef.current = false;
    }
  }, [csMode]);

  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      setIsMobile(w < 768);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(
    () => () => {
      if (holdRafRef.current) cancelAnimationFrame(holdRafRef.current);
      if (tapTimeoutRef.current) window.clearTimeout(tapTimeoutRef.current);
    },
    []
  );

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
    (from, to, durationMs, onFrame, onComplete) => {
      cancelHoldAnim();
      const start = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - start) / durationMs);
        const value = from + (to - from) * p;
        if (Math.abs(lastHoldOpacityRef.current - value) > 0.01) {
          lastHoldOpacityRef.current = value;
          setCsHoldOpacity(value);
        }
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
        lastHoldOpacityRef.current = 0;
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
      });
    },
    [animateHoldOpacity, applyHoldAudio, cancelHoldAnim, hasCs, revertHoldPreview, toggleCSMode]
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
          });
        }
      }
    },
    [animateHoldOpacity, csHoldOpacity, revertHoldPreview]
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
    [animateHoldOpacity, csHoldOpacity, revertHoldPreview]
  );

  const previewOnly = Boolean(
    engineCurrentTrack?.metadata?.access?.previewOnly ?? currentTrack?.metadata?.access?.previewOnly
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

  const csOpacity = csMode ? 1 : csHoldOpacity;
  const baseCoverUrl = resolveAbsoluteArtworkUrl(baseCover);
  const csCoverUrl = csCover ? resolveAbsoluteArtworkUrl(csCover) : null;
  const entitlementAccountState = useEntitlementAccountState();
  const showSubscribeCta = useMemo(
    () => resolveSubscriptionEntitlements(entitlementAccountState).showSubscribe,
    [entitlementAccountState]
  );

  const errorMessage = accessDenied ? (
    <span>
      Access unavailable
      {showSubscribeCta ? (
        <>
          {" — "}
          <a href={storeLinkHref || "/subscribe"} className="player-immersive-access-link">
            get access
          </a>
        </>
      ) : null}
    </span>
  ) : (
    error
  );


  const isLifecycleVisibleState =
    hasStarted ||
    playbackState === "loading" ||
    playbackState === "ready" ||
    playbackState === "playing" ||
    playbackState === "preview_fallback";
  if (!isLifecycleVisibleState || !currentTrack) return null;

  const conflictDialog = streamConflict ? (
    <div role="alertdialog" aria-label="Concurrent stream" className="player-immersive-conflict">
      <div className="player-immersive-conflict__card">
        <div className="player-immersive-conflict__title">Already streaming</div>
        <p className="player-immersive-conflict__text">Already streaming on another device — stop other session?</p>
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

  return (
    <>
      {conflictDialog}
      {isBuffering && (
        <div className="player-immersive-buffer-indicator" aria-live="polite" aria-label="Buffering" data-mobile={isMobile ? "1" : undefined} />
      )}
      {playbackState === "ended_preview" && currentTrack ? (
        <div className="player-preview-ended-cta" data-mobile={isMobile ? "1" : undefined}>
          <span className="player-preview-ended-label">PREVIEW ENDED</span>
          <a href={`/?track=${encodeURIComponent(currentTrack.slug)}&buy=1`} className="player-preview-ended-buy">
            OWN IT
          </a>
        </div>
      ) : null}
      <MiniPlayerDock
        currentTrack={currentTrack}
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
        csCoverUrl={csCoverUrl}
        hasCs={hasCs}
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
    </>
  );
}

export default memo(GlobalAudioPlayerBar);
