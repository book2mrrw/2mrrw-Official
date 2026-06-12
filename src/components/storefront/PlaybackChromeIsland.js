"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useAudioPlayer } from "@/context/AudioContext";
import {
  isPlaybackTraceEnabled,
  logUiChurn,
} from "@/lib/diagnostics/playback-trace";
import {
  setDismissNowPlayingBridge,
  setPagePlaybackActionsBridge,
} from "@/lib/playback/page-playback-actions-bridge";
import { resolvePlayerDisplayTitle } from "@/lib/playback/resolve-player-display-title";
import AmbientPlaybackBackground from "@/components/home/AmbientPlaybackBackground";
import StorefrontMiniPlayerBar from "@/components/home/StorefrontMiniPlayerBar";
import { commitPlaybackChromeLayout } from "@/lib/storefront/playback-chrome-layout-store";

const PlaybackChromeIsland = memo(function PlaybackChromeIsland({
  isMobile,
  previewModalOpen,
  featureModalOpen,
  albumModalOpen,
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
    shuffle,
    queue,
    error: playbackError,
    continuityFrozen,
    getContinuitySnapshot,
    clearContinuityFreeze,
    enterAudioVisualViewport,
    exitAudioVisualViewport,
    toggle,
    seek,
    seekBack,
    seekForward,
    pause,
    playNext,
    playPrevious,
    toggleShuffle,
  } = useAudioPlayer();

  const [nowPlaying, setNowPlaying] = useState(null);

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
    enterAudioVisualViewport,
    exitAudioVisualViewport,
  ]);

  const prevTrackKeyRef = useRef(null);
  useEffect(() => {
    const nextKey =
      currentTrack?.slug ?? currentTrack?.id ?? currentTrack?.trackId ?? null;
    if (prevTrackKeyRef.current != null && nextKey !== prevTrackKeyRef.current) {
      clearContinuityFreeze?.("playback_chrome_track_change");
    }
    prevTrackKeyRef.current = nextKey;
  }, [currentTrack?.slug, currentTrack?.id, currentTrack?.trackId, clearContinuityFreeze]);

  const dismissNowPlaying = useCallback(() => {
    setNowPlaying(null);
    pause();
  }, [pause]);

  useEffect(() => {
    setDismissNowPlayingBridge(dismissNowPlaying);
    return () => setDismissNowPlayingBridge(null);
  }, [dismissNowPlaying]);

  useEffect(() => {
    if (!continuityFrozen) return;
    const snap = getContinuitySnapshot?.();
    if (!snap) return;
    setNowPlaying((prev) => {
      const frozen = {
        id: snap.trackId,
        slug: snap.slug,
        title: snap.title ?? null,
        artist: snap.artist ?? null,
        album: snap.album ?? null,
        cover: snap.cover?.base ?? "",
      };
      if (prev && prev.slug === frozen.slug && prev.cover === frozen.cover) return prev;
      return frozen;
    });
  }, [continuityFrozen, getContinuitySnapshot]);

  const currentTrackKey =
    currentTrack?.slug ?? currentTrack?.id ?? currentTrack?.trackId ?? null;

  useEffect(() => {
    if (continuityFrozen) return;
    const chromeActive =
      playbackState === "loading" ||
      playbackState === "ready" ||
      playbackState === "playing" ||
      playbackState === "preview_fallback";
    const shouldShowNowPlaying = Boolean(
      currentTrack &&
        !previewModalOpen &&
        !featureModalOpen &&
        !albumModalOpen &&
        (hasStarted || chromeActive)
    );
    if (shouldShowNowPlaying) {
      const title = resolvePlayerDisplayTitle(currentTrack);
      const next =
        title && title !== currentTrack.title
          ? { ...currentTrack, title }
          : currentTrack;
      setNowPlaying((prev) => {
        const prevKey = prev?.slug ?? prev?.id ?? null;
        const nextKey = next?.slug ?? next?.id ?? null;
        if (
          prevKey &&
          nextKey &&
          prevKey === nextKey &&
          prev.cover === next.cover &&
          prev.title === next.title &&
          prev.artist === next.artist
        ) {
          return prev;
        }
        return next;
      });
      return;
    }
    if (!currentTrack || !hasStarted) {
      setNowPlaying((prev) => (prev == null ? prev : null));
    }
  }, [
    continuityFrozen,
    hasStarted,
    currentTrackKey,
    currentTrack?.slug,
    currentTrack?.title,
    currentTrack?.cover,
    currentTrack?.artist,
    playbackState,
    previewModalOpen,
    featureModalOpen,
    albumModalOpen,
  ]);

  useEffect(() => {
    if (!isPlaying || !ambientRefs) return;
    Object.values(ambientRefs.current || {}).forEach((audio) => {
      if (audio && !audio.paused) audio.pause();
    });
  }, [isPlaying, ambientRefs]);

  useEffect(() => {
    if (!isPlaybackTraceEnabled()) return;
    logUiChurn("playback-chrome-island", {
      nowPlaying: nowPlaying?.slug ?? null,
      isPlaying,
      playbackState,
      isMobile,
    });
  }, [nowPlaying?.slug, isPlaying, playbackState, isMobile]);

  const continuitySnap = continuityFrozen ? getContinuitySnapshot?.() : null;
  const nowPlayingMatchesTrack =
    nowPlaying && currentTrack?.slug === nowPlaying.slug;
  const miniPlayerPlaying = continuityFrozen
    ? Boolean(continuitySnap?.isPlaying)
    : Boolean(nowPlayingMatchesTrack && isPlaying);

  const seekToRatio = useCallback(
    (time) => {
      seek(time);
    },
    [seek]
  );

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

  const mobileScrollPadding = isMobile ? (nowPlaying ? "178px" : "110px") : "30px";
  const mobileCartFabBottom = nowPlaying
    ? "calc(62px + env(safe-area-inset-bottom, 0px) + 72px)"
    : "calc(62px + env(safe-area-inset-bottom, 0px) + 12px)";
  const mobileMiniPlayerBottom = "calc(62px + env(safe-area-inset-bottom, 0px) + 8px)";

  useEffect(() => {
    commitPlaybackChromeLayout({
      nowPlaying,
      mobileScrollPadding,
      mobileCartFabBottom,
      mobileMiniPlayerBottom,
    });
  }, [nowPlaying, mobileScrollPadding, mobileCartFabBottom, mobileMiniPlayerBottom]);

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
      {nowPlaying && !isMobile ? (
        <StorefrontMiniPlayerBar
          nowPlaying={nowPlaying}
          isPlaying={miniPlayerPlaying}
          onSeekRatio={seekToRatio}
          onToggle={() => { void toggle(); }}
          onDismiss={dismissNowPlaying}
          onPlayNext={playNext}
          onPlayPrev={playPrevious}
          onSeekForward={seekForward}
          onSeekBack={seekBack}
          onToggleShuffle={toggleShuffle}
          shuffleEnabled={shuffle}
          hasQueue={queue?.length > 1}
          isMobile={false}
        />
      ) : null}
      {isMobile ? (
        <AnimatePresence>
          {nowPlaying ? (
            <StorefrontMiniPlayerBar
              nowPlaying={nowPlaying}
              isPlaying={miniPlayerPlaying}
              onSeekRatio={seekToRatio}
              onToggle={() => { void toggle(); }}
              onDismiss={dismissNowPlaying}
              onPlayNext={playNext}
              onPlayPrev={playPrevious}
              onSeekForward={seekForward}
              onSeekBack={seekBack}
              onToggleShuffle={toggleShuffle}
              shuffleEnabled={shuffle}
              hasQueue={queue?.length > 1}
              isMobile
              bottom={mobileMiniPlayerBottom}
            />
          ) : null}
        </AnimatePresence>
      ) : null}
    </>
  );
});

export default PlaybackChromeIsland;
