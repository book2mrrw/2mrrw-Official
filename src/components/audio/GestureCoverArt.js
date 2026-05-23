"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CoverArtCS from "@/components/ui/CoverArtCS";
import { resolveCoverMediaType } from "@/components/ui/CoverArt";
import { resolveAbsoluteArtworkUrl } from "@/lib/media-session-artwork";

export const CS_GESTURE = {
  HOLD_THRESHOLD_MS: 50,
  CROSSFADE_MS: 300,
  DOUBLE_TAP_MAX_MS: 300,
  MOVE_CANCEL_PX: 10,
};

const CS_PLAYBACK_RATE = 0.75;

export default function GestureCoverArt({
  baseCover,
  baseCoverType,
  csCover,
  csCoverType,
  csAudio,
  csMode,
  toggleCSMode,
  audioRef,
  suppressPauseInterruptionRef,
  size,
  pulse,
  flipKey,
  borderRadius,
  onSingleTap,
  onAmbientChange,
  style: styleOverride,
}) {
  const [csOverlayOpacity, setCsOverlayOpacity] = useState(csMode ? 1 : 0);
  const [flipPhase, setFlipPhase] = useState(false);

  const holdTimerRef = useRef(null);
  const holdActiveRef = useRef(false);
  const previewActiveRef = useRef(false);
  const savedAudioRef = useRef(null);
  const lastTapRef = useRef(0);
  const tapTimeoutRef = useRef(null);
  const touchMovedRef = useRef(false);
  const touchStartRef = useRef(null);
  const csModeRef = useRef(csMode);

  useEffect(() => {
    csModeRef.current = csMode;
    if (csMode) {
      setCsOverlayOpacity(1);
      if (csCover) onAmbientChange?.(resolveAbsoluteArtworkUrl(csCover));
    } else if (!holdActiveRef.current && !previewActiveRef.current) {
      setCsOverlayOpacity(0);
      onAmbientChange?.(resolveAbsoluteArtworkUrl(baseCover));
    }
  }, [csMode, csCover, baseCover, onAmbientChange]);

  useEffect(() => {
    if (!flipKey) return undefined;
    setFlipPhase(true);
    const t = window.setTimeout(() => setFlipPhase(false), 200);
    return () => window.clearTimeout(t);
  }, [flipKey]);

  useEffect(() => {
    if (!csCover && !csAudio) return undefined;
    if (csCover) {
      const url = resolveAbsoluteArtworkUrl(csCover);
      if (resolveCoverMediaType(url, csCoverType) === "video") {
        const video = document.createElement("video");
        video.preload = "auto";
        video.src = url;
      } else {
        const img = new Image();
        img.src = url;
      }
    }
    if (csAudio) {
      const preload = new Audio();
      preload.preload = "auto";
      preload.src = csAudio;
    }
    return undefined;
  }, [csCover, csCoverType, csAudio]);

  useEffect(
    () => () => {
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      if (tapTimeoutRef.current) window.clearTimeout(tapTimeoutRef.current);
    },
    []
  );

  const hasCs = Boolean(csCover || csAudio);

  const markProgrammaticPause = useCallback(() => {
    if (suppressPauseInterruptionRef) suppressPauseInterruptionRef.current = true;
  }, [suppressPauseInterruptionRef]);

  const applyPreviewCs = useCallback(() => {
    const audio = audioRef?.current;
    if (!audio || csModeRef.current) return;

    savedAudioRef.current = {
      src: audio.currentSrc || audio.src,
      currentTime: audio.currentTime,
      playbackRate: audio.playbackRate,
      wasPlaying: !audio.paused,
    };

    if (csAudio) {
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
    } else {
      audio.playbackRate = CS_PLAYBACK_RATE;
      if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
    }

    previewActiveRef.current = true;
    setCsOverlayOpacity(1);
    if (csCover) onAmbientChange?.(resolveAbsoluteArtworkUrl(csCover));
  }, [audioRef, csAudio, csCover, markProgrammaticPause, onAmbientChange]);

  const revertPreviewCs = useCallback(() => {
    const audio = audioRef?.current;
    if (!audio || csModeRef.current || !previewActiveRef.current) return;

    const saved = savedAudioRef.current;
    if (saved) {
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
    }

    previewActiveRef.current = false;
    savedAudioRef.current = null;
    setCsOverlayOpacity(0);
    onAmbientChange?.(resolveAbsoluteArtworkUrl(baseCover));
  }, [audioRef, baseCover, csAudio, markProgrammaticPause, onAmbientChange]);

  const startHoldPreview = useCallback(() => {
    if (!hasCs || csModeRef.current) return;
    holdActiveRef.current = true;
    applyPreviewCs();
  }, [applyPreviewCs, hasCs]);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (e) => {
      e.stopPropagation();
      touchMovedRef.current = false;
      touchStartRef.current = { x: e.touches[0]?.clientX ?? 0, y: e.touches[0]?.clientY ?? 0 };
      clearHoldTimer();
      if (hasCs && !csModeRef.current) {
        holdTimerRef.current = window.setTimeout(startHoldPreview, CS_GESTURE.HOLD_THRESHOLD_MS);
      }
    },
    [clearHoldTimer, hasCs, startHoldPreview]
  );

  const onTouchMove = useCallback(
    (e) => {
      if (!touchStartRef.current) return;
      const dx = (e.touches[0]?.clientX ?? 0) - touchStartRef.current.x;
      const dy = (e.touches[0]?.clientY ?? 0) - touchStartRef.current.y;
      if (Math.hypot(dx, dy) > CS_GESTURE.MOVE_CANCEL_PX) {
        touchMovedRef.current = true;
        clearHoldTimer();
        if (holdActiveRef.current && !csModeRef.current) {
          holdActiveRef.current = false;
          revertPreviewCs();
        }
      }
    },
    [clearHoldTimer, revertPreviewCs]
  );

  const onTouchEnd = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearHoldTimer();

      if (holdActiveRef.current) {
        holdActiveRef.current = false;
        if (!csModeRef.current) revertPreviewCs();
        touchStartRef.current = null;
        return;
      }

      if (touchMovedRef.current) {
        touchStartRef.current = null;
        return;
      }

      const now = Date.now();
      const sinceLast = now - lastTapRef.current;

      if (sinceLast < CS_GESTURE.DOUBLE_TAP_MAX_MS && lastTapRef.current > 0) {
        window.clearTimeout(tapTimeoutRef.current);
        lastTapRef.current = 0;
        if (!csModeRef.current) void toggleCSMode?.();
        setCsOverlayOpacity(1);
        if (csCover) onAmbientChange?.(resolveAbsoluteArtworkUrl(csCover));
        touchStartRef.current = null;
        return;
      }

      lastTapRef.current = now;

      if (csModeRef.current) {
        void toggleCSMode?.();
        setCsOverlayOpacity(0);
        onAmbientChange?.(resolveAbsoluteArtworkUrl(baseCover));
        touchStartRef.current = null;
        return;
      }

      tapTimeoutRef.current = window.setTimeout(() => {
        onSingleTap?.();
        lastTapRef.current = 0;
      }, CS_GESTURE.DOUBLE_TAP_MAX_MS);

      touchStartRef.current = null;
    },
    [baseCover, clearHoldTimer, csCover, onAmbientChange, onSingleTap, revertPreviewCs, toggleCSMode]
  );

  const dim = size;
  const radius = borderRadius ?? (dim <= 32 ? "50%" : dim >= 180 ? 12 : 8);
  const baseUrl = resolveAbsoluteArtworkUrl(baseCover);
  const csUrl = csCover ? resolveAbsoluteArtworkUrl(csCover) : null;

  return (
    <CoverArtCS
      originalSrc={baseUrl}
      originalType={baseCoverType}
      csSrc={csUrl}
      csType={csCoverType}
      csOpacity={csOverlayOpacity}
      isLocked={csMode}
      width={dim >= 180 ? "100%" : dim}
      height={dim >= 180 ? "100%" : dim}
      borderRadius={radius}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClick={(e) => e.preventDefault()}
      style={{
        maxWidth: dim >= 180 ? dim : undefined,
        maxHeight: dim >= 180 ? dim : undefined,
        flexShrink: 0,
        transform: flipPhase ? "scaleX(0)" : "scaleX(1)",
        transition: "transform 200ms ease",
        touchAction: "manipulation",
        ...styleOverride,
      }}
      className={pulse ? "audio-immersive-cover-pulse" : undefined}
      role={onSingleTap ? "button" : undefined}
      tabIndex={onSingleTap ? 0 : undefined}
      aria-label={onSingleTap ? "Cover art" : undefined}
    />
  );
}
