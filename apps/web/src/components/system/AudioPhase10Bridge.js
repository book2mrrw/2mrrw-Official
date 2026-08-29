"use client";

import { useEffect, useRef } from "react";
import { useAudioPlayer } from "@/context/AudioContext";
import { useQueuePreloader } from "@/media/preloader";
import { usePlaybackRecovery } from "@/system/recovery";
import { logStateChurn } from "@/lib/diagnostics/state-churn-log";
import { logRestoredTitleSource } from "@/lib/diagnostics/playback-trace";
import { RECOVERY_PLACEHOLDER_TITLE } from "@/lib/playback/resolve-player-display-title";
import { playbackStateMachine, PLAYBACK_ORCHESTRATION_STATES } from "@/media/PlaybackStateMachine";
import {
  beginContinuitySelectionRestore,
  validateContinuityCandidate,
  proposeContinuitySelectionRestore,
  validateContinuityPositionRestore,
  CONTINUITY_SCHEMA_VERSION,
} from "@/lib/playback/continuity-port";

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

      // Captured now — this IS "restore starts" (INV-CONT-2). Anything the
      // user does between this line and the proposal below (synchronous, but
      // the schema/track-hydration work above already happened async, in
      // useSessionRecovery.js, before this event even fired) makes the
      // proposal below stale and it is denied, not applied (INV-CONT-3/15).
      const restoreCapture = beginContinuitySelectionRestore({ source: "recovery-event" });
      if (!restoreCapture) return; // no Continuity authority installed — fail closed, never guess

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

      // Persisted state is evidence, not truth (INV-CONT-1): the payload
      // already passed recoveryStore.js's own "v1" version gate before this
      // event ever fired, so it is stamped with the current schema version
      // here rather than re-threading a version field through the event
      // payload. Selection restoration uses the SAME atomic
      // RESTORE_SELECTION transition Effect 3 (page-load session restore)
      // uses — this used to call the legacy setQueue command instead, which
      // is the wrong transition for a restore (it has no captured-context
      // staleness gate of its own).
      const { ok, candidate } = validateContinuityCandidate({
        schemaVersion: CONTINUITY_SCHEMA_VERSION,
        persistedAt: detail.savedAt,
        selection: { queue: tracks, queueIndex: detail.queueIndex ?? 0, repeatMode: "off", shuffle: false },
        source: "recovery-event",
      });
      if (!ok) {
        logStateChurn("recovery-setQueue", { source: "AudioPhase10Bridge", reason: "invalid-candidate" });
        return;
      }

      const restoreResult = proposeContinuitySelectionRestore(candidate, restoreCapture);
      if (!restoreResult.accepted) {
        logStateChurn("recovery-setQueue", {
          source: "AudioPhase10Bridge",
          reason: "denied-stale-authority",
          rejectionReason: restoreResult.rejectionReason ?? restoreResult.selectionResult?.rejectionReason,
        });
        return;
      }

      void resumePlaybackTransport();

      if (detail.currentTime > 0) {
        const targetTime = detail.currentTime;
        const targetMediaIdentity = restoreResult.selectionResult.snapshot.nowPlaying
          ? (restoreResult.selectionResult.snapshot.nowPlaying.id ??
             restoreResult.selectionResult.snapshot.nowPlaying.trackId ??
             restoreResult.selectionResult.snapshot.nowPlaying.slug ??
             null)
          : null;

        const isEngineStable = () =>
          hasStartedRef.current &&
          currentTrackRef.current &&
          playbackStateRef.current !== "loading" &&
          playbackStateRef.current !== "ready";

        // A position restore is a proposal, re-validated at the moment it is
        // about to become a physical seek (INV-CONT-6) — not just at the
        // moment the candidate was first accepted. This closes a real gap:
        // the deferred branch below can wait up to 5s for the engine to
        // stabilize, during which the user may have selected something else
        // entirely; without re-validating here, a stale position would have
        // silently seeked whatever track ended up playing instead.
        const attemptSeek = () => {
          const currentIdentity = currentTrackRef.current
            ? (currentTrackRef.current.id ?? currentTrackRef.current.trackId ?? currentTrackRef.current.slug ?? null)
            : null;
          const positionResult = validateContinuityPositionRestore(
            { positionSeconds: targetTime, mediaIdentity: targetMediaIdentity },
            { currentMediaIdentity: currentIdentity, context: restoreCapture.continuityContext },
          );
          if (!positionResult.accepted) {
            logStateChurn("recovery-seek", {
              source: "AudioPhase10Bridge",
              reason: "denied-stale-position",
              rejectionReason: positionResult.rejectionReason,
            });
            return;
          }
          seek(positionResult.position);
        };

        if (isEngineStable()) {
          attemptSeek();
        } else {
          // Subscribe to the formal state machine — fires the moment the engine
          // transitions to a seekable state, with no busy-wait polling.
          let unsubscribeMachine;
          const failsafe = window.setTimeout(() => {
            unsubscribeMachine?.();
            pendingRecoverySeekCleanup = null;
            attemptSeek();
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
              attemptSeek();
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
  }, [resumePlaybackTransport, seek]);

  return null;
}
