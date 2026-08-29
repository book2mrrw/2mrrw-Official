"use client";

import { useEffect, useRef } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { useQueuePreloader } from "@/media/preloader";
import { usePlaybackRecovery } from "@/system/recovery";
import { logStateChurn } from "@/lib/diagnostics/state-churn-log";
import { logRestoredTitleSource } from "@/lib/diagnostics/playback-trace";
import { RECOVERY_PLACEHOLDER_TITLE } from "@/lib/playback/resolve-player-display-title";
import { playbackStateMachine, PLAYBACK_ORCHESTRATION_STATES } from "@/media/PlaybackStateMachine";

function recoveryDisplayTitleFromSlug(id) {
  if (!id || typeof id !== "string") return "Continuing playback";
  const segment = id.includes(":") ? id.split(":").pop() : id;
  const human = String(segment || "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!human) return "Continuing playback";
  return human.replace(/\b\w/g, (c) => c.toUpperCase());
}

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
  const currentTrackRef = useRef(currentTrack);
  const playbackStateRef = useRef(playbackState);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    hasStartedRef.current = hasStarted;
  }, [hasStarted]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    playbackStateRef.current = playbackState;
  }, [playbackState]);

  useQueuePreloader(queue, queueIndex);

  usePlaybackRecovery({
    queue,
    queueIndex,
    getCurrentTime,
    hasStarted,
    onRestore: () => {},
  });

  useEffect(() => {
    let pendingRecoverySeekCleanup = null;

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
              const title = recoveryDisplayTitleFromSlug(id);
              logRestoredTitleSource({
                source: "AudioPhase10Bridge",
                slug: id,
                trackId: id,
                title,
                extra: { path: "recovery-event-fallback" },
              });
              return {
                id,
                slug: id,
                title,
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
        const targetTime = detail.currentTime;

        const isEngineStable = () =>
          hasStartedRef.current &&
          currentTrackRef.current &&
          playbackStateRef.current !== "loading" &&
          playbackStateRef.current !== "ready";

        if (isEngineStable()) {
          seek(targetTime);
        } else {
          // Subscribe to the formal state machine — fires the moment the engine
          // transitions to a seekable state, with no busy-wait polling.
          let unsubscribeMachine;
          const failsafe = window.setTimeout(() => {
            unsubscribeMachine?.();
            pendingRecoverySeekCleanup = null;
            seek(targetTime);
          }, 5000);

          unsubscribeMachine = playbackStateMachine.subscribe((machineState) => {
            if (
              machineState === PLAYBACK_ORCHESTRATION_STATES.PLAYING ||
              machineState === PLAYBACK_ORCHESTRATION_STATES.PAUSED ||
              machineState === PLAYBACK_ORCHESTRATION_STATES.DEGRADED
            ) {
              clearTimeout(failsafe);
              unsubscribeMachine();
              pendingRecoverySeekCleanup = null;
              seek(targetTime);
            }
          });

          pendingRecoverySeekCleanup = () => {
            clearTimeout(failsafe);
            unsubscribeMachine?.();
          };
        }
      }
    };
    window.addEventListener("2mrrw:playback-recovery", handler);
    return () => {
      window.removeEventListener("2mrrw:playback-recovery", handler);
      pendingRecoverySeekCleanup?.();
    };
  }, [dispatchPlaybackCommand, resumePlaybackTransport, seek]);

  return null;
}
