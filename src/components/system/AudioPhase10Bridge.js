"use client";

import { useEffect } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { useQueuePreloader } from "@/media/preloader";
import { usePlaybackRecovery } from "@/system/recovery";

/**
 * Wires queue preloading + playback persistence without bloating AudioContext.
 */
export default function AudioPhase10Bridge() {
  const { queue, queueIndex, currentTime, hasStarted, setQueue, seek } = useAudioPlayer();

  useQueuePreloader(queue, queueIndex);

  usePlaybackRecovery({
    queue,
    queueIndex,
    currentTime,
    hasStarted,
    onRestore: () => {},
  });

  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail;
      if (!detail?.queueIds?.length) return;
      const tracks =
        Array.isArray(detail.tracks) && detail.tracks.length
          ? detail.tracks
          : detail.queueIds.map((id) => ({
              id,
              slug: id,
              title: "Restored",
              src: `/api/library/stream?slug=${encodeURIComponent(id)}`,
            }));
      setQueue(tracks, detail.queueIndex ?? 0);
      if (detail.currentTime > 0) {
        seek(detail.currentTime);
      }
    };
    window.addEventListener("2mrrw:playback-recovery", handler);
    return () => window.removeEventListener("2mrrw:playback-recovery", handler);
  }, [setQueue, seek]);

  return null;
}
