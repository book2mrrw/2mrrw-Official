"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
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
import AmbientPlaybackBackground from "@/components/home/AmbientPlaybackBackground";
import StorefrontMiniPlayerBar from "@/components/home/StorefrontMiniPlayerBar";
import { PlaybackChromeContext } from "@/components/storefront/playback-chrome-context";

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
    hasStarted,
    currentTrack,
    playbackState,
    csMode,
    isPlaying,
    enterAudioVisualViewport,
    exitAudioVisualViewport,
    toggle,
    seek,
    pause,
  } = useAudioPlayer();

  const [nowPlaying, setNowPlaying] = useState(null);

  useEffect(() => {
    setPagePlaybackActionsBridge({
      playTrack,
      playQueue,
      pause,
      toggle,
      seek,
      enterAudioVisualViewport,
      exitAudioVisualViewport,
      currentTrack,
      hasStarted,
      playbackState,
      csMode,
      isPlaying,
    });
    return () => setPagePlaybackActionsBridge(null);
  }, [
    playTrack,
    playQueue,
    pause,
    toggle,
    seek,
    enterAudioVisualViewport,
    exitAudioVisualViewport,
    currentTrack,
    hasStarted,
    playbackState,
    csMode,
    isPlaying,
  ]);

  const dismissNowPlaying = useCallback(() => {
    setNowPlaying(null);
    pause();
  }, [pause]);

  useEffect(() => {
    setDismissNowPlayingBridge(dismissNowPlaying);
    return () => setDismissNowPlayingBridge(null);
  }, [dismissNowPlaying]);

  useEffect(() => {
    const shouldShowNowPlaying = Boolean(
      currentTrack &&
        !previewModalOpen &&
        !featureModalOpen &&
        !albumModalOpen &&
        (hasStarted ||
          playbackState === "loading" ||
          playbackState === "ready" ||
          playbackState === "playing" ||
          playbackState === "preview_fallback")
    );
    if (shouldShowNowPlaying) {
      setNowPlaying(currentTrack);
      return;
    }
    if (!currentTrack || !hasStarted) {
      setNowPlaying(null);
    }
  }, [
    hasStarted,
    currentTrack,
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

  const nowPlayingMatchesTrack =
    nowPlaying && currentTrack?.slug === nowPlaying.slug;
  const miniPlayerPlaying = Boolean(nowPlayingMatchesTrack && isPlaying);

  const seekToRatio = useCallback(
    (time) => {
      seek(time);
    },
    [seek]
  );

  const showAmbient =
    (hasStarted ||
      playbackState === "loading" ||
      playbackState === "ready" ||
      playbackState === "playing" ||
      playbackState === "preview_fallback") &&
    currentTrack?.cover;

  const chromeValue = useMemo(() => {
    const mobileScrollPadding = isMobile ? (nowPlaying ? "178px" : "110px") : "30px";
    const mobileCartFabBottom = nowPlaying
      ? "calc(62px + env(safe-area-inset-bottom, 0px) + 72px)"
      : "calc(62px + env(safe-area-inset-bottom, 0px) + 12px)";
    const mobileMiniPlayerBottom = "calc(62px + env(safe-area-inset-bottom, 0px) + 8px)";
    return {
      nowPlaying,
      mobileScrollPadding,
      mobileCartFabBottom,
      mobileMiniPlayerBottom,
    };
  }, [isMobile, nowPlaying]);

  return (
    <PlaybackChromeContext.Provider value={chromeValue}>
      {children}
      {showAmbient ? (
        <AmbientPlaybackBackground
          currentTrack={currentTrack}
          csMode={csMode}
          isMobile={isMobile}
        />
      ) : null}
      {nowPlaying && !isMobile ? (
        <StorefrontMiniPlayerBar
          nowPlaying={nowPlaying}
          isPlaying={miniPlayerPlaying}
          onSeekRatio={seekToRatio}
          onToggle={() => {
            void toggle();
          }}
          onDismiss={dismissNowPlaying}
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
              onToggle={() => {
                void toggle();
              }}
              onDismiss={dismissNowPlaying}
              isMobile
              bottom={chromeValue.mobileMiniPlayerBottom}
            />
          ) : null}
        </AnimatePresence>
      ) : null}
    </PlaybackChromeContext.Provider>
  );
});

export default PlaybackChromeIsland;
