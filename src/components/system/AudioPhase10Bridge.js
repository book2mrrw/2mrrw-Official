"use client";

import { useEffect, useRef } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { useQueuePreloader } from "@/media/preloader";
import { usePlaybackRecovery } from "@/system/recovery";
import { logStateChurn } from "@/lib/diagnostics/state-churn-log";
import { logRestoredTitleSource } from "@/lib/diagnostics/playback-trace";
import { RECOVERY_PLACEHOLDER_TITLE } from "@/lib/playback/resolve-player-display-title";

/**
 * Wires queue preloading + playback persistence without bloating AudioContext.
 */
export default function AudioPhase10Bridge() {
  const {
    queue,
    queueIndex,
    getCurrentTime,
    hasStarted,
    currentTrack,
    playbackState,
    dispatchPlaybackCommand,
    resumePlaybackTransport,
    seek,
  } = useAudioPlayer();
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
          : detail.queueIds.map((id) => {
              logRestoredTitleSource({
                source: "AudioPhase10Bridge",
                slug: id,
                trackId: id,
                title: RECOVERY_PLACEHOLDER_TITLE,
                extra: { path: "recovery-event-fallback" },
              });
              return {
                id,
                slug: id,
                title: RECOVERY_PLACEHOLDER_TITLE,
                src: `/api/library/stream?slug=${encodeURIComponent(id)}`,
              };
            });
      tracks.forEach((t) => {
        if (t?.title === RECOVERY_PLACEHOLDER_TITLE) {
          logRestoredTitleSource({
            source: "AudioPhase10Bridge",
            slug: t.slug ?? null,
            trackId: t.id ?? null,
            title: t.title,
            extra: { path: "recovery-event-tracks" },
          });
        }
      });
      logStateChurn("recovery-setQueue", {
        source: "AudioPhase10Bridge",
        reason: "restore-abandoned-session",
        trackCount: tracks.length,
      });
      void dispatchPlaybackCommand("setQueue", {
        tracks,
        startIndex: detail.queueIndex ?? 0,
      }).then(() => resumePlaybackTransport());
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
  }, [dispatchPlaybackCommand, resumePlaybackTransport, seek, hasStarted, currentTrack, playbackState]);

  return null;
}
