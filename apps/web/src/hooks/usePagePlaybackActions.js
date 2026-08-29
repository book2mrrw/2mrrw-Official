"use client";

import { useMemo } from "react";
import { getPagePlaybackActionsBridge } from "@/lib/playback/page-playback-actions-bridge";

/**
 * Stable playback actions for Page — does not subscribe to AudioContext render churn.
 */
export function usePagePlaybackActions() {
  return useMemo(
    () => ({
      playTrack: (...args) => getPagePlaybackActionsBridge()?.playTrack?.(...args),
      playQueue: (...args) => getPagePlaybackActionsBridge()?.playQueue?.(...args),
      pause: () => getPagePlaybackActionsBridge()?.pause?.(),
      toggle: () => getPagePlaybackActionsBridge()?.toggle?.(),
      seek: (...args) => getPagePlaybackActionsBridge()?.seek?.(...args),
      hintUpcomingPlay: (...args) => getPagePlaybackActionsBridge()?.hintUpcomingPlay?.(...args),
      enterAudioVisualViewport: () =>
        getPagePlaybackActionsBridge()?.enterAudioVisualViewport?.(),
      exitAudioVisualViewport: () =>
        getPagePlaybackActionsBridge()?.exitAudioVisualViewport?.(),
      getCurrentTrack: () => getPagePlaybackActionsBridge()?.currentTrack ?? null,
      getHasStarted: () => getPagePlaybackActionsBridge()?.hasStarted ?? false,
      getPlaybackState: () => getPagePlaybackActionsBridge()?.playbackState ?? "idle",
      getCsMode: () => getPagePlaybackActionsBridge()?.csMode ?? false,
      getIsPlaying: () => getPagePlaybackActionsBridge()?.isPlaying ?? false,
    }),
    []
  );
}
