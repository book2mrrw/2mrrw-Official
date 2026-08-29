"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo, forwardRef } from "react";
import Link from "next/link";
import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";
import { SignaturePlayRing, useImmersivePlayback, usePlayerBodyState } from "@/components/player/ImmersivePlayerEngine";
import { useProductionTransportStatus } from "@/lib/playback-core/production/useProductionTransport";
import { useAudioPlayer, usePlaybackIdentity, usePlaybackTransport } from "@/context/AudioContext";
import PlayerCsBarButton from "@/components/audio/PlayerCsBarButton";
import {
  TrackTransportButton,
  RepeatButton,
  ShuffleButton,
} from "@/components/audio/PlayerControlButton";
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
import { useArtworkGesture, isArtworkGestureActive } from "@/hooks/useArtworkGesture";
import { interactiveMediaState, PLAYBACK_MODE } from "@/media/InteractiveMediaState";
import { createPersistentVisualLifecycle } from "@/lib/media/persistent-visual-lifecycle";

const PREVIEW_MAX_SEC = 15;

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ─── Live current-time label (DOM-mutated, no React re-renders per frame) ────
const PlayerBarCurrentTime = memo(function PlayerBarCurrentTime() {
  const spanRef = useRef(null);
  const { subscribeProgress, getProgressSnapshot } = useAudioPlayer();
  useEffect(() => {
    function apply() {
      const { currentTime } = getProgressSnapshot();
      if (spanRef.current) spanRef.current.textContent = fmtTime(currentTime);
    }
    apply();
    return subscribeProgress(apply);
  }, [subscribeProgress, getProgressSnapshot]);
  return (
    <span ref={spanRef} style={{ fontSize: 10, fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.45)", fontFamily: "monospace", flexShrink: 0, minWidth: 28 }}>
      0:00
    </span>
  );
});

// ─── Scrub bar ───────────────────────────────────────────────────────────────

const PlayerBarScrub = memo(function PlayerBarScrub({ duration, previewOnly, onSeek }) {
  const scrubRef = useRef(null);
  const fillRef = useRef(null);
  const handleRef = useRef(null);
  const durationRef = useRef(duration);
  const [dragging, setDragging] = useState(false);
  const { subscribeProgress, getProgressSnapshot } = useAudioPlayer();

  const maxSeek = useMemo(() => {
    if (!duration) return 0;
    if (!previewOnly) return duration;
    // Hard cap only — no 30% ratio that blocked most of the preview
    return Math.min(PREVIEW_MAX_SEC, duration);
  }, [duration, previewOnly]);

  useLayoutEffect(() => {
    durationRef.current = duration;
    const { currentTime } = getProgressSnapshot();
    const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
    if (handleRef.current) handleRef.current.style.left = `${pct}%`;
    if (scrubRef.current) scrubRef.current.setAttribute("aria-valuenow", String(currentTime));
  }, [duration, getProgressSnapshot]);

  useEffect(() => {
    function applyProgress() {
      const { currentTime } = getProgressSnapshot();
      const dur = durationRef.current;
      const pct = dur > 0 ? Math.min(100, (currentTime / dur) * 100) : 0;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (handleRef.current) handleRef.current.style.left = `${pct}%`;
      if (scrubRef.current) scrubRef.current.setAttribute("aria-valuenow", String(currentTime));
    }
    applyProgress();
    return subscribeProgress(applyProgress);
  }, [subscribeProgress, getProgressSnapshot]);

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

  const capPct = previewOnly && duration > 0 ? Math.min(100, (maxSeek / duration) * 100) : null;

  return (
    <div
      ref={scrubRef}
      className={["player-bar-scrub", dragging ? "is-dragging" : ""].filter(Boolean).join(" ")}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={maxSeek || 0}
      aria-valuenow={0}
      tabIndex={0}
      onMouseDown={onScrubStart}
      onTouchStart={onScrubStart}
      onTouchMove={seekFromEvent}
      onTouchEnd={seekFromEvent}
      onClick={seekFromEvent}
    >
      <div className="player-bar-scrub__track">
        <div ref={fillRef} className="player-bar-scrub-fill" style={{ width: "0%" }} />
        {capPct != null ? <div className="player-bar-scrub-cap" style={{ left: `${capPct}%` }} aria-hidden /> : null}
        <div ref={handleRef} className="player-bar-scrub-handle" style={{ left: "0%" }} aria-hidden />
      </div>
    </div>
  );
});

// ─── Cover art thumbnail with CS hold gesture ─────────────────────────────────

function MiniCoverHit({
  title,
  trackSlug,
  baseCoverUrl,
  animatedCoverUrl,
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
  // Asset failure state keyed by stable track identity + role.
  // trackSlug is stable for the lifetime of a track; URLs are ephemeral delivery attempts.
  // When trackSlug changes, the derived keys change and all prior failures auto-clear — no reset
  // effect is needed. This avoids the setState-in-effect anti-pattern while encoding the correct
  // semantic: failure belongs to the asset identity, not to any particular signed URL.
  const baseAssetKey    = `${trackSlug || ""}:cover:base`;
  const videoAssetKey   = `${trackSlug || ""}:cover:video`;
  const overlayAssetKey = `${trackSlug || ""}:cover:overlay`;
  const [failedAssets, setFailedAssets] = useState({});
  const markFailed = useCallback(
    (key) => setFailedAssets((prev) => (prev[key] ? prev : { ...prev, [key]: true })),
    []
  );
  const baseFailed    = Boolean(failedAssets[baseAssetKey]);
  const videoFailed   = Boolean(failedAssets[videoAssetKey]);
  const overlayFailed = Boolean(failedAssets[overlayAssetKey]);

  const videoRef  = useRef(null);
  const coverRef  = useRef(null);
  const showVideo = Boolean(animatedCoverUrl) && !videoFailed;

  // Interactive artwork gesture — Slow/Screw/Chop/Filter on the mini player cover
  const { handlers: artGesture } = useArtworkGesture({
    slug:       trackSlug || "",
    elementRef: coverRef,
  });

  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el || !showVideo) return undefined;
    const lifecycle = createPersistentVisualLifecycle(el);
    lifecycle.setSource(animatedCoverUrl);
    return () => {
      lifecycle.dispose();
    };
  }, [animatedCoverUrl, showVideo]);

  const letter = (title && String(title).trim()[0]) || "♪";
  const staticLayerUrl = showVideo ? null : (baseCoverUrl || csCoverUrl || null);
  const showStaticLayer = !showVideo && Boolean(staticLayerUrl) && !baseFailed;
  const overlayUrl = baseCoverUrl && csCoverUrl && hasCs ? csCoverUrl : null;
  const showOverlay = Boolean(overlayUrl) && !overlayFailed && (csMode || isHoldAnimating);

  return (
    <div
      ref={coverRef}
      className="player-bar-cover-hit"
      role="button"
      tabIndex={0}
      aria-label="Cover art"
      onTouchStart={(e) => onCoverTouchStart(e, undefined)}
      onTouchMove={onCoverTouchMove}
      onTouchEnd={(e) => onCoverTouchEnd(e, undefined)}
      onClick={(e) => e.preventDefault()}
      onPointerDown={artGesture.onPointerDown}
      onPointerMove={artGesture.onPointerMove}
      onPointerUp={artGesture.onPointerUp}
      onPointerCancel={artGesture.onPointerCancel}
      onLostPointerCapture={artGesture.onLostPointerCapture}
    >
      {!showVideo && !showStaticLayer && !showOverlay ? (
        <div className="player-bar-cover-fallback">{letter}</div>
      ) : null}
      {showVideo ? (
        <video
          ref={videoRef}
          loop
          muted
          playsInline
          preload="auto"
          poster={baseCoverUrl || undefined}
          className="player-bar-cover-img player-bar-cover-img--base"
          onError={() => markFailed(videoAssetKey)}
        />
      ) : null}
      {showStaticLayer ? (
        <img
          src={staticLayerUrl}
          alt=""
          className="player-bar-cover-img player-bar-cover-img--base"
          data-playing={isPlaying ? "1" : undefined}
          onError={() => markFailed(baseAssetKey)}
        />
      ) : null}
      {showOverlay ? (
        <img
          ref={csImgRef}
          src={overlayUrl}
          alt=""
          className="player-bar-cover-img player-bar-cover-img--cs"
          style={{ opacity: csOpacity }}
          onError={() => markFailed(overlayAssetKey)}
        />
      ) : null}
    </div>
  );
}

// ─── Compact dock layout ───────────────────────────────────────────────────────
// Layout: [Cover] [Title/Artist ·flex·] [Prev] [Play] [Next] [Repeat] [CS?]
// Scrub bar sits below on its own row.

function QueueButton({ count, onClick }) {
  return (
    <button
      type="button"
      aria-label={count > 0 ? `View queue — ${count} up next` : "View queue"}
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "4px 6px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        color: count > 0 ? "#ccc" : "#555",
        flexShrink: 0,
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
      {count > 0 ? (
        <span style={{
          position: "absolute",
          top: -1,
          right: -1,
          fontSize: 8,
          fontWeight: 800,
          color: "#00ffff",
          lineHeight: 1,
          background: "#0a0a0a",
          borderRadius: 3,
          padding: "1px 2px",
          minWidth: 10,
          textAlign: "center",
        }}>
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}

function SleepTimerButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      aria-label={active ? `Sleep timer active: ${label}` : "Set sleep timer"}
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "4px 6px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        color: active ? "#00ffff" : "#555",
        flexShrink: 0,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
      {active && label ? (
        <span style={{
          position: "absolute",
          bottom: -1,
          right: -1,
          fontSize: 8,
          fontWeight: 800,
          color: "#00ffff",
          lineHeight: 1,
          letterSpacing: -0.3,
          background: "#0a0a0a",
          borderRadius: 3,
          padding: "1px 2px",
        }}>
          {label}
        </span>
      ) : null}
    </button>
  );
}

const MiniPlayerDock = forwardRef(function MiniPlayerDock({
  currentTrack,
  duration,
  isPlaying,
  isBuffering,
  error,
  streamRetryable,
  onRetryStream,
  accessDenied,
  errorMessage,
  csOpacity,
  csMode,
  isHoldAnimating,
  csImgRef,
  baseCoverUrl,
  animatedCoverUrl,
  csCoverUrl,
  hasCs,
  handlePlayToggle,
  onSeek,
  onPrevTrack,
  onNextTrack,
  repeatMode,
  onToggleRepeat,
  shuffleEnabled,
  onToggleShuffle,
  showCs,
  csActive,
  onToggleCs,
  progress,
  previewOnly,
  onCoverTouchStart,
  onCoverTouchMove,
  onCoverTouchEnd,
  sleepTimerActive,
  sleepTimerLabel,
  onOpenSleepSheet,
  upNextCount,
  onOpenQueueSheet,
}, ref) {
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

  const artistLine = accessDenied
    ? errorMessage
    : streamRetryable
      ? "Connection lost — tap to retry"
      : (currentTrack?.artist || "2MRRW");
  const displayTitle = resolvePlayerDisplayTitle(currentTrack);

  return (
    <div ref={ref} role="region" aria-label="Global audio player" className="player-bar-compact">
      <div className="player-bar-compact__pad">
        <div className="player-bar-compact__row">
          <MiniCoverHit
            title={displayTitle}
            trackSlug={currentTrack?.slug}
            baseCoverUrl={baseCoverUrl}
            animatedCoverUrl={animatedCoverUrl}
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
              data-error={(accessDenied || streamRetryable) ? "1" : undefined}
            >
              {artistLine}
            </div>
          </div>
          <div className="player-bar-controls">
            <ShuffleButton active={shuffleEnabled} size={36} onClick={onToggleShuffle} />
            <TrackTransportButton direction="back" size={40} onClick={onPrevTrack} />
            <SignaturePlayRing
              isPlaying={isPlaying}
              hasError={Boolean(error)}
              isBuffering={isBuffering}
              progress={progress}
              size={40}
              onClick={handlePlayToggle}
              className="player-bar-compact-play"
            />
            <TrackTransportButton direction="forward" size={40} onClick={onNextTrack} />
            <RepeatButton
              repeatMode={repeatMode}
              size={36}
              onClick={onToggleRepeat}
            />
            {showCs ? <PlayerCsBarButton active={csActive} onClick={onToggleCs} /> : null}
            <QueueButton count={upNextCount} onClick={onOpenQueueSheet} />
            <SleepTimerButton active={sleepTimerActive} label={sleepTimerLabel} onClick={onOpenSleepSheet} />
          </div>
        </div>
      </div>
      <div className="player-bar-compact-scrub">
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px 4px" }}>
          <PlayerBarCurrentTime />
          <div style={{ flex: 1 }}>
            <PlayerBarScrub duration={duration} previewOnly={previewOnly} onSeek={onSeek} />
          </div>
          <span style={{ fontSize: 10, fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.45)", fontFamily: "monospace", flexShrink: 0, minWidth: 28, textAlign: "right" }}>
            {fmtTime(previewOnly ? Math.min(PREVIEW_MAX_SEC, duration || 0) : (duration || 0))}
          </span>
        </div>
      </div>
    </div>
  );
});

// ─── Main bar component ────────────────────────────────────────────────────────

function GlobalAudioPlayerBar() {
  useBlackscreenMountTrace("GlobalAudioPlayerBar");
  useRenderTracker("GlobalAudioPlayerBar");
  const playbackOrchestrationState = useProductionTransportStatus((status) => status.status);
  const playback = useImmersivePlayback();
  const { continuityFrozen, getContinuitySnapshot } = useAudioPlayer();
  // usePlaybackIdentity uses useSyncExternalStore — it updates synchronously, in the
  // same frame as release card buttons. useAudioPlayer() is a React context that
  // batches updates, so it can lag by one render cycle, causing the global bar to
  // show Play while a card correctly shows Pause. Override isPlaying with the
  // synchronous snapshot so both always flip at the same time.
  const { isPlaying: syncedIsPlaying } = usePlaybackIdentity();
  // isBuffering from the transport channel (useSyncExternalStore, direct snapshot).
  // Previously read from useAudioPlayer() useMemo which only recomputes on context
  // or orchestration channel changes — causing permanent spinner lock when the
  // browser fails to fire 'playing' (e.g. iOS Safari after an HLS source swap).
  const { isBuffering } = usePlaybackTransport();
  const {
    currentTrack,
    hasStarted,
    isPlaying: _audioIsPlaying,
    currentTime,
    duration,
    error,
    streamRetryable,
    retryStreamPlayback,
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
    playNext,
    playPrevious,
    repeatMode,
    toggleRepeat,
    shuffle,
    toggleShuffle,
    setSleepTimer,
    sleepTimerEndsAt,
    sleepAfterCurrentTrack,
    queue,
    queueIndex,
    removeFromQueue,
    moveInQueue,
    osInterrupted,
  } = playback;

  const [isHoldAnimating, setIsHoldAnimating] = useState(false);
  // Derived: hold animation is always suppressed while CS mode is active.
  // This avoids a synchronous setState call in the csMode effect to cancel hold animation.
  const effectiveIsHoldAnimating = isHoldAnimating && !csMode;
  const [sleepSheetOpen, setSleepSheetOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [queueSheetOpen, setQueueSheetOpen] = useState(false);
  const [dragQueue, setDragQueue] = useState(null); // { fromIdx, overIdx }
  const queueListRef = useRef(null);
  const queueItemHeightRef = useRef(50);
  const dragGhostRef = useRef(null);
  const csOverlayImgRef = useRef(null);
  const touchMovedRef = useRef(false);
  const touchStartRef = useRef(null);
  const tapTimeoutRef = useRef(null);
  const holdRafRef = useRef(null);
  const lastHoldOpacityRef = useRef(0);
  const holdActiveRef = useRef(false);
  const lastTapTimeRef = useRef(0);
  const csModeRef = useRef(csMode);
  const roCleanupRef = useRef(null);

  const dockRef = useCallback((el) => {
    if (roCleanupRef.current) {
      roCleanupRef.current();
      roCleanupRef.current = null;
    }
    if (!el) {
      document.documentElement.style.setProperty('--player-bar-inset', '0px');
      return;
    }
    const update = () => {
      const rect = el.getBoundingClientRect();
      const inset = Math.max(0, window.innerHeight - rect.top);
      document.documentElement.style.setProperty('--player-bar-inset', `${inset}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    roCleanupRef.current = () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const continuitySnap = continuityFrozen ? getContinuitySnapshot?.() : null;

  const dockCurrentTrack = useMemo(() => {
    if (!continuityFrozen || !continuitySnap || !currentTrack) return currentTrack;
    // Only apply snap data when it belongs to the same track. A stale snap from a
    // prior OS-suspended session must not overwrite a newly-started track's metadata.
    const snapSlug = continuitySnap.slug;
    const liveSlug = currentTrack.slug;
    if (snapSlug && liveSlug && snapSlug !== liveSlug) return currentTrack;
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

  // Screen-reader track announcer — DOM-mutated on slug change, never causes a re-render.
  const trackAnnouncerRef = useRef(null);
  useEffect(() => {
    const el = trackAnnouncerRef.current;
    if (!el || !dockCurrentTrack) return;
    const title = dockCurrentTrack.title || "Untitled";
    const artist = dockCurrentTrack.artist;
    el.textContent = artist ? `Now playing: ${title} by ${artist}` : `Now playing: ${title}`;
  }, [dockCurrentTrack?.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseCover = dockCurrentTrack?.baseCover || dockCurrentTrack?.cover;
  // Animated (MP4) cover: only when cover is a genuinely different URL from baseCover.
  // Guards against continuity-freeze where cover is already snapped to the static base image.
  const dockCover = dockCurrentTrack?.cover;
  const animatedCover =
    dockCurrentTrack?.coverArtType === "video" && dockCover && dockCover !== baseCover
      ? dockCover
      : null;
  const csCover = dockCurrentTrack?.csCover || null;
  const csAudio = dockCurrentTrack?.csAudio || null;
  const hasCs = Boolean(csCover || csAudio);

  const isPlaying = syncedIsPlaying;
  const frozenIsPlaying = continuityFrozen ? Boolean(continuitySnap?.isPlaying) : isPlaying;

  usePlayerBodyState({ playing: frozenIsPlaying && hasStarted, expanded: false });

  useEffect(() => {
    csModeRef.current = csMode;
    if (csMode) {
      lastHoldOpacityRef.current = 0;
      holdActiveRef.current = false;
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
      // Pointer gesture owns audio when active. On touch devices pointerdown fires
      // before touchstart, so this flag is already set by the time this runs.
      if (isArtworkGestureActive()) return;
      // ScrewEngine owns playbackRate when IMS is not NORMAL.
      if (interactiveMediaState.getSnapshot().playbackMode !== PLAYBACK_MODE.NORMAL) return;
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
        if (csOverlayImgRef.current) csOverlayImgRef.current.style.opacity = String(value);
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
      animateHoldOpacity(0, 1, HOLD_FADE_MS, (value, p) => { applyHoldAudio(p); });
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

      if (touchMovedRef.current) { touchStartRef.current = null; return; }
      if (csModeRef.current) { touchStartRef.current = null; return; }

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

  const dockCurrentTime = continuityFrozen && continuitySnap ? continuitySnap.playbackPosition : currentTime;
  const dockDuration = continuityFrozen && continuitySnap ? continuitySnap.duration ?? duration : duration;
  const dockIsPlaying = continuityFrozen ? Boolean(continuitySnap?.isPlaying) : isPlaying;

  const maxPreviewSeek = useMemo(() => {
    if (!previewOnly || !dockDuration) return dockDuration || 0;
    return Math.min(PREVIEW_MAX_SEC, dockDuration);
  }, [dockDuration, previewOnly]);

  const handleEngineSeek = useCallback(
    (seconds) => {
      const cap = previewOnly ? maxPreviewSeek : dockDuration;
      if (!cap) return;
      seek(Math.max(0, Math.min(seconds, cap)));
    },
    [dockDuration, seek, maxPreviewSeek, previewOnly]
  );

  const handlePrevTrack = useCallback(() => void playPrevious?.(), [playPrevious]);
  const handleNextTrack = useCallback(() => void playNext?.(), [playNext]);
  const handleToggleRepeat = useCallback(
    (e) => { e?.stopPropagation(); toggleRepeat?.(); },
    [toggleRepeat]
  );
  const handleToggleShuffle = useCallback(
    (e) => { e?.stopPropagation(); toggleShuffle?.(); },
    [toggleShuffle]
  );

  const dockProgress = useMemo(() => {
    if (!dockDuration) return 0;
    return Math.max(0, Math.min(100, (dockCurrentTime / dockDuration) * 100));
  }, [dockCurrentTime, dockDuration]);

  const showCs = hasCs; // hasCs = Boolean(csCover || csAudio), computed from dockCurrentTrack above
  const handleToggleCs = useCallback(() => void toggleCSMode?.(), [toggleCSMode]);

  const upNextCount = Math.max(0, (queue?.length ?? 0) - (queueIndex ?? 0) - 1);
  const handleOpenQueueSheet = useCallback(() => setQueueSheetOpen(true), []);

  const onQueueDragStart = useCallback((e, fromIdx) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const list = queueListRef.current;
    if (list?.firstElementChild) {
      queueItemHeightRef.current = list.firstElementChild.offsetHeight || 50;
    }
    setDragQueue({ fromIdx, overIdx: fromIdx, pointerY: e.clientY });
  }, []);

  const onQueueDragMove = useCallback((e, trackCount) => {
    // Move ghost via direct DOM mutation — no React re-render per frame
    if (dragGhostRef.current) {
      dragGhostRef.current.style.top = `${e.clientY - 24}px`;
    }
    const list = queueListRef.current;
    if (!list) return;
    const rect = list.getBoundingClientRect();
    const y = e.clientY - rect.top + list.scrollTop;
    const h = queueItemHeightRef.current || 50;
    const overIdx = Math.max(0, Math.min(trackCount - 1, Math.floor(y / h)));
    setDragQueue((prev) => {
      if (!prev) return prev;
      if (prev.overIdx === overIdx) return prev;
      return { ...prev, overIdx };
    });
  }, []);

  const onQueueDragEnd = useCallback((_e, upNextStart) => {
    setDragQueue((prev) => {
      if (!prev) return null;
      if (prev.fromIdx !== prev.overIdx) {
        moveInQueue(upNextStart + prev.fromIdx, upNextStart + prev.overIdx);
      }
      return null;
    });
  }, [moveInQueue]);

  const sleepTimerActive = Boolean(sleepTimerEndsAt || sleepAfterCurrentTrack);
  useEffect(() => {
    if (!sleepTimerEndsAt) return undefined;
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [sleepTimerEndsAt]);
  const sleepTimerLabel = sleepAfterCurrentTrack
    ? "end"
    : sleepTimerEndsAt
      ? `${Math.max(1, Math.ceil((sleepTimerEndsAt - clockNow) / 60000))}m`
      : null;
  const handleOpenSleepSheet = useCallback(() => setSleepSheetOpen(true), []);
  const handleSleepOption = useCallback((minutes) => {
    setSleepTimer(minutes);
    setSleepSheetOpen(false);
  }, [setSleepTimer]);

  const csOpacity = csMode ? 1 : 0;
  const baseCoverUrl = resolveAbsoluteArtworkUrl(baseCover);
  const animatedCoverUrl = animatedCover ? resolveAbsoluteArtworkUrl(animatedCover) : null;
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
  ) : null;

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

  const upNextTracks = queue && queueIndex != null ? queue.slice(queueIndex + 1) : [];
  const upNextStartIndex = (queueIndex ?? 0) + 1;

  const queueSheet = queueSheetOpen ? (
    <div
      role="dialog"
      aria-label="Up Next"
      style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={() => setQueueSheetOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 480, background: "#0d0d0d", borderTop: "1px solid #222", borderRadius: "16px 16px 0 0", maxHeight: "70vh", display: "flex", flexDirection: "column" }}
      >
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>Up Next</div>
          {dockCurrentTrack ? (
            <div style={{ marginTop: 6, fontSize: 13, color: "#ccc", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Now: {dockCurrentTrack.title}
            </div>
          ) : null}
        </div>
        <div
          ref={queueListRef}
          style={{
            overflowY: "auto",
            flex: 1,
            padding: "4px 0 max(16px, env(safe-area-inset-bottom, 0px))",
            touchAction: dragQueue ? "none" : "pan-y",
          }}
        >
          {upNextTracks.length === 0 ? (
            <div style={{ padding: "20px", color: "#555", fontSize: 13, textAlign: "center" }}>Nothing queued up next.</div>
          ) : (
            upNextTracks.map((track, i) => {
              const isDragging = dragQueue?.fromIdx === i;
              const isOver = dragQueue && dragQueue.overIdx === i && dragQueue.fromIdx !== i;
              return (
                <div
                  key={`${track.slug ?? track.id ?? i}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 20px",
                    borderBottom: "1px solid #111",
                    opacity: isDragging ? 0.25 : 1,
                    background: isOver ? "rgba(0,255,255,0.08)" : undefined,
                    borderTop: isOver ? "2px solid rgba(0,255,255,0.55)" : undefined,
                    transition: isDragging ? "none" : "background 0.12s, border-color 0.12s",
                  }}
                >
                  {/* drag handle */}
                  <div
                    onPointerDown={(e) => onQueueDragStart(e, i)}
                    onPointerMove={(e) => onQueueDragMove(e, upNextTracks.length)}
                    onPointerUp={(e) => onQueueDragEnd(e, upNextStartIndex)}
                    onPointerCancel={() => setDragQueue(null)}
                    style={{
                      cursor: isDragging ? "grabbing" : "grab",
                      touchAction: "none",
                      padding: "4px 4px",
                      color: "#444",
                      fontSize: 15,
                      lineHeight: 1,
                      flexShrink: 0,
                      userSelect: "none",
                    }}
                  >
                    ≡
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.title}</div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{track.artist || "2MRRW"}</div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${track.title} from queue`}
                    onClick={() => removeFromQueue(upNextStartIndex + i)}
                    style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18, padding: "4px 8px", flexShrink: 0, lineHeight: 1 }}
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
      {/* Drag ghost — follows finger, shows what's being moved */}
      {dragQueue !== null && upNextTracks[dragQueue.fromIdx] ? (
        <div
          ref={dragGhostRef}
          aria-hidden="true"
          style={{
            position: "fixed",
            left: 20,
            right: 20,
            top: dragQueue.pointerY - 24,
            zIndex: 9999,
            background: "#1c1c1e",
            border: "1px solid rgba(0,255,255,0.4)",
            borderRadius: 10,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: "0 12px 32px rgba(0,0,0,0.75), 0 0 0 1px rgba(0,255,255,0.06)",
            pointerEvents: "none",
            touchAction: "none",
            willChange: "top",
          }}
        >
          <div style={{ fontSize: 14, color: "rgba(0,255,255,0.55)", lineHeight: 1, flexShrink: 0 }}>≡</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#fff" }}>
              {upNextTracks[dragQueue.fromIdx].title}
            </div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
              {upNextTracks[dragQueue.fromIdx].artist || "2MRRW"}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

  const sleepSheet = sleepSheetOpen ? (
    <div
      role="dialog"
      aria-label="Sleep timer"
      style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={() => setSleepSheetOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 480, background: "#0d0d0d", borderTop: "1px solid #222", borderRadius: "16px 16px 0 0", padding: "16px 20px max(24px, env(safe-area-inset-bottom, 0px))" }}
      >
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4, fontWeight: 700 }}>Sleep Timer</div>
        {sleepTimerActive && (
          <div style={{ fontSize: 12, color: "#00ffff", marginBottom: 12 }}>
            {sleepAfterCurrentTrack ? "Stops after current track" : `Stops in ${sleepTimerLabel}`}
          </div>
        )}
        {[
          { label: "15 minutes", value: 15 },
          { label: "30 minutes", value: 30 },
          { label: "45 minutes", value: 45 },
          { label: "60 minutes", value: 60 },
          { label: "End of track", value: "end_of_track" },
        ].map(({ label, value }) => (
          <button
            key={value}
            type="button"
            onClick={() => handleSleepOption(value)}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "14px 4px", background: "none", border: "none", borderBottom: "1px solid #1a1a1a", color: "#ccc", fontSize: 15, fontWeight: 500, cursor: "pointer" }}
          >
            {label}
          </button>
        ))}
        {sleepTimerActive && (
          <button
            type="button"
            onClick={() => handleSleepOption(0)}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "14px 4px", background: "none", border: "none", color: "#ff4d4d", fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 4 }}
          >
            Cancel timer
          </button>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      {/* Visually hidden — announces track changes to screen readers */}
      <div
        ref={trackAnnouncerRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      />
      {conflictDialog}
      {queueSheet}
      {sleepSheet}
      {playbackOrchestrationState === "RECOVERING" && !isBuffering && (
        <div
          className="player-immersive-buffer-indicator"
          aria-live="polite"
          aria-label="Buffering"
          data-playback-orchestration={playbackOrchestrationState}
        />
      )}
      {playbackState === "ended_preview" && dockCurrentTrack && !entitlementAccountState?.permissions?.admin ? (
        <div className="player-preview-ended-cta">
          <span className="player-preview-ended-label">PREVIEW ENDED</span>
          <Link href={`/?track=${encodeURIComponent(dockCurrentTrack.slug)}&buy=1`} className="player-preview-ended-buy">
            OWN IT
          </Link>
        </div>
      ) : null}
      <MiniPlayerDock
        ref={dockRef}
        currentTrack={dockCurrentTrack}
        duration={dockDuration}
        isPlaying={dockIsPlaying}
        isBuffering={isBuffering || (Boolean(osInterrupted) && !dockIsPlaying)}
        error={error}
        streamRetryable={streamRetryable}
        onRetryStream={retryStreamPlayback}
        accessDenied={accessDenied}
        errorMessage={errorMessage}
        csOpacity={csOpacity}
        csMode={csMode}
        isHoldAnimating={isHoldAnimating}
        csImgRef={csOverlayImgRef}
        baseCoverUrl={baseCoverUrl}
        animatedCoverUrl={animatedCoverUrl}
        csCoverUrl={csCoverUrl}
        hasCs={hasCs}
        handlePlayToggle={handlePlayToggle}
        onSeek={handleEngineSeek}
        onPrevTrack={handlePrevTrack}
        onNextTrack={handleNextTrack}
        repeatMode={repeatMode}
        onToggleRepeat={handleToggleRepeat}
        shuffleEnabled={shuffle}
        onToggleShuffle={handleToggleShuffle}
        showCs={showCs}
        csActive={csMode}
        onToggleCs={handleToggleCs}
        progress={dockProgress}
        previewOnly={previewOnly}
        onCoverTouchStart={handleCoverTouchStart}
        onCoverTouchMove={handleCoverTouchMove}
        onCoverTouchEnd={handleCoverTouchEnd}
        sleepTimerActive={sleepTimerActive}
        sleepTimerLabel={sleepTimerLabel}
        onOpenSleepSheet={handleOpenSleepSheet}
        upNextCount={upNextCount}
        onOpenQueueSheet={handleOpenQueueSheet}
      />
    </>
  );
}

export default memo(GlobalAudioPlayerBar);
