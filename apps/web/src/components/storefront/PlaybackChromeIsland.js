"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import {
  isPlaybackTraceEnabled,
  logUiChurn,
} from "@/lib/diagnostics/playback-trace";
import {
  setPagePlaybackActionsBridge,
} from "@/lib/playback/page-playback-actions-bridge";
import AmbientPlaybackBackground from "@/components/home/AmbientPlaybackBackground";
import { commitPlaybackChromeLayout } from "@/lib/storefront/playback-chrome-layout-store";

const PlaybackChromeIsland = memo(function PlaybackChromeIsland({
  isMobile,
  ambientRefs,
  children,
}) {
  const {
    playTrack,
    playQueue,
    dispatchPlaybackCommand,
    hasStarted,
    currentTrack,
    playbackState,
    csMode,
    isPlaying,
    error: playbackError,
    continuityFrozen,
    getContinuitySnapshot,
    clearContinuityFreeze,
    enterAudioVisualViewport,
    exitAudioVisualViewport,
    toggle,
    seek,
    pause,
    setRepeatMode,
  } = useAudioPlayer();

  // Refs for state fields read imperatively via bridge — avoids bridge cleanup/setup on every track switch.
  const currentTrackRef = useRef(currentTrack);
  const hasStartedRef = useRef(hasStarted);
  const playbackStateRef = useRef(playbackState);
  const csModeRef = useRef(csMode);
  const isPlayingRef = useRef(isPlaying);
  const playbackErrorRef = useRef(playbackError);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { hasStartedRef.current = hasStarted; }, [hasStarted]);
  useEffect(() => { playbackStateRef.current = playbackState; }, [playbackState]);
  useEffect(() => { csModeRef.current = csMode; }, [csMode]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { playbackErrorRef.current = playbackError; }, [playbackError]);

  useEffect(() => {
    setPagePlaybackActionsBridge({
      playTrack,
      playQueue,
      dispatchPlaybackCommand,
      pause,
      toggle,
      seek,
      setRepeatMode,
      enterAudioVisualViewport,
      exitAudioVisualViewport,
      get currentTrack() { return currentTrackRef.current; },
      get hasStarted() { return hasStartedRef.current; },
      get playbackState() { return playbackStateRef.current; },
      get csMode() { return csModeRef.current; },
      get isPlaying() { return isPlayingRef.current; },
      get error() { return playbackErrorRef.current; },
    });
    return () => setPagePlaybackActionsBridge(null);
  }, [
    playTrack,
    playQueue,
    dispatchPlaybackCommand,
    pause,
    toggle,
    seek,
    setRepeatMode,
    enterAudioVisualViewport,
    exitAudioVisualViewport,
  ]);

  // Clear continuity freeze on track change so the engine resumes with fresh state.
  const prevTrackKeyRef = useRef(null);
  useEffect(() => {
    const nextKey =
      currentTrack?.slug ?? currentTrack?.id ?? currentTrack?.trackId ?? null;
    if (prevTrackKeyRef.current != null && nextKey !== prevTrackKeyRef.current) {
      clearContinuityFreeze?.("playback_chrome_track_change");
    }
    prevTrackKeyRef.current = nextKey;
  }, [currentTrack?.slug, currentTrack?.id, currentTrack?.trackId, clearContinuityFreeze]);

  // Pause ambient audio elements when music starts playing.
  useEffect(() => {
    if (!isPlaying || !ambientRefs) return;
    Object.values(ambientRefs.current || {}).forEach((audio) => {
      if (audio && !audio.paused) audio.pause();
    });
  }, [isPlaying, ambientRefs]);

  useEffect(() => {
    if (!isPlaybackTraceEnabled()) return;
    logUiChurn("playback-chrome-island", {
      isPlaying,
      playbackState,
      isMobile,
    });
  }, [isPlaying, playbackState, isMobile]);

  // Commit stable layout values — scroll padding accounts for GlobalAudioPlayerBar height only.
  const mobileScrollPadding = isMobile ? "110px" : "30px";
  const mobileCartFabBottom = "calc(62px + env(safe-area-inset-bottom, 0px) + 12px)";
  useEffect(() => {
    commitPlaybackChromeLayout({ mobileScrollPadding, mobileCartFabBottom });
  }, [mobileScrollPadding, mobileCartFabBottom]);

  const continuitySnap = continuityFrozen ? getContinuitySnapshot?.() : null;

  const ambientTrack = useMemo(() => {
    if (!continuityFrozen || !continuitySnap) return currentTrack;
    return {
      ...(currentTrack || {}),
      cover: continuitySnap.cover?.base ?? currentTrack?.cover,
      coverArtType:
        continuitySnap.cover?.baseArtType ?? currentTrack?.coverArtType,
      csCover: continuitySnap.cover?.cs ?? currentTrack?.csCover,
      csCoverType:
        continuitySnap.cover?.csArtType ?? currentTrack?.csCoverType,
    };
  }, [continuityFrozen, continuitySnap, currentTrack]);

  const showAmbient =
    (hasStarted ||
      playbackState === "loading" ||
      playbackState === "ready" ||
      playbackState === "playing" ||
      playbackState === "preview_fallback") &&
    ambientTrack?.cover;

  return (
    <>
      {children}
      {showAmbient ? (
        <AmbientPlaybackBackground
          currentTrack={ambientTrack}
          csMode={csMode}
          isMobile={isMobile}
        />
      ) : null}
    </>
  );
});

export default PlaybackChromeIsland;
