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
  clampRestorePosition,
  waitAudioSrcReady,
  playAudioIfNotPaused,
} from "@/lib/audio/audio-element-utils";
import {
  resumeWebAudioContextIfSuspended,
  ensureWebAudioRunning,
} from "@/lib/audio/web-audio-context-utils";
import {
  AUDIBILITY_RECOVERY_MAX_ATTEMPTS,
  AUDIBILITY_RECOVERY_RETRY_DELAY_MS,
  resetAudibilitySample,
  teardownWebAudioGraph,
  waitForPlaybackAudibility,
} from "@/lib/playback/audibility";
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
  isGenuineTransportFailureReason,
  isLifecycleInterruptReason,
} from "@/lib/playback/playback-transport-utils";

const RECOVERY_COOLDOWN_MS = 6000;
const LIFECYCLE_RECOVERY_LOCK_MS = 4000;
const BFCACHE_RECOVERY_TIMEOUT_MS = 5000;
// Global symbol shared with WebAudioEngine — preserves the bound-source flag across recovery.

/**
 * Attaches Group 2 (recovery) commands to the shared `self` service object.
 */
export function attachRecoveryCommands(self) {
  self.recoverAudioHard = async function recoverAudioHard(reason, { resumeAfter = false } = {}) {
    const {
      patchState, initWebAudio, resolveLibraryStreamForTrack,
      stopKeepAlivePing, stopPositionSaveTimer, stopProgressRaf, stopStallRecovery,
      tracePlayback, attemptLightweightPlaybackResume,
      armLifecycleRecoverySuppression, blockRecoveryForLifecycleOsSuspended,
      isLifecycleRecoverySuppressed,
      stateRef, audioRef, audioCtxRef,
      mainGainRef, trackGainRef, userGainRef,
      activeCommandRef, activeStreamAbortRef, streamMetaRef,
      skipPauseInterruptionRef, sourceRef, analyserRef, stereoPannerRef, bassFilterRef,
      webAudioInitializedRef, webAudioAvailableRef,
      nextTrackPreloadRef, audibilitySampleRef,
      isRecoveringRef, recoveryCooldownUntilRef, internalPlaybackAuthorityRef,
    } = self._deps;

    if (isRecoveringRef.current) return false;
    if (Date.now() < recoveryCooldownUntilRef.current && reason !== "truth_violation") {
      return false;
    }
    if (blockRecoveryForLifecycleOsSuspended("recoverAudioHard", reason)) {
      return false;
    }

    const track = stateRef.current.currentTrack;
    const shouldResume = resumeAfter && !stateRef.current.isPlaying === false;

    tracePlayback("recoverAudioHard", "recoverAudioHard", {
      reason,
      resumeAfter,
      slug: track?.slug ?? null,
    });

    isRecoveringRef.current = true;
    internalPlaybackAuthorityRef.current = true;

    try {
      const audio = audioRef.current;
      if (!audio) return false;

      if (!attemptLightweightPlaybackResume) {
        // no-op guard
      }

      stopProgressRaf();
      stopPositionSaveTimer();
      stopKeepAlivePing();
      stopStallRecovery();

      if (armLifecycleRecoverySuppression && isLifecycleRecoverySuppressed) {
        // These are used later
      }

      teardownWebAudioGraph({
        audioCtxRef,
        sourceRef,
        analyserRef,
        stereoPannerRef,
        bassFilterRef,
        webAudioInitializedRef,
        webAudioAvailableRef,
        preserveMediaElementSource: true,
      });

      resetAudibilitySample(audibilitySampleRef);

      patchState({
        isPlaying: false,
        playbackState: "recovering",
        isBuffering: true,
        playbackNetworkState: "recovering",
        error: null,
      });

      if (!audio || !track?.src) return false;

      initWebAudio();
      await resumeWebAudioContextIfSuspended(audioCtxRef);
      recordAudioContextState(audioCtxRef.current, `recoverAudioHard:${reason}`);

      let src = track.src;
      const streamSlug = parseStreamSlugFromSrc(src) || track.slug;
      if (streamSlug && isLibraryStreamSrc(src) && isEntitledFullPlaybackTrack(track)) {
        try {
          const resolved = await resolveLibraryStreamForTrack(track, { force: true });
          src = resolved.track?.src || src;
        } catch (error) {
          reportPlaybackDiagnostic({
            level: "warn",
            code: "RECOVER_STREAM_REFRESH_FAILED",
            command: PLAYBACK_COMMANDS.RECOVER,
            requestId: activeCommandRef.current?.requestId || null,
            state: stateRef.current,
            error,
            context: { reason, slug: streamSlug },
          });
        }
      }

      skipPauseInterruptionRef.current = true;
      await waitAudioSrcReady(audio, src, { signal: activeStreamAbortRef.current?.signal });
      if (resumeAfter > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
        const safe = clampRestorePosition(resumeAfter, audio.duration);
        if (safe != null) audio.currentTime = safe;
      }

      patchState({
        currentTrack: { ...track, src },
        currentTrackId: track.id || track.trackId || null,
        playbackState: "ready",
        isBuffering: false,
        playbackNetworkState: "idle",
        hasStarted: true,
      });

      if (!(await ensureWebAudioRunning(audioCtxRef))) {
        reportPlaybackDiagnostic({
          level: "warn",
          code: "RECOVER_AUDIO_CONTEXT_SUSPENDED",
          command: PLAYBACK_COMMANDS.RECOVER,
          requestId: activeCommandRef.current?.requestId || null,
          state: stateRef.current,
          context: { reason },
        });
        return false;
      }

      if (shouldResume) {
        const audibilityParams = {
          audio,
          webAudioContext: audioCtxRef.current,
          sampleRef: audibilitySampleRef,
        };
        let audibleAfterResume = false;
        for (let attempt = 0; attempt < AUDIBILITY_RECOVERY_MAX_ATTEMPTS; attempt++) {
          if (attempt > 0) {
            await new Promise((resolve) => {
              setTimeout(resolve, AUDIBILITY_RECOVERY_RETRY_DELAY_MS);
            });
          }
          await playAudioIfNotPaused(audio, true, {
            command: PLAYBACK_COMMANDS.RECOVER,
            requestId: activeCommandRef.current?.requestId || null,
            state: stateRef.current,
            context: { reason, hard: true, audibilityAttempt: attempt + 1 },
            effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
          });
          audibleAfterResume = await waitForPlaybackAudibility(audibilityParams);
          if (audibleAfterResume) break;
          if (isPlaybackTraceEnabled()) {
            logPlaybackEvent({
              type: "recovery-audibility",
              source: "recoverAudioHard",
              extra: { reason, attempt: attempt + 1, maxAttempts: AUDIBILITY_RECOVERY_MAX_ATTEMPTS },
            });
          }
        }
        if (!audibleAfterResume) {
          logPlaybackResilience("recover-audibility-failed", {
            source: "AudioContext",
            code: "RECOVER_AUDIBILITY_FAILED",
            reason,
            slug: track?.slug ?? null,
          });
          if (isPlaybackTraceEnabled()) {
            logPlayback("recovery_audibility_exit", { reason, slug: track?.slug ?? null });
          }
          patchState({
            isPlaying: false,
            playbackState: "ready",
            isBuffering: false,
            playbackNetworkState: "idle",
          });
          return false;
        }
        patchState({
          isPlaying: true,
          playbackState: "playing",
          isBuffering: false,
          playbackNetworkState: "idle",
        });
      }
      return true;
    } catch (error) {
      reportPlaybackDiagnostic({
        level: "warn",
        code: "RECOVER_AUDIO_HARD_FAILED",
        command: PLAYBACK_COMMANDS.RECOVER,
        requestId: self._deps.activeCommandRef.current?.requestId || null,
        state: self._deps.stateRef.current,
        error,
        context: { reason },
      });
      self._deps.patchState({
        isPlaying: false,
        playbackState: "paused",
        isBuffering: false,
        playbackNetworkState: "error_stream",
        error: "Playback needs a moment — tap play to continue.",
      });
      return false;
    } finally {
      self._deps.recoveryCooldownUntilRef.current = Date.now() + RECOVERY_COOLDOWN_MS;
      self._deps.isRecoveringRef.current = false;
      self._deps.internalPlaybackAuthorityRef.current = false;
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
