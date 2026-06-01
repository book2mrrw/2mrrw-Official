"use client";

import { useEffect, useRef } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { useQueuePreloader } from "@/media/preloader";
import { usePlaybackRecovery } from "@/system/recovery";
import { logStateChurn } from "@/lib/diagnostics/state-churn-log";

/**
 * Wires queue preloading + playback persistence without bloating AudioContext.
 */
export default function AudioPhase10Bridge() {
  const { queue, queueIndex, getCurrentTime, hasStarted, currentTrack, playbackState, setQueue, seek } = useAudioPlayer();
  const queueRef = useRef(queue);
  const hasStartedRef = useRef(hasStarted);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    hasStartedRef.current = hasStarted;
  }, [hasStarted]);

  useQueuePreloader(queue, queueIndex);

  usePlaybackRecovery({
    queue,
    queueIndex,
    getCurrentTime,
    hasStarted,
    onRestore: () => {},
  });

  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail;
      if (!detail?.queueIds?.length) return;

      const activeQueue = Array.isArray(queueRef.current) ? queueRef.current : [];
      if (hasStartedRef.current || activeQueue.length > 0) {
        logStateChurn("recovery-setQueue", {
          source: "AudioPhase10Bridge",
          reason: "skipped-active-session",
          hasStarted: hasStartedRef.current,
          queueLength: activeQueue.length,
        });
        return;
      }

      const tracks =
        Array.isArray(detail.tracks) && detail.tracks.length
          ? detail.tracks
          : detail.queueIds.map((id) => ({
              id,
              slug: id,
              title: "Restored",
              src: `/api/library/stream?slug=${encodeURIComponent(id)}`,
            }));
      logStateChurn("recovery-setQueue", {
        source: "AudioPhase10Bridge",
        reason: "restore-abandoned-session",
        trackCount: tracks.length,
      });
      setQueue(tracks, detail.queueIndex ?? 0);
      if (detail.currentTime > 0) {
        let attempts = 0;
        const trySeekWhenStable = () => {
          attempts += 1;
          const shouldDefer =
            !hasStarted ||
            !currentTrack ||
            playbackState === "loading" ||
            playbackState === "ready";
          if (!shouldDefer || attempts > 40) {
            seek(detail.currentTime);
            return;
          }
          window.setTimeout(trySeekWhenStable, 75);
        };
        trySeekWhenStable();
      }
    };
    window.addEventListener("2mrrw:playback-recovery", handler);
    return () => window.removeEventListener("2mrrw:playback-recovery", handler);
  }, [setQueue, seek, hasStarted, currentTrack, playbackState]);

  return null;
}
