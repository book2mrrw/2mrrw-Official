"use client";

import { useCallback, useMemo } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { useMediaEngine } from "@/media/useMediaEngine";

/**
 * Thin adapter over AudioContext — single playback source for dock + modals.
 * Delegates core transport to useMediaEngine; spreads full context for stream/CS extras.
 */
export function useImmersivePlayback() {
  const audio = useAudioPlayer();
  const { state: engineState, toggle: engineToggle } = useMediaEngine();

  const progress = useMemo(() => {
    if (!engineState.duration) return 0;
    return Math.max(0, Math.min(100, (engineState.currentTime / engineState.duration) * 100));
  }, [engineState.currentTime, engineState.duration]);

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
    progress,
    handlePlayToggle,
  };
}
