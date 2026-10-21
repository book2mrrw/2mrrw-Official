"use client";

import { playbackStateMachine, PLAYBACK_ORCHESTRATION_EVENTS } from "@/media/PlaybackStateMachine";
import { PLAYBACK_COMMANDS } from "@/lib/playback/playback-commands";
import { PhysicalEffectAuthorityMode } from "@/lib/audio/physical-effect-authority";
import { recordAudioContextState } from "@/lib/dev/performanceMarks";
import {
  isLibraryStreamSrc,
  parseStreamSlugFromSrc,
} from "@/lib/playback/stream-client";
import {
  waitAudioSrcReady,
  playAudioIfNotPaused,
} from "@/lib/audio/audio-element-utils";
import {
  resumeWebAudioContextIfSuspended,
  ensureWebAudioRunning,
} from "@/lib/audio/web-audio-context-utils";
import { isEntitledFullPlaybackTrack } from "@/lib/playback/playback-track-utils";
import { logPlayback } from "@/lib/observability/client-log";
import { logPlaybackResilience } from "@/lib/diagnostics/state-churn-log";
import {
  isPlaybackTraceEnabled,
  logPlaybackEvent,
  logBackgroundRecoveryTrigger,
  logBackgroundRecoverySkipped,
  logPlaybackContinuityLost,
  logLifecycleTransportHealthy,
  logLifecycleTransportFailed,
  logLifecycleRecoverySuppressed,
  logLifecycleRecoveryAllowed,
  logRecoveryPathClassification,
} from "@/lib/diagnostics/playback-trace";
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";
import {
  evaluatePlaybackTransportHealth,
  isGenuineTransportFailureReason,
  isLifecycleInterruptReason,
} from "@/lib/playback/playback-transport-utils";

import { captureRecoveryOperation } from "./recovery-operation";

const RECOVERY_COOLDOWN_MS = 6000;
const LIFECYCLE_RECOVERY_LOCK_MS = 4000;
const BFCACHE_RECOVERY_TIMEOUT_MS = 5000;
// Global symbol shared with WebAudioEngine — preserves the bound-source flag across recovery.

/**
 * Attaches Group 2 (recovery) commands to the shared `self` service object.
 */
export function attachRecoveryCommands(self) {
  self.recoverAudioHard = async function recoverAudioHard(reason, { resumeAfter = false } = {}) {
    const d = self._deps;
    const { audioRef, stateRef, isRecoveringRef, recoveryCooldownUntilRef, patchState } = d;
    if (isRecoveringRef.current || d.recoveryVerificationRef?.current ||
        Date.now() < recoveryCooldownUntilRef.current) return false;
    const operation = captureRecoveryOperation(d);
    const { audio, track, isCurrent } = operation;
    if (!audio || !track?.src || !isCurrent() || audio.ended) return false;
    if (d.blockRecoveryForLifecycleOsSuspended("recoverAudioHard", reason)) return false;

    isRecoveringRef.current = true;
    d.internalPlaybackAuthorityRef.current = true;
    const position = audio.currentTime;
    try {
      d.tracePlayback("recoverAudioHard", "recoverAudioHard", { reason, resumeAfter, slug: track.slug });
      // An output interruption is not a source failure. Retain the element,
      // source, graph and playhead; only failed/detached transports need reload.
      const transport = evaluatePlaybackTransportHealth(audio, track);
      if (!transport.intact) {
        patchState({ isPlaying: false, playbackState: "recovering", isBuffering: true, error: null });
        let src = track.src;
        if (isLibraryStreamSrc(src)) {
          const resolved = await d.resolveLibraryStreamForTrack(track, {
            force: true, signal: d.activeStreamAbortRef.current?.signal,
          });
          if (!isCurrent()) return false;
          src = resolved.track.src;
        }
        if (!isCurrent()) return false;
        d.skipPauseInterruptionRef.current = true;
        await waitAudioSrcReady(audio, src, { signal: d.activeStreamAbortRef.current?.signal });
        if (!isCurrent()) return false;
        // resumeAfter is a boolean, never a saved position.
        if (Number.isFinite(position) && position > 0) {
          audio.currentTime = Number.isFinite(audio.duration) && audio.duration > 0
            ? Math.min(position, Math.max(0, audio.duration - 0.05)) : position;
        }
        patchState({ currentTrack: { ...track, src }, currentTrackId: track.id || track.trackId || null });
      }
      if (!isCurrent()) return false;
      if (!resumeAfter) {
        if (!audio.paused) return false;
        patchState({ isPlaying: false, playbackState: "paused", isBuffering: false, playbackNetworkState: "idle" });
        return true;
      }
      // Continuing intent comes from the recovery request + Core's physical
      // effect authority, not isPlaying (which an interruption already cleared).
      const recovered = await d.attemptLightweightPlaybackResume(reason, {
        effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
      });
      if (!isCurrent()) return false;
      if (!recovered || audio.paused || audio.ended ||
          (d.audioCtxRef.current && d.audioCtxRef.current.state !== "running")) {
        patchState({ isPlaying: false, playbackState: "paused", isBuffering: false,
          playbackNetworkState: "error_stream", streamRetryable: true,
          error: "Playback interrupted — tap play to continue." });
        return false;
      }
      patchState({ isPlaying: true, playbackState: "playing", isBuffering: false,
        playbackNetworkState: "playing", error: null, streamRetryable: false });
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      reportPlaybackDiagnostic({ code: "RECOVER_AUDIO_HARD_FAILED", command: PLAYBACK_COMMANDS.RECOVER,
        state: stateRef.current, error, context: { reason } });
      patchState({ isPlaying: false, playbackState: "paused", isBuffering: false,
        playbackNetworkState: "error_stream", streamRetryable: true,
        error: "Playback interrupted — tap play to continue." });
      return false;
    } finally {
      recoveryCooldownUntilRef.current = Date.now() + RECOVERY_COOLDOWN_MS;
      isRecoveringRef.current = false;
      d.internalPlaybackAuthorityRef.current = false;
    }
  };

  self.releaseLifecycleRecoveryLock = function releaseLifecycleRecoveryLock(lockId) {
    const { lifecycleRecoveryLockTimerRef, lifecycleRecoveryLockIdRef, lifecycleRecoveryLockRef } = self._deps;
    if (lifecycleRecoveryLockTimerRef.current) {
      clearTimeout(lifecycleRecoveryLockTimerRef.current);
      lifecycleRecoveryLockTimerRef.current = null;
    }
    if (lifecycleRecoveryLockIdRef.current === lockId) {
      lifecycleRecoveryLockRef.current = false;
    }
  };

  self.clearBfcacheRecoveryInProgress = function clearBfcacheRecoveryInProgress() {
    const { bfcacheRecoveryInProgressRef, bfcacheRecoveryTimeoutRef } = self._deps;
    bfcacheRecoveryInProgressRef.current = false;
    if (bfcacheRecoveryTimeoutRef.current) {
      clearTimeout(bfcacheRecoveryTimeoutRef.current);
      bfcacheRecoveryTimeoutRef.current = null;
    }
  };

  self.beginBfcacheRecoveryInProgress = function beginBfcacheRecoveryInProgress() {
    const { bfcacheRecoveryInProgressRef, bfcacheRecoveryTimeoutRef } = self._deps;
    self.clearBfcacheRecoveryInProgress();
    bfcacheRecoveryInProgressRef.current = true;
    bfcacheRecoveryTimeoutRef.current = setTimeout(() => {
      self.clearBfcacheRecoveryInProgress();
    }, BFCACHE_RECOVERY_TIMEOUT_MS);
  };

  self.requestPlaybackRecovery = function requestPlaybackRecovery(event, payload) {
    const {
      armLifecycleRecoverySuppression, attemptLightweightPlaybackResume,
      blockRecoveryForLifecycleOsSuspended, computeLifecycleAudioTruthState,
      getPlaybackTransportHealth, isLifecycleRecoverySuppressed,
      stateRef, userPausedRef, playbackIntentBeforeHideRef, recoveryInFlightRef,
    } = self._deps;

    const reason = payload?.reason ?? String(event);
    const isHardOrchestration =
      event === PLAYBACK_ORCHESTRATION_EVENTS.RECOVERY_REQUESTED ||
      event === PLAYBACK_ORCHESTRATION_EVENTS.AUDIO_DESYNC_DETECTED;

    computeLifecycleAudioTruthState();
    if (
      isHardOrchestration &&
      blockRecoveryForLifecycleOsSuspended("requestPlaybackRecovery", reason)
    ) {
      logRecoveryPathClassification({
        path: "no_op",
        reason: "os_suspended_ignored",
        transportIntact: getPlaybackTransportHealth().intact,
        lifecycleIntent: playbackIntentBeforeHideRef.current,
        userPaused: userPausedRef.current,
        resumeAfter: Boolean(payload?.resumeAfter),
        source: "requestPlaybackRecovery",
        slug: stateRef.current.currentTrack?.slug ?? null,
      });
      return Promise.resolve(false);
    }

    if (recoveryInFlightRef.current) {
      if (isPlaybackTraceEnabled()) {
        logPlaybackEvent({
          type: "recovery-dedup",
          source: reason,
          extra: { event },
        });
      }
      logPlayback("recovery_dedup_blocked", {
        reason,
        event: String(event),
      });
      return Promise.resolve(false);
    }

    if (
      isHardOrchestration &&
      isLifecycleRecoverySuppressed(reason) &&
      !isGenuineTransportFailureReason(reason)
    ) {
      logLifecycleRecoverySuppressed({
        source: "requestPlaybackRecovery",
        event: String(event),
        reason,
        slug: stateRef.current.currentTrack?.slug ?? null,
      });
      logRecoveryPathClassification({
        path: "lightweight",
        reason: "recovery_suppressed_lifecycle",
        transportIntact: getPlaybackTransportHealth().intact,
        lifecycleIntent: playbackIntentBeforeHideRef.current,
        userPaused: userPausedRef.current,
        resumeAfter: Boolean(payload?.resumeAfter),
        source: "requestPlaybackRecovery",
        slug: stateRef.current.currentTrack?.slug ?? null,
      });
      return attemptLightweightPlaybackResume(
        `recovery_suppressed:${reason}`,
        { effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT },
      ).then(
        (lightOk) => {
          if (lightOk) {
            armLifecycleRecoverySuppression("requestPlaybackRecovery", reason);
          }
          return lightOk;
        }
      );
    }

    if (isHardOrchestration && isPlaybackTraceEnabled()) {
      logLifecycleRecoveryAllowed({
        source: "requestPlaybackRecovery",
        event: String(event),
        reason,
        slug: stateRef.current.currentTrack?.slug ?? null,
      });
    }

    recoveryInFlightRef.current = true;
    const result = playbackStateMachine.transition(event, payload);
    return Promise.resolve(result).finally(() => {
      recoveryInFlightRef.current = false;
    });
  };

  self.runCoalescedLifecycleRecovery = function runCoalescedLifecycleRecovery({ reason, resumeAfter, trigger }) {
    const {
      armLifecycleRecoverySuppression, attemptLightweightPlaybackResume,
      blockRecoveryForLifecycleOsSuspended, computeLifecycleAudioTruthState,
      evaluateLifecyclePlaybackHealth, getPlaybackTransportHealth,
      syncMediaSessionAfterLifecycle,
      stateRef, userPausedRef, userIntentPausedRef,
      playbackIntentBeforeHideRef, lifecycleRecoveryLockRef,
      lifecycleRecoveryLockIdRef, lifecycleRecoveryLockTimerRef,
    } = self._deps;

    computeLifecycleAudioTruthState();
    if (
      blockRecoveryForLifecycleOsSuspended(trigger, reason) &&
      !isGenuineTransportFailureReason(reason)
    ) {
      logRecoveryPathClassification({
        path: "no_op",
        reason: "os_suspended_ignored",
        transportIntact: getPlaybackTransportHealth().intact,
        lifecycleIntent: playbackIntentBeforeHideRef.current,
        userPaused: userPausedRef.current,
        resumeAfter,
        source: trigger,
        slug: stateRef.current.currentTrack?.slug ?? null,
      });
      return Promise.resolve(true);
    }

    if (lifecycleRecoveryLockRef.current) {
      if (isPlaybackTraceEnabled()) {
        logPlaybackEvent({
          type: "lifecycle-recovery-dedup",
          source: trigger,
          extra: { reason, blockedBy: "lifecycle_lock" },
        });
      }
      logPlayback("lifecycle_recovery_dedup_blocked", { trigger, reason });
      return Promise.resolve(false);
    }

    const lockId = lifecycleRecoveryLockIdRef.current + 1;
    lifecycleRecoveryLockIdRef.current = lockId;
    lifecycleRecoveryLockRef.current = true;
    lifecycleRecoveryLockTimerRef.current = setTimeout(() => {
      self.releaseLifecycleRecoveryLock(lockId);
    }, LIFECYCLE_RECOVERY_LOCK_MS);

    if (trigger === "bfcache_restore") {
      self.beginBfcacheRecoveryInProgress();
      if (isPlaybackTraceEnabled()) {
        logPlaybackEvent({
          type: "bfcache-restore",
          source: "pageshow",
          extra: { reason, resumeAfter },
        });
      }
      logPlayback("bfcache_restore_recovery", { reason, resumeAfter });
    } else if (isPlaybackTraceEnabled()) {
      logPlaybackEvent({
        type: "visibility-recovery",
        source: trigger,
        extra: { reason, resumeAfter },
      });
    }

    const runHardRecovery = () => {
      const transport = getPlaybackTransportHealth();
      if (
        transport.intact &&
        isLifecycleInterruptReason(reason) &&
        !isGenuineTransportFailureReason(reason)
      ) {
        logLifecycleRecoverySuppressed({
          source: trigger,
          reason,
          resumeAfter,
          slug: stateRef.current.currentTrack?.slug ?? null,
          path: "coalesced_skip_hard",
        });
        logRecoveryPathClassification({
          path: "no_op",
          reason: "coalesced_skip_hard_lifecycle",
          transportIntact: transport.intact,
          lifecycleIntent: playbackIntentBeforeHideRef.current,
          userPaused: userPausedRef.current,
          resumeAfter,
          source: trigger,
          slug: stateRef.current.currentTrack?.slug ?? null,
        });
        armLifecycleRecoverySuppression(trigger, reason);
        playbackIntentBeforeHideRef.current = false;
        return Promise.resolve(true);
      }
      logLifecycleTransportFailed({
        source: trigger,
        reason: transport.reason || reason,
        resumeAfter,
        slug: stateRef.current.currentTrack?.slug ?? null,
      });
      logLifecycleRecoveryAllowed({
        source: trigger,
        reason,
        resumeAfter,
        slug: stateRef.current.currentTrack?.slug ?? null,
      });
      logRecoveryPathClassification({
        path: "hard",
        reason: transport.reason || reason,
        transportIntact: false,
        lifecycleIntent: playbackIntentBeforeHideRef.current,
        userPaused: userPausedRef.current,
        resumeAfter,
        source: trigger,
        slug: stateRef.current.currentTrack?.slug ?? null,
      });
      return self.requestPlaybackRecovery(PLAYBACK_ORCHESTRATION_EVENTS.RECOVERY_REQUESTED, {
        reason,
        resumeAfter,
      });
    };

    const recoveryPromise = (async () => {
      const transport = getPlaybackTransportHealth();
      if (!transport.intact) {
        logLifecycleTransportFailed({
          source: trigger,
          reason: transport.reason,
          resumeAfter,
          slug: stateRef.current.currentTrack?.slug ?? null,
        });
      }

      if (resumeAfter && !userPausedRef.current && !userIntentPausedRef.current) {
        logBackgroundRecoveryTrigger({
          source: trigger,
          reason,
          slug: stateRef.current.currentTrack?.slug ?? null,
        });
        const lightOk = await attemptLightweightPlaybackResume(
          trigger,
          { effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT },
        );
        if (lightOk) {
          const health = evaluateLifecyclePlaybackHealth({
            resumeAfter: true,
            lifecycleIntent: false,
          });
          if (health.healthy) {
            logBackgroundRecoverySkipped({
              source: trigger,
              reason: health.reason,
              path: "lightweight",
              slug: stateRef.current.currentTrack?.slug ?? null,
            });
            logRecoveryPathClassification({
              path: "lightweight",
              reason: health.reason,
              transportIntact: transport.intact,
              lifecycleIntent: false,
              userPaused: userPausedRef.current,
              resumeAfter,
              source: trigger,
              slug: stateRef.current.currentTrack?.slug ?? null,
            });
            logLifecycleTransportHealthy({
              source: trigger,
              reason: health.reason,
              resumeAfter,
              slug: stateRef.current.currentTrack?.slug ?? null,
            });
            armLifecycleRecoverySuppression(trigger, health.reason);
            playbackIntentBeforeHideRef.current = false;
            await syncMediaSessionAfterLifecycle(true);
            return true;
          }
        } else if (transport.intact && isLifecycleInterruptReason(reason)) {
          logLifecycleTransportHealthy({
            source: trigger,
            reason: "lightweight_incomplete_transport_intact",
            resumeAfter,
            slug: stateRef.current.currentTrack?.slug ?? null,
          });
          logRecoveryPathClassification({
            path: "no_op",
            reason: "lightweight_incomplete_transport_intact",
            transportIntact: true,
            lifecycleIntent: playbackIntentBeforeHideRef.current,
            userPaused: userPausedRef.current,
            resumeAfter,
            source: trigger,
            slug: stateRef.current.currentTrack?.slug ?? null,
          });
          armLifecycleRecoverySuppression(trigger, reason);
          playbackIntentBeforeHideRef.current = false;
          await syncMediaSessionAfterLifecycle(resumeAfter);
          return true;
        } else {
          logPlaybackContinuityLost({
            source: trigger,
            reason,
            slug: stateRef.current.currentTrack?.slug ?? null,
          });
        }
      } else if (!resumeAfter && transport.intact) {
        logLifecycleTransportHealthy({
          source: trigger,
          reason: "transport_ok_paused",
          resumeAfter,
          slug: stateRef.current.currentTrack?.slug ?? null,
        });
        armLifecycleRecoverySuppression(trigger, reason);
        playbackIntentBeforeHideRef.current = false;
        await syncMediaSessionAfterLifecycle(false);
        return true;
      }
      return runHardRecovery();
    })();

    return Promise.resolve(recoveryPromise).finally(() => {
      self.releaseLifecycleRecoveryLock(lockId);
      if (trigger === "bfcache_restore") {
        self.clearBfcacheRecoveryInProgress();
      }
    });
  };

  self.resumePlaybackTransport = async function resumePlaybackTransport() {
    const {
      initWebAudio, patchState, resolveLibraryStreamForTrack,
      stateRef, audioRef, audioCtxRef, queueRef, queueIndexRef,
      skipPauseInterruptionRef, activeStreamAbortRef, internalPlaybackAuthorityRef,
    } = self._deps;

    internalPlaybackAuthorityRef.current = true;
    try {
      const queue = queueRef.current;
      const idx = queueIndexRef.current >= 0 ? queueIndexRef.current : 0;
      const track = stateRef.current.currentTrack || queue[idx];
      const audio = audioRef.current;
      if (!audio || !track?.src) return false;

      if (stateRef.current.hasStarted && stateRef.current.currentTrack) {
        return playbackStateMachine.transition(
          PLAYBACK_ORCHESTRATION_EVENTS.RECOVERY_REQUESTED,
          { reason: "session_recovery_transport", resumeAfter: false }
        );
      }

      initWebAudio();
      await resumeWebAudioContextIfSuspended(audioCtxRef);
      recordAudioContextState(audioCtxRef.current, "resumePlaybackTransport");

      let src = track.src;
      if (isEntitledFullPlaybackTrack(track) && isLibraryStreamSrc(src)) {
        try {
          const resolved = await resolveLibraryStreamForTrack(track, { force: false });
          src = resolved.track?.src || src;
        } catch {
          /* keep queue placeholder src */
        }
      }

      skipPauseInterruptionRef.current = true;
      audio.pause();
      await waitAudioSrcReady(audio, src);
      patchState({
        currentTrack: { ...track, src },
        currentTrackId: track.id || track.trackId || null,
        isPlaying: false,
        playbackState: "ready",
        hasStarted: false,
        isBuffering: false,
        playbackNetworkState: "idle",
      });
      return true;
    } finally {
      self._deps.internalPlaybackAuthorityRef.current = false;
    }
  };
}
