"use client";

import { useCallback, useMemo } from "react";
import { useAudioPlayer, usePlaybackProgress } from "@/context/AudioContext";

/**
 * Thin adapter over AudioContext — single playback source for dock + modals.
 * Spreads full AudioContext value; overrides currentTime/duration with progress snapshot.
 */
export function useImmersivePlayback() {
  const audio = useAudioPlayer();
  const { currentTime, duration: progressDuration } = usePlaybackProgress();

  const progress = useMemo(() => {
    const dur = progressDuration || audio.duration;
    if (!dur) return 0;
    return Math.max(0, Math.min(100, (currentTime / dur) * 100));
  }, [currentTime, progressDuration, audio.duration]);

  const handlePlayToggle = useCallback(
    (e) => {
      e?.stopPropagation?.();
      if (audio.streamRetryable && audio.error) {
        void audio.retryStreamPlayback();
        return;
      }
      audio.toggle();
    },
    [audio]
  );

  return {
    ...audio,
    currentTime,
    duration: progressDuration || audio.duration,
    progress,
    handlePlayToggle,
  };
}
