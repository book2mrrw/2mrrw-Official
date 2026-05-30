"use client";

import { useCallback, useMemo } from "react";
import { useAudioPlayer, usePlaybackProgress } from "@/context/AudioContext";
import { useMediaEngine } from "@/media/useMediaEngine";

/**
 * Thin adapter over AudioContext — single playback source for dock + modals.
 * Delegates core transport to useMediaEngine; spreads full context for stream/CS extras.
 */
export function useImmersivePlayback() {
  const audio = useAudioPlayer();
  const { currentTime, duration: progressDuration } = usePlaybackProgress();
  const { state: engineState, toggle: engineToggle } = useMediaEngine();

  const progress = useMemo(() => {
    const dur = progressDuration || engineState.duration;
    if (!dur) return 0;
    return Math.max(0, Math.min(100, (currentTime / dur) * 100));
  }, [currentTime, progressDuration, engineState.duration]);

  const handlePlayToggle = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (audio.streamRetryable && audio.error) {
        void audio.retryStreamPlayback();
        return;
      }
      engineToggle();
    },
    [audio, engineToggle]
  );

  return {
    ...audio,
    currentTime,
    duration: progressDuration || audio.duration,
    progress,
    handlePlayToggle,
  };
}
