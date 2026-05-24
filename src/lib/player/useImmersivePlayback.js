"use client";

import { useCallback, useMemo } from "react";
import { useAudioPlayer } from "@/context/AudioContext";

/**
 * Thin adapter over AudioContext — single playback source for dock + modals.
 */
export function useImmersivePlayback() {
  const audio = useAudioPlayer();

  const progress = useMemo(() => {
    if (!audio.duration) return 0;
    return Math.max(0, Math.min(100, (audio.currentTime / audio.duration) * 100));
  }, [audio.currentTime, audio.duration]);

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
    progress,
    handlePlayToggle,
  };
}
