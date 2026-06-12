"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";
import { SignaturePlayRing, useImmersivePlayback, usePlayerBodyState } from "@/components/player/ImmersivePlayerEngine";
import { usePlaybackStateMachine } from "@/media/PlaybackStateMachine";
import { useAudioPlayer } from "@/context/AudioContext";
import PlayerCsBarButton from "@/components/audio/PlayerCsBarButton";
import GiftIcon from "@/components/gifts/GiftIcon";
import { useRenderTracker } from "@/lib/dev/useRenderTracker";
import { useBlackscreenMountTrace } from "@/lib/diagnostics/useBlackscreenMountTrace";
import { useEntitlementAccountState } from "@/context/AuthContext";
import { resolveSubscriptionEntitlements } from "@/lib/commerce/entitlements";
import {
  DOUBLE_TAP_MS,
  HOLD_FADE_MS,
  RELEASE_FADE_MS,
  MOVE_CANCEL_PX,
} from "@/lib/player/constants";
import { resolvePlayerDisplayTitle } from "@/lib/playback/resolve-player-display-title";

const PREVIEW_SCRUB_CAP_RATIO = 0.3;
const PREVIEW_MAX_SEC = 15;

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
  isHoldAnimating,
  csImgRef,
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
    Boolean(overlayUrl) && !overlayFailed && (csMode || isHoldAnimating);

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
          ref={csImgRef}
          src={overlayUrl}
          alt=""
          className="player-bar-cover-img player-bar-cover-img--cs"
          style={{ opacity: csOpacity }}
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
  isHoldAnimating,
  csImgRef,
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
  const displayTitle = resolvePlayerDisplayTitle(currentTrack);

  return (
    <div role="region" aria-label="Global audio player" className="player-bar-compact">
      <div className="player-bar-compact__pad">
        <div className="player-bar-compact__row">
          <MiniCoverHit
            title={displayTitle}
            baseCoverUrl={baseCoverUrl}
            csCoverUrl={csCoverUrl}
            csMode={csMode}
            csOpacity={csOpacity}
            isHoldAnimating={isHoldAnimating}
            csImgRef={csImgRef}
            hasCs={hasCs}
            isPlaying={isPlaying}
            onCoverTouchStart={onCoverTouchStart}
            onCoverTouchMove={onCoverTouchMove}
            onCoverTouchEnd={onCoverTouchEnd}
          />
          <div className="player-bar-compact-meta">
            <div className="player-bar-compact-title">
              {displayTitle}
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
  useBlackscreenMountTrace("GlobalAudioPlayerBar");
  useRenderTracker("GlobalAudioPlayerBar");
  const playbackOrchestrationState = usePlaybackStateMachine();
  const playback = useImmersivePlayback();
  const { continuityFrozen, getContinuitySnapshot } = useAudioPlayer();
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
    seek,
    beginCsHoldPreview,
    setCsHoldPlaybackRate,
    endCsHoldPreview,
    overrideConcurrentStream,
    dismissStreamConflict,
    storeLinkHref,
    playbackState,
    getIsAudiblyPlaying,
  } = playback;

  const [isHoldAnimating, setIsHoldAnimating] = useState(false);
  const csOverlayImgRef = useRef(null);
  const touchMovedRef = useRef(false);
  const touchStartRef = useRef(null);
  const tapTimeoutRef = useRef(null);
  const holdRafRef = useRef(null);
  const lastHoldOpacityRef = useRef(0);
  const holdActiveRef = useRef(false);
  const lastTapTimeRef = useRef(0);
  const csModeRef = useRef(csMode);

  const continuitySnap = continuityFrozen ? getContinuitySnapshot?.() : null;

  const dockCurrentTrack = useMemo(() => {
    if (!continuityFrozen || !continuitySnap || !currentTrack) return currentTrack;
    return {
      ...currentTrack,
      id: continuitySnap.trackId,
      slug: continuitySnap.slug ?? currentTrack.slug,
      title: continuitySnap.title ?? currentTrack.title,
      artist: continuitySnap.artist ?? currentTrack.artist,
      album: continuitySnap.album ?? currentTrack.album,
      cover: continuitySnap.cover?.base ?? currentTrack.cover,
      coverArtType: continuitySnap.cover?.baseArtType ?? currentTrack.coverArtType,
      baseCover: continuitySnap.cover?.base ?? currentTrack.baseCover,
      csCover: continuitySnap.cover?.cs ?? currentTrack.csCover,
      csCoverType: continuitySnap.cover?.csArtType ?? currentTrack.csCoverType,
    };
  }, [continuityFrozen, continuitySnap, currentTrack]);

  const baseCover = dockCurrentTrack?.baseCover || dockCurrentTrack?.cover;
  const csCover = dockCurrentTrack?.csCover || null;
  const csAudio = dockCurrentTrack?.csAudio || null;
  const hasCs = Boolean(csCover || csAudio);

  const frozenIsPlaying = continuityFrozen
    ? Boolean(continuitySnap?.isPlaying)
    : isPlaying;

  usePlayerBodyState({ playing: frozenIsPlaying && hasStarted, expanded: false });

  useEffect(() => {
    csModeRef.current = csMode;
    if (csMode) {
      lastHoldOpacityRef.current = 0;
      holdActiveRef.current = false;
      setIsHoldAnimating(false);
      if (csOverlayImgRef.current) csOverlayImgRef.current.style.opacity = "0";
    }
  }, [csMode]);

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
        lastHoldOpacityRef.current = value;
        if (csOverlayImgRef.current) {
          csOverlayImgRef.current.style.opacity = String(value);
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
        setIsHoldAnimating(false);
        if (csOverlayImgRef.current) csOverlayImgRef.current.style.opacity = "0";
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
      lastHoldOpacityRef.current = 0;
      setIsHoldAnimating(true);
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
          animateHoldOpacity(lastHoldOpacityRef.current, 0, RELEASE_FADE_MS, null, () => {
            revertHoldPreview();
            setIsHoldAnimating(false);
          });
        }
      }
    },
    [animateHoldOpacity, revertHoldPreview]
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
        animateHoldOpacity(lastHoldOpacityRef.current, 0, RELEASE_FADE_MS, null, () => {
          revertHoldPreview();
          setIsHoldAnimating(false);
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
    [animateHoldOpacity, revertHoldPreview]
  );

  const previewOnly = Boolean(currentTrack?.metadata?.access?.previewOnly);

  const dockCurrentTime =
    continuityFrozen && continuitySnap
      ? continuitySnap.playbackPosition
      : currentTime;
  const dockDuration =
    continuityFrozen && continuitySnap
      ? continuitySnap.duration ?? duration
      : duration;
  const dockAudible =
    hasStarted && typeof getIsAudiblyPlaying === "function" ? getIsAudiblyPlaying() : null;
  const dockIsPlaying = continuityFrozen
    ? Boolean(continuitySnap?.isPlaying)
    : dockAudible ?? isPlaying;

  const maxPreviewSeek = useMemo(() => {
    if (!previewOnly || !dockDuration) return dockDuration || 0;
    return Math.min(PREVIEW_MAX_SEC, dockDuration * PREVIEW_SCRUB_CAP_RATIO);
  }, [dockDuration, previewOnly]);

  const handleEngineSeek = useCallback(
    (seconds) => {
      const cap = previewOnly ? maxPreviewSeek : dockDuration;
      if (!cap) return;
      seek(Math.max(0, Math.min(seconds, cap)));
    },
    [dockDuration, seek, maxPreviewSeek, previewOnly]
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

  const showCs = Boolean(dockCurrentTrack?.hasCs || dockCurrentTrack?.csAudio);
  const dockCsMode = csMode;
  const handleToggleCs = useCallback(() => {
    void toggleCSMode?.();
  }, [toggleCSMode]);

  const csOpacity = csMode ? 1 : 0;
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
  if (!isLifecycleVisibleState || !dockCurrentTrack) return null;

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
      {(isBuffering || playbackOrchestrationState === "RECOVERING") && (
        <div
          className="player-immersive-buffer-indicator"
          aria-live="polite"
          aria-label="Buffering"
          data-playback-orchestration={playbackOrchestrationState}
        />
      )}
      {playbackState === "ended_preview" && dockCurrentTrack ? (
        <div className="player-preview-ended-cta">
          <span className="player-preview-ended-label">PREVIEW ENDED</span>
          <Link href={`/?track=${encodeURIComponent(dockCurrentTrack.slug)}&buy=1`} className="player-preview-ended-buy">
            OWN IT
          </Link>
        </div>
      ) : null}
      <MiniPlayerDock
        currentTrack={dockCurrentTrack}
        currentTime={dockCurrentTime}
        duration={dockDuration}
        isPlaying={dockIsPlaying}
        isBuffering={isBuffering}
        error={error}
        accessDenied={accessDenied}
        errorMessage={errorMessage}
        csOpacity={csOpacity}
        csMode={csMode}
        isHoldAnimating={isHoldAnimating}
        csImgRef={csOverlayImgRef}
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
