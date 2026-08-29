"use client";

import {
  playbackStateMachine,
  PLAYBACK_ORCHESTRATION_EVENTS,
  PLAYBACK_ORCHESTRATION_STATES,
} from "@/media/PlaybackStateMachine";
import { PLAYBACK_COMMANDS } from "@/lib/playback/playback-commands";
import { LIFECYCLE_AUDIO_TRUTH_STATES, PREVIEW_HARD_CAP_SEC } from "@/lib/playback/PlaybackEventHandlers";
import { notifyMediaEngineBridge } from "@/media/mediaEngineBridge";
import { getWebAudioEngine } from "@/lib/audio/WebAudioEngine";
import { PhysicalEffectAuthorityMode } from "@/lib/audio/physical-effect-authority";
import {
  resumeWebAudioContextIfSuspended,
  ensureWebAudioRunning,
} from "@/lib/audio/web-audio-context-utils";
import {
  playAudioIfNotPaused,
  normalizePlaybackSrc,
  isNearEndRestorePosition,
} from "@/lib/audio/audio-element-utils";
import {
  isAudioActuallyAudible,
  updateAudibilitySample,
} from "@/lib/playback/audibility";
import {
  evaluatePlaybackTransportHealth,
  hasIntactPlaybackTransport,
  isDocumentPlaybackHidden,
  isGenuineTransportFailureReason,
} from "@/lib/playback/playback-transport-utils";
import {
  SOURCE_KIND,
  classifySourceUrl,
  isDirectlyBufferable,
  requiresSignedUrlFetch,
} from "@/lib/playback/audio-source-resolver";
import {
  endStreamAnalytics,
  fetchLibraryStream,
  isLibraryStreamSrc,
  parseStreamSlugFromSrc,
  parseStreamTrackSlugFromSrc,
  streamUrlNeedsRefresh,
} from "@/lib/playback/stream-client";
import { SIGNED_URL_CLIENT_TTL_MS } from "@/lib/playback/stream-url-cache";
import { recoveryCoordinator } from "@/lib/playback/recovery-coordinator";
import {
  isEntitledFullPlaybackTrack,
  isTransportOnlyPatch,
  playbackUiStateEqual,
  TRANSPORT_ONLY_STATE_KEYS,
} from "@/lib/playback/playback-track-utils";
import {
  clearPlaybackPosition,
  savePlaybackPosition,
} from "@/lib/playback/position-memory";
import { recordListeningEvent } from "@/lib/listening-history";
import {
  getArtworkEntriesForTrack,
  persistMediaSessionTrack,
  resolveAbsoluteArtworkUrl,
} from "@/lib/media-session-artwork";
import { recordAudioContextState } from "@/lib/dev/performanceMarks";
import { prefetchHlsSegmentsForTrack } from "@/lib/audio/hls-segment-prefetcher";
import { evictOverflowingCaches } from "@/lib/playback/playback-cache-manager";
import { isHlsJsActive } from "@/lib/audio/HLSEngine";
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";
import {
  getCanonicalTransportStatus,
  getCanonicalTransportTimeline,
  reportTransportMode,
  reportTransportTimeline,
  subscribeCanonicalTransportStatus,
  subscribeCanonicalTransportTimeline,
  captureTransportObservationContext,
} from "@/lib/playback/transport-observation-port.js";
import { logPlaybackResilience } from "@/lib/diagnostics/state-churn-log";
import {
  isPlaybackTraceEnabled,
  logPlaybackEvent,
  logPlaybackAuthViolation,
  parsePlaybackCallerFromStack,
  captureAudibleOutputSnapshot,
  logLifecycleTransportHealthy,
  logLifecycleTransportFailed,
  logLifecycleRecoverySuppressed,
  logLifecycleTruthStateComputed,
  logLifecycleStateCSuppressed,
  logRecoveryBlockedLifecycleC,
  logPlaybackContinuitySnapshotCaptured,
  logPlaybackContinuityRestored,
  logUiContinuityFreezeEntered,
  logUiContinuityReconciled,
  logBackgroundAudioContextState,
  logBackgroundAudioElementState,
  logBackgroundMediaSessionState,
  logLockscreenMediaSessionActive,
  logPlaybackIntentState,
} from "@/lib/diagnostics/playback-trace";

// Module-level constants (mirrored from AudioContext.js constants block)
const POSITION_STATE_THROTTLE_MS = 1000;
const POSITION_SAVE_INTERVAL_MS = 15000;
const KEEP_ALIVE_INTERVAL_MS = 20000;
const LIFECYCLE_RECOVERY_SUPPRESSION_MS = 2500;
const AUDIO_CONTENT_TYPE_RE = /^(audio\/|application\/octet-stream)/i;

/**
 * B-4c: PlaybackHelperService — helper / utility callbacks extracted from AudioContext.js.
 * Uses the same self._deps + updateDeps() pattern as PlaybackCommandService so every
 * method always reads the latest closure values without re-creating callbacks.
 */
export function createPlaybackHelpers(initialDeps) {
  const self = {
    _deps: { ...initialDeps },

    updateDeps(deps) {
      Object.assign(self._deps, deps);
    },

    // ─── Audibility / Transport Health ──────────────────────────────────────

    getAudibilityParams() {
      return {
        audio: self._deps.audioRef.current,
        webAudioContext: self._deps.audioCtxRef.current,
        sampleRef: self._deps.audibilitySampleRef,
      };
    },

    readIsAudiblyPlaying() {
      const params = self.getAudibilityParams();
      if (!params.audio) return false;
      return isAudioActuallyAudible(params);
    },

    getPlaybackTransportHealth() {
      const s = self._deps.stateRef.current;
      return evaluatePlaybackTransportHealth(self._deps.audioRef.current, s.currentTrack, {
        queueLength: self._deps.queueRef.current.length,
        queueIndex: self._deps.queueIndexRef.current,
      });
    },

    // ─── Lifecycle Recovery Suppression ─────────────────────────────────────

    armLifecycleRecoverySuppression(source, reason) {
      self._deps.lifecycleRecoverySuppressedUntilRef.current =
        Date.now() + LIFECYCLE_RECOVERY_SUPPRESSION_MS;
      logLifecycleRecoverySuppressed({
        source,
        reason,
        slug: self._deps.stateRef.current.currentTrack?.slug ?? null,
        untilMs: LIFECYCLE_RECOVERY_SUPPRESSION_MS,
      });
    },

    isLifecycleRecoverySuppressed(reason) {
      if (Date.now() >= self._deps.lifecycleRecoverySuppressedUntilRef.current) return false;
      const transport = self.getPlaybackTransportHealth();
      if (!transport.intact) return false;
      if (isGenuineTransportFailureReason(reason)) return false;
      return true;
    },

    // ─── Lifecycle Truth State ───────────────────────────────────────────────

    computeLifecycleAudioTruthState() {
      const audio = self._deps.audioRef.current;
      const track = self._deps.stateRef.current.currentTrack;
      const transport = evaluatePlaybackTransportHealth(audio, track, {
        queueLength: self._deps.queueRef.current.length,
        queueIndex: self._deps.queueIndexRef.current,
      });
      const ctx = self._deps.audioCtxRef.current;
      const documentHidden = isDocumentPlaybackHidden();
      const lifecycleBackground =
        self._deps.lifecycleInBackgroundRef.current || documentHidden;
      const playbackIntent = self._deps.playbackIntentBeforeHideRef.current;
      const userPaused =
        self._deps.userPausedRef.current || self._deps.userIntentPausedRef.current;
      const machineRecovering =
        playbackStateMachine.getState() === PLAYBACK_ORCHESTRATION_STATES.RECOVERING;

      let next = LIFECYCLE_AUDIO_TRUTH_STATES.USER_PAUSED;

      if (userPaused) {
        next = LIFECYCLE_AUDIO_TRUTH_STATES.USER_PAUSED;
      } else if (!transport.intact) {
        next = LIFECYCLE_AUDIO_TRUTH_STATES.RECOVERING;
      } else if (
        self._deps.isRecoveringRef.current ||
        self._deps.recoveryInFlightRef.current ||
        machineRecovering
      ) {
        next = LIFECYCLE_AUDIO_TRUTH_STATES.RECOVERING;
      } else if (
        playbackIntent &&
        transport.intact &&
        (lifecycleBackground ||
          (audio?.paused &&
            (ctx?.state === "suspended" || lifecycleBackground || playbackIntent)))
      ) {
        next = LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED;
      } else if (
        audio &&
        !audio.paused &&
        !audio.ended &&
        transport.intact &&
        !lifecycleBackground
      ) {
        next = LIFECYCLE_AUDIO_TRUTH_STATES.USER_PLAYING;
      } else if (
        self._deps.stateRef.current.isPlaying &&
        !lifecycleBackground &&
        transport.intact
      ) {
        const params = self.getAudibilityParams();
        if (params.audio && isAudioActuallyAudible(params)) {
          next = LIFECYCLE_AUDIO_TRUTH_STATES.USER_PLAYING;
        } else if (playbackIntent) {
          next = LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED;
        }
      } else if (playbackIntent && transport.intact) {
        next = LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED;
      }

      const prev = self._deps.lifecycleAudioTruthStateRef.current;
      if (prev !== next) {
        logLifecycleTruthStateComputed({
          prev,
          next,
          userPaused,
          playbackIntent,
          lifecycleBackground,
          transportIntact: transport.intact,
          elementPaused: audio?.paused ?? null,
          ctxState: ctx?.state ?? null,
          slug: track?.slug ?? null,
        });
      }

      // Phase 21C — UI continuity freeze snapshot across OS_SUSPENDED.
      const prevWasC = prev === LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED;
      const nextIsC = next === LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED;
      const snap = self._deps.continuitySnapshotRef.current;

      // Capture snapshot once on entering class C.
      if (!prevWasC && nextIsC && !snap && self._deps.stateRef.current.currentTrack) {
        const t = self._deps.stateRef.current.currentTrack;
        const el = self._deps.audioRef.current;
        const playbackPosition =
          el && Number.isFinite(el.currentTime)
            ? el.currentTime
            : (self._deps.stateRef.current.currentTime ?? 0);
        const duration =
          el && Number.isFinite(el.duration)
            ? el.duration
            : (self._deps.stateRef.current.duration ?? 0);

        const cover = {
          base: t?.cover || t?.coverArt || t?.coverUrl || t?.baseCover || "",
          baseArtType: t?.coverArtType ?? null,
          cs: t?.csCover || t?.cs_cover || null,
          csArtType: t?.csCoverType ?? null,
        };

        const snapshot = {
          trackId: t?.id ?? t?.trackId ?? t?.slug ?? null,
          slug: t?.slug ?? null,
          playbackPosition,
          queueIndex: self._deps.queueIndexRef.current,
          isPlaying: Boolean(self._deps.playbackIntentBeforeHideRef.current),
          duration,
          cover,
          title: t?.title ?? null,
          artist: t?.artist ?? null,
          album: t?.album ?? null,
          timestamp: Date.now(),
        };

        self._deps.continuitySnapshotRef.current = snapshot;
        self.setContinuityFrozenUi(true);

        // Freeze progress display: push the frozen position into canonical
        // Transport Timeline, then force-deliver to consumers despite the
        // freeze gate (one-time bypass via forceProgressNotifyRef).
        //
        // SLICE 4D ADDENDUM: this must go through reportTransportTimeline
        // directly with a context captured HERE, stamped with the frozen
        // track's own mediaIdentity — not playbackStateMachine.updateContext(),
        // whose compatibility shim always captures a context fresh at push
        // time (@/lib/playback/transport-observation-port.js's default
        // parameter). A fresh-at-push context can never be "stale" by
        // construction, which silently defeated TransportAuthority's own
        // pre-existing MEDIA_IDENTITY_MISMATCH/DESIRED_REVISION_MISMATCH
        // gates for exactly the case they exist to catch: old lifecycle work
        // (this frozen snapshot) finishing after Core has already moved on to
        // a different track. Capturing the context now, tied to this
        // snapshot's own track, lets that already-canonical gate correctly
        // deny the push if it turns out to be stale by the time it commits.
        reportTransportTimeline(
          { position: snapshot.playbackPosition, duration: snapshot.duration },
          captureTransportObservationContext({ mediaIdentity: snapshot.trackId }),
        );
        self.notifyProgressListeners({ force: true });

        logPlaybackContinuitySnapshotCaptured({
          source: "computeLifecycleAudioTruthState",
          trackId: snapshot.trackId,
          slug: snapshot.slug,
          playbackPosition: snapshot.playbackPosition,
          queueIndex: snapshot.queueIndex,
          isPlaying: snapshot.isPlaying,
        });
        logUiContinuityFreezeEntered({
          source: "computeLifecycleAudioTruthState",
          trackId: snapshot.trackId,
          slug: snapshot.slug,
          isPlaying: snapshot.isPlaying,
        });
      }

      // Release freeze when audio + UI intent match snapshot, when the audio element
      // has errored (stream failed while backgrounded), or after 30s maximum duration
      // so a stuck freeze never leaves the UI permanently wrong.
      if (
        self._deps.continuityFrozenRef.current &&
        self._deps.continuitySnapshotRef.current
      ) {
        const currentSnap = self._deps.continuitySnapshotRef.current;
        const el = self._deps.audioRef.current;
        const stateIntentIsPlaying = self._deps.stateRef.current.isPlaying;
        const frozenTooLong =
          currentSnap.timestamp != null &&
          Date.now() - currentSnap.timestamp > 30_000;
        const shouldRelease =
          frozenTooLong ||
          Boolean(el?.error) ||
          (Boolean(el) &&
          transport.intact &&
          !el.paused &&
          !el.ended &&
          stateIntentIsPlaying === currentSnap.isPlaying);

        if (shouldRelease) {
          self.setContinuityFrozenUi(false);
          self._deps.continuitySnapshotRef.current = null;

          const restoredTime =
            self._deps.stateRef.current.currentTime ?? el.currentTime ?? 0;
          const restoredDuration =
            self._deps.stateRef.current.duration ??
            (Number.isFinite(el.duration) ? el.duration : 0) ??
            0;
          playbackStateMachine.updateContext({
            currentTime: restoredTime,
            duration: restoredDuration,
          });
          self.notifyProgressListeners({ force: true });

          logPlaybackContinuityRestored({
            source: "computeLifecycleAudioTruthState",
            trackId: currentSnap.trackId,
            slug: currentSnap.slug,
            playbackPosition: restoredTime,
            isPlaying: currentSnap.isPlaying,
          });
          logUiContinuityReconciled({
            source: "computeLifecycleAudioTruthState",
            trackId: currentSnap.trackId,
            slug: currentSnap.slug,
            isPlaying: currentSnap.isPlaying,
          });
        }
      }

      self._deps.lifecycleAudioTruthStateRef.current = next;
      return next;
    },

    isLifecycleOsSuspended() {
      return (
        self.computeLifecycleAudioTruthState() ===
        LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED
      );
    },

    blockRecoveryForLifecycleOsSuspended(source, reason) {
      if (!self.isLifecycleOsSuspended()) return false;
      if (isGenuineTransportFailureReason(reason)) return false;
      logRecoveryBlockedLifecycleC({
        source,
        reason: reason ?? null,
        slug: self._deps.stateRef.current.currentTrack?.slug ?? null,
      });
      logLifecycleStateCSuppressed({
        source,
        gate: "recovery",
        reason: reason ?? null,
        slug: self._deps.stateRef.current.currentTrack?.slug ?? null,
      });
      return true;
    },

    /** Phase 15F / 20C — lifecycle health; transport failures trump OS pause/suspend. */
    evaluateLifecyclePlaybackHealth({ resumeAfter = false, lifecycleIntent = false } = {}) {
      if (self.isLifecycleOsSuspended()) {
        return { healthy: false, reason: "os_suspended_ignored", osSuspended: true };
      }

      const s = self._deps.stateRef.current;
      const track = s.currentTrack;
      if (!track) return { healthy: false, reason: "no_track" };
      if (!s.hasStarted) return { healthy: false, reason: "not_started" };

      const audio = self._deps.audioRef.current;
      if (!audio) return { healthy: false, reason: "no_audio_element" };

      const transport = evaluatePlaybackTransportHealth(audio, track, {
        queueLength: self._deps.queueRef.current.length,
        queueIndex: self._deps.queueIndexRef.current,
      });
      if (!transport.intact) {
        logLifecycleTransportFailed({
          source: "evaluateLifecyclePlaybackHealth",
          reason: transport.reason,
          resumeAfter,
          slug: track.slug ?? null,
        });
        return { healthy: false, reason: transport.reason };
      }

      if (audio.ended) return { healthy: false, reason: "ended" };

      const ctx = self._deps.audioCtxRef.current;
      const ctxSuspended = ctx?.state === "suspended";
      const hasInterruptIntent =
        self._deps.playbackIntentBeforeHideRef.current || Boolean(lifecycleIntent);

      if (!resumeAfter) {
        if (
          hasInterruptIntent &&
          audio.paused &&
          !self._deps.userPausedRef.current &&
          !self._deps.userIntentPausedRef.current
        ) {
          return { healthy: false, reason: "paused_after_lifecycle_interrupt" };
        }
        logLifecycleTransportHealthy({
          source: "evaluateLifecyclePlaybackHealth",
          reason: "transport_ok_paused",
          resumeAfter,
          slug: track.slug ?? null,
        });
        return { healthy: true, reason: "transport_ok_paused" };
      }

      if (hasInterruptIntent && audio.paused) {
        if (ctxSuspended) {
          return { healthy: false, reason: "context_suspended_resume_needed" };
        }
        return { healthy: false, reason: "paused_after_lifecycle_interrupt" };
      }

      if (ctxSuspended) {
        return { healthy: false, reason: "context_suspended_resume_needed" };
      }
      if (ctx && ctx.state !== "running") {
        return { healthy: false, reason: "audio_context_not_running" };
      }

      updateAudibilitySample(audio, self._deps.audibilitySampleRef);
      const params = self.getAudibilityParams();
      if (isAudioActuallyAudible(params)) {
        logLifecycleTransportHealthy({
          source: "evaluateLifecyclePlaybackHealth",
          reason: "audible",
          resumeAfter,
          slug: track.slug ?? null,
        });
        return { healthy: true, reason: "audible" };
      }

      if (audio.paused) return { healthy: false, reason: "paused_expected_playing" };
      if (audio.readyState < 2) return { healthy: false, reason: "not_ready" };

      return { healthy: false, reason: "not_audible" };
    },

    // ─── Diagnostic Helpers ──────────────────────────────────────────────────

    tracePlayback(type, source, extra = {}) {
      const t = self._deps.stateRef.current.currentTrack;
      logPlaybackEvent({
        type,
        source,
        trackId: t?.id ?? t?.trackId ?? t?.slug ?? null,
        extra,
      });
    },

    emitBackgroundPlaybackDiagnostics(source) {
      const audio = self._deps.audioRef.current;
      const track = self._deps.stateRef.current.currentTrack;
      const ctx = self._deps.audioCtxRef.current;
      logBackgroundAudioContextState({
        source,
        ctxState: ctx?.state ?? null,
        slug: track?.slug ?? null,
      });
      logBackgroundAudioElementState({
        source,
        paused: audio?.paused ?? null,
        ended: audio?.ended ?? null,
        readyState: audio?.readyState ?? null,
        hasSrc: hasIntactPlaybackTransport(audio, track),
        slug: track?.slug ?? null,
      });
      if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        const ms = navigator.mediaSession;
        logBackgroundMediaSessionState({
          source,
          playbackState: ms.playbackState ?? null,
          slug: track?.slug ?? null,
        });
        if (ms.playbackState === "playing" && audio?.paused) {
          logLockscreenMediaSessionActive({
            source,
            slug: track?.slug ?? null,
          });
        }
      }
      logPlaybackIntentState({
        source,
        intent: self._deps.playbackIntentBeforeHideRef.current,
        lifecycleBackground: self._deps.lifecycleInBackgroundRef.current,
        userPaused: self._deps.userPausedRef.current,
        slug: track?.slug ?? null,
      });
    },

    /** Phase 21 — observation-only audible vs transport divergence snapshots. */
    emitPhase21AudibleSnapshot(source) {
      const audio = self._deps.audioRef.current;
      const track = self._deps.stateRef.current.currentTrack;
      const ctx = self._deps.audioCtxRef.current;
      const msPlaybackState =
        typeof navigator !== "undefined" && "mediaSession" in navigator
          ? navigator.mediaSession.playbackState ?? null
          : null;
      const params = self.getAudibilityParams();
      const isAudible = params.audio ? isAudioActuallyAudible(params) : false;
      captureAudibleOutputSnapshot({
        source,
        audio,
        webAudioContext: ctx,
        track,
        hasIntactTransport: hasIntactPlaybackTransport(audio, track),
        mediaSessionPlaybackState: msPlaybackState,
        playbackIntent: self._deps.playbackIntentBeforeHideRef.current,
        lifecycleBackground:
          self._deps.lifecycleInBackgroundRef.current || isDocumentPlaybackHidden(),
        isAudible,
        slug: track?.slug ?? null,
      });
    },

    logDirectInternalCallViolation(fnName) {
      if (self._deps.commandExecutionDepthRef.current > 0) return;
      if (self._deps.internalPlaybackAuthorityRef.current) return;
      const stack =
        typeof Error !== "undefined"
          ? new Error().stack?.split("\n").slice(1).join("\n")
          : null;
      const { module, action } = parsePlaybackCallerFromStack(stack);
      logPlaybackAuthViolation(fnName, {
        module,
        action,
        reason: "command_execution_depth_zero",
        source: "AudioContext",
        stack,
      });
    },

    getCurrentTrackId() {
      const track = self._deps.stateRef.current.currentTrack;
      if (!track) return null;
      return track.id ?? track.trackId ?? track.slug ?? null;
    },

    clearViewportResume() {
      self._deps.wasPlayingBeforeViewportPauseRef.current = false;
      self._deps.resumeEligibleRef.current = false;
      self._deps.lastTrackIdRef.current = null;
    },

    // ─── Progress / Continuity ───────────────────────────────────────────────

    getProgressSnapshot() {
      const timeline = getCanonicalTransportTimeline();
      return Object.freeze({ currentTime: timeline.position, duration: timeline.duration });
    },

    getContinuitySnapshot() {
      return self._deps.continuitySnapshotRef.current;
    },

    setContinuityFrozenUi(next) {
      if (self._deps.continuityFrozenRef.current === next) return;
      self._deps.continuityFrozenRef.current = next;
      playbackStateMachine.updateContext({ continuityFrozen: next });
    },

    patchUI(patch) {
      playbackStateMachine.updateContext(patch);
    },

    // Progress subscription — delegates to SM with continuity-freeze gate.
    // The forceProgressNotifyRef flag opens the gate for one notification (Phase 21C freeze push).
    subscribeProgress(listener) {
      return subscribeCanonicalTransportTimeline(() => {
        if (
          !self._deps.continuityFrozenRef.current ||
          self._deps.forceProgressNotifyRef.current
        ) {
          self._deps.forceProgressNotifyRef.current = false;
          listener();
        }
      });
    },

    // Force-push a progress snapshot to all consumers, bypassing the continuity-freeze gate.
    // Used by Phase 21C on freeze entry (push frozen position once) and release (push restored position).
    notifyProgressListeners({ force = false } = {}) {
      if (!force && self._deps.continuityFrozenRef.current) return;
      const s = playbackStateMachine.getContext();
      if (force) {
        self._deps.forceProgressNotifyRef.current = true;
        playbackStateMachine.updateContext({
          currentTime: s.currentTime ?? 0,
          duration: s.duration ?? 0,
        });
        if (self._deps.forceProgressNotifyRef.current) {
          playbackStateMachine.forceEmitProgress();
          self._deps.forceProgressNotifyRef.current = false;
        }
      } else {
        playbackStateMachine.updateContext({
          currentTime: s.currentTime ?? 0,
          duration: s.duration ?? 0,
        });
      }
      notifyMediaEngineBridge();
    },

    /** Phase P4 — user-initiated track change must not leave 21C UI frozen on stale snapshot. */
    clearContinuityFreeze(source = "track_change") {
      if (
        !self._deps.continuityFrozenRef.current &&
        !self._deps.continuitySnapshotRef.current
      )
        return;
      const snap = self._deps.continuitySnapshotRef.current;
      self._deps.continuitySnapshotRef.current = null;
      self.setContinuityFrozenUi(false);
      const audio = self._deps.audioRef.current;
      const currentTime =
        audio?.currentTime ?? playbackStateMachine.getContext().currentTime ?? 0;
      const duration = Number.isFinite(audio?.duration)
        ? audio.duration
        : (playbackStateMachine.getContext().duration ?? 0);
      playbackStateMachine.updateContext({ currentTime, duration });
      playbackStateMachine.forceEmitProgress();
      notifyMediaEngineBridge();
      if (snap) {
        logPlaybackContinuityRestored({
          source,
          trackId: snap.trackId,
          slug: snap.slug,
          playbackPosition: currentTime,
          isPlaying: snap.isPlaying,
        });
        logUiContinuityReconciled({
          source,
          trackId: snap.trackId,
          slug: snap.slug,
          isPlaying: snap.isPlaying,
        });
      }
    },

    getTransportSnapshot() {
      const status = getCanonicalTransportStatus();
      return Object.freeze({
        isBuffering: status.buffering || status.loading || status.recovering,
        playbackNetworkState: status.networkState,
      });
    },

    subscribeTransport(listener) {
      return subscribeCanonicalTransportStatus(() => {
        listener();
        notifyMediaEngineBridge();
      });
    },

    notifyTransportListeners() {
      // SM fires transport channel automatically via updateContext. Shim for legacy callers.
      notifyMediaEngineBridge();
    },

    subscribeIdentity(listener) {
      return playbackStateMachine.subscribeIdentity(() => listener());
    },

    getIdentitySnapshot() {
      return playbackStateMachine.getIdentitySnapshot();
    },

    notifyIdentityListeners() {
      // SM fires identity channel automatically via updateContext. No-op shim for legacy callers.
    },

    syncProgressTime(time) {
      if (!Number.isFinite(time)) return;
      reportTransportTimeline({ position: time, observedAt: Date.now() });
      // SM fires progress channel automatically — notifies consumers without a React re-render.
    },

    // ─── Timers / Session ────────────────────────────────────────────────────

    stopPositionSaveTimer() {
      if (self._deps.positionSaveTimerRef.current) {
        clearInterval(self._deps.positionSaveTimerRef.current);
        self._deps.positionSaveTimerRef.current = null;
      }
    },

    stopStallRecovery() {
      // Notify coordinator that playback resumed — it clears its grace timer
      // and releases its lock. Cooldown stays to let the buffer refill.
      recoveryCoordinator.onPlaybackResumed();
    },

    startStallRecovery() {
      // All recovery logic lives in the Recovery Coordinator.
      // It handles: buffer health check, grace period, lock, HLS vs progressive
      // strategy, cooldown, and escalation to hard reload. Nothing here.
      recoveryCoordinator.report({
        audioRef:               self._deps.audioRef,
        stateRef:               self._deps.stateRef,
        retryStreamPlaybackRef: self._deps.retryStreamPlaybackRef,
        patchState:             self.patchState.bind(self),
      });
    },

    startPositionSaveTimer() {
      self.stopPositionSaveTimer();
      self._deps.positionSaveTimerRef.current = setInterval(() => {
        const audio = self._deps.audioRef.current;
        const track = self._deps.stateRef.current.currentTrack;
        const userId = self._deps.listeningUserIdRef.current;
        if (!audio || !track?.slug || !userId || audio.paused) return;
        const dur = isFinite(audio.duration) ? audio.duration : 0;
        const pos = audio.currentTime || 0;
        if (dur > 0 && isNearEndRestorePosition(pos, dur)) return;
        savePlaybackPosition(userId, track.slug, pos, dur);
      }, POSITION_SAVE_INTERVAL_MS);
    },

    finalizeStreamSession(meta, { completed = false, durationSeconds = 0 } = {}) {
      if (!meta?.streamEventId && !meta?.sessionId && !meta?.slug) return;
      void endStreamAnalytics({
        streamEventId: meta.streamEventId || null,
        sessionId: meta.sessionId || null,
        slug: meta.slug || null,
        durationSeconds,
        completed,
      });
      self._deps.streamMetaRef.current = null;
    },

    recordLocalListening(track, meta = {}) {
      const userId = self._deps.listeningUserIdRef.current;
      if (!userId || !track?.slug) return;
      // String-title album tracks share track.slug = albumSlug — use the per-track
      // slug (metadata.trackSlug) when available so each track gets its own event.
      const analyticsSlug =
        track.metadata?.trackSlug || track.trackSlug || track.slug;
      if (meta.completed) {
        clearPlaybackPosition(userId, analyticsSlug);
      }
      recordListeningEvent(
        analyticsSlug,
        {
          title: track.title,
          cover: track.baseCover || track.cover,
          positionSeconds: meta.positionSeconds ?? 0,
          durationSeconds: meta.durationSeconds ?? 0,
          completed: Boolean(meta.completed),
        },
        userId
      );
    },

    // ─── State Patching ──────────────────────────────────────────────────────

    logPlaybackDesyncIfNeeded(prev, next) {
      const el = self._deps.audioRef.current;
      if (!el?.paused || !next.isPlaying) return;
      if (isPlaybackTraceEnabled()) {
        console.warn("[PLAYBACK-DESYNC] state.isPlaying but audio.paused", {
          playbackState: next.playbackState,
          slug: next.currentTrack?.slug ?? null,
          command: self._deps.activeCommandRef.current?.type ?? null,
          wasPlayingInPrev: Boolean(prev.isPlaying),
        });
      }
    },

    reconcileIsPlayingWithElement(prev, next) {
      const el = self._deps.audioRef.current;
      if (!next.isPlaying || !el?.paused) return next;
      // While intentionally loading a new src, the element is paused but isPlaying=true
      // represents our intent to play. Forcing isPlaying=false causes a play→stop→play flicker.
      //
      // IMPORTANT: playbackNetworkState is a transport-only field that bypasses React setState.
      // When this function is called from patchTransport, next.playbackNetworkState is the new
      // value (e.g. "loading_stream"). When called from inside React's setState callback,
      // next is built from React state where playbackNetworkState is always the initial "idle"
      // value — so we must also check stateRef.current as the authoritative fallback.
      const networkState = next.playbackNetworkState;
      const refNetworkState = self._deps.stateRef.current?.playbackNetworkState;
      if (networkState === "loading_stream" || refNetworkState === "loading_stream") return next;
      // Also suppress during active buffering. During a track-change: audio.pause() sets
      // el.paused=true while skipPauseInterruptionRef suppresses onPause. A concurrent
      // onWaiting debounce then patches playbackNetworkState to "buffering" via patchTransport.
      // Any subsequent transport patch would incorrectly flip isPlaying→false here because
      // the element is paused AND networkState is no longer "loading_stream". The user
      // experiences a flash of paused UI mid-load and must re-tap play.
      if (next.isBuffering || networkState === "buffering" || refNetworkState === "buffering") return next;
      // The coordinator holds authority over every intentional audio transition:
      // stall recovery, stream upgrades, and signed-URL src-swaps. During any of
      // these, audio.paused=true is expected and must not be read as a user pause.
      // notifyStreamUpgrade() and the stall recovery path both enter a cooldown so
      // isActive() returns true here for the full transition window.
      if (recoveryCoordinator.isActive()) return next;
      self.logPlaybackDesyncIfNeeded(prev, next);
      return {
        ...next,
        isPlaying: false,
        playbackState:
          next.playbackState === "playing" ? "paused" : next.playbackState,
      };
    },

    patchTransport(patch) {
      const prev = playbackStateMachine.getContext();
      const next = { ...prev, ...patch };
      // Route through SM — fires transport/progress/identity channels as needed.
      // SM value-checking prevents spurious notifications when values haven't changed.
      // Transport patches never read element state to correct isPlaying — the SM is
      // the authority; the element is the executor. onPause is the event-driven
      // mechanism for correcting isPlaying when audio unexpectedly pauses.
      playbackStateMachine.updateContext(patch);
      // Fire window event for external consumers when isPlaying changes.
      const prevIsPlaying = prev.isPlaying;
      const nextIsPlaying = Boolean(next.isPlaying);
      if (prevIsPlaying !== nextIsPlaying && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("2mrrw:playback-active-changed", {
            detail: { isPlaying: nextIsPlaying },
          })
        );
      }
      notifyMediaEngineBridge();
    },

    patchState(patch) {
      if (isTransportOnlyPatch(patch)) {
        self.patchTransport(patch);
        return;
      }
      // Split mixed patches — transport fields route to patchTransport, UI fields to SM.
      const uiPatch = { ...patch };
      const transportFields = {};
      for (const key of TRANSPORT_ONLY_STATE_KEYS) {
        if (key in uiPatch) {
          transportFields[key] = uiPatch[key];
          delete uiPatch[key];
        }
      }
      if (Object.keys(transportFields).length) {
        self.patchTransport(transportFields);
      }
      if (!Object.keys(uiPatch).length) return;

      // Apply business logic invariants before writing to SM.
      const prev = playbackStateMachine.getContext();
      let next = { ...prev, ...uiPatch };

      // hasStarted invariant: once audio starts it never goes back to not-started.
      const shouldHaveStarted =
        next.hasStarted === false &&
        (next.isPlaying === true ||
          next.playbackState === "ready" ||
          next.playbackState === "playing");
      if (shouldHaveStarted) {
        if (next.playbackState === "playing") {
          reportPlaybackDiagnostic({
            level: "warn",
            code: "PLAYBACK_VISIBILITY_INVARIANT_RECOVERED",
            command: self._deps.activeCommandRef.current?.type || "STATE_PATCH",
            requestId: self._deps.activeCommandRef.current?.requestId || null,
            state: next,
            context: { reason: "playing_with_hasStarted_false" },
          });
        }
        next = { ...next, hasStarted: true };
      }

      // FATAL_AUDIO_DESYNC guard: state claims playing but audio isn't audible — trigger recovery.
      // Suppressed when isBuffering=true or playbackNetworkState="buffering": silence during a
      // network stall is expected and correct — the desync detector must not misread a transient
      // underrun as a permanent engine crash. isBuffering is a transport-only key that can be
      // set via patchTransport without flowing through this code path, so both the direct value
      // (next.isBuffering from SM context) and the network state string are checked.
      // Also suppressed when the Recovery Coordinator is active (grace period, lock, or cooldown):
      // the coordinator already owns the recovery path and a concurrent DESYNC transition would
      // double-reset the buffer on top of an in-flight seek or reload.
      if (
        next.isPlaying &&
        next.playbackState === "playing" &&
        !next.isBuffering &&
        next.playbackNetworkState !== "buffering" &&
        !self._deps.isRecoveringRef.current &&
        !recoveryCoordinator.isActive()
      ) {
        const audio = self._deps.audioRef.current;
        const ctx = self._deps.audioCtxRef.current;
        if (
          self.isLifecycleRecoverySuppressed("fatal_audio_desync_invariant") &&
          evaluatePlaybackTransportHealth(audio, next.currentTrack, {
            queueLength: self._deps.queueRef.current.length,
            queueIndex: self._deps.queueIndexRef.current,
          }).intact
        ) {
          next = self.reconcileIsPlayingWithElement(prev, next);
        } else if (self.isLifecycleOsSuspended()) {
          logLifecycleStateCSuppressed({
            source: "patchState",
            gate: "fatal_audio_desync_invariant",
            slug: next.currentTrack?.slug ?? null,
          });
          next = self.reconcileIsPlayingWithElement(prev, next);
        } else if (
          audio &&
          !isAudioActuallyAudible({
            audio,
            webAudioContext: ctx,
            sampleRef: self._deps.audibilitySampleRef,
          })
        ) {
          reportPlaybackDiagnostic({
            level: "warn",
            code: "FATAL_AUDIO_DESYNC",
            command: self._deps.activeCommandRef.current?.type || "STATE_PATCH",
            requestId: self._deps.activeCommandRef.current?.requestId || null,
            state: next,
            context: { invariant: "invariant_break", playing_state_not_audible: true },
          });
          logPlaybackResilience("audio-invariant-break", {
            source: "AudioContext",
            code: "FATAL_AUDIO_DESYNC",
            slug: next.currentTrack?.slug ?? null,
          });
          next = {
            ...next,
            isPlaying: false,
            playbackState: "recovering",
            isBuffering: true,
            playbackNetworkState: "recovering",
          };
          queueMicrotask(() => {
            void playbackStateMachine.transition(
              PLAYBACK_ORCHESTRATION_EVENTS.AUDIO_DESYNC_DETECTED,
              {
                reason: "fatal_audio_desync_invariant",
                resumeAfter:
                  !self._deps.userPausedRef.current &&
                  !self._deps.userIntentPausedRef.current &&
                  Boolean(next.currentTrack),
              }
            );
          });
        } else {
          next = self.reconcileIsPlayingWithElement(prev, next);
        }
      } else {
        next = self.reconcileIsPlayingWithElement(prev, next);
      }

      // P12 optimization — skip SM update if nothing meaningful changed.
      if (playbackUiStateEqual(prev, next)) return;

      // Fire window event for isPlaying changes (external consumers).
      const prevIsPlaying = prev.isPlaying;
      const nextIsPlaying = Boolean(next.isPlaying);
      if (prevIsPlaying !== nextIsPlaying && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("2mrrw:playback-active-changed", {
            detail: { isPlaying: nextIsPlaying },
          })
        );
      }

      // Write reconciled state to SM — fires appropriate channels (context/identity/transport).
      playbackStateMachine.updateContext(next);
    },

    // ─── RAF / Progress ──────────────────────────────────────────────────────

    stopProgressRaf() {
      if (self._deps.progressRafRef.current != null) {
        cancelAnimationFrame(self._deps.progressRafRef.current);
        self._deps.progressRafRef.current = null;
      }
    },

    startProgressRaf() {
      self.stopProgressRaf();
      const tick = () => {
        const audio = self._deps.audioRef.current;
        if (!audio || audio.paused || audio.ended) {
          self.stopProgressRaf();
          return;
        }
        updateAudibilitySample(audio, self._deps.audibilitySampleRef);
        const t = audio.currentTime || 0;
        const prev = self._deps.stateRef.current;
        if (Math.abs(t - prev.currentTime) >= 0.001) {
          self.syncProgressTime(t);
        }
        self._deps.progressRafRef.current = requestAnimationFrame(tick);
      };
      self._deps.progressRafRef.current = requestAnimationFrame(tick);
    },

    // ─── Keep-Alive Ping ─────────────────────────────────────────────────────

    postKeepAliveToServiceWorker() {
      if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
      try {
        navigator.serviceWorker.controller.postMessage({ type: "KEEP_ALIVE" });
      } catch {
        /* SW ping best-effort */
      }
    },

    stopKeepAlivePing() {
      if (self._deps.keepAliveIntervalRef.current) {
        clearInterval(self._deps.keepAliveIntervalRef.current);
        self._deps.keepAliveIntervalRef.current = null;
      }
    },

    startKeepAlivePing() {
      self.stopKeepAlivePing();
      self.postKeepAliveToServiceWorker();
      self._deps.keepAliveIntervalRef.current = setInterval(
        () => self.postKeepAliveToServiceWorker(),
        KEEP_ALIVE_INTERVAL_MS
      );
    },

    // ─── Media Session ───────────────────────────────────────────────────────

    syncPositionState(force = false) {
      const audio = self._deps.audioRef.current;
      if (
        typeof navigator === "undefined" ||
        !("mediaSession" in navigator) ||
        !navigator.mediaSession?.setPositionState ||
        !audio ||
        !isFinite(audio.duration) ||
        audio.duration <= 0
      ) {
        return;
      }
      const now = Date.now();
      if (
        !force &&
        now - self._deps.lastPositionStateAtRef.current < POSITION_STATE_THROTTLE_MS
      ) {
        return;
      }
      self._deps.lastPositionStateAtRef.current = now;
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate || 1,
          position: Math.min(Math.max(0, audio.currentTime), audio.duration),
        });
      } catch {
        /* unsupported duration/position combo */
      }
    },

    async updateMediaSession(track, { playing } = {}) {
      if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
      const ms = navigator.mediaSession;
      if (!track) return;

      // Capture slug before async work — used below to reject stale artwork updates.
      const targetSlug = track.slug ?? null;

      const isVideoTrack = track.coverArtType === "video";
      const csCover = self._deps.csModeRef.current && (track.csCover || track.cs_cover)
        ? (track.csCover || track.cs_cover)
        : null;
      const staticCover = csCover
        || track.baseCover
        || (!isVideoTrack ? track.cover : null)
        || track.coverArt
        || track.coverUrl
        || "";
      const rawVideoCover = isVideoTrack ? (track.cover || null) : null;

      const staticEntries = await getArtworkEntriesForTrack(staticCover, track.slug);

      // Stale-artwork guard: if the active track changed during async artwork resolution, abort.
      // Prevents a slow artwork fetch for track A from overwriting track B's system metadata.
      if (targetSlug) {
        const nowSlug = self._deps.stateRef.current?.currentTrack?.slug ?? null;
        if (nowSlug && nowSlug !== targetSlug) return;
      }

      let artwork = staticEntries;
      if (rawVideoCover) {
        const videoAbsUrl = resolveAbsoluteArtworkUrl(rawVideoCover);
        // Dynamic Island on iOS supports animated MP4 — put it first so iOS picks it up.
        // The static entries follow as fallback for lock screen / Bluetooth / Android.
        if (videoAbsUrl && /^https?:\/\//i.test(videoAbsUrl)) {
          artwork = [{ src: videoAbsUrl, sizes: "512x512", type: "video/mp4" }, ...staticEntries];
        }
      }
      try {
        ms.metadata = new MediaMetadata({
          title: self._deps.csModeRef.current
            ? `${track.title || "Untitled"} ◈`
            : (track.title || "Untitled"),
          artist: track.artist || "2MRRW",
          album: track.album || "2MRRW",
          artwork,
        });
        const truthState = self.computeLifecycleAudioTruthState();
        if (truthState === LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED) {
          const preserved =
            self._deps.lastMediaSessionPlaybackStateRef.current ??
            ms.playbackState ??
            "playing";
          if (preserved === "playing" || preserved === "paused") {
            ms.playbackState = preserved;
          }
          logLifecycleStateCSuppressed({
            source: "updateMediaSession",
            gate: "media_session_playback_state",
            requestedPlaying: playing,
            preserved: ms.playbackState,
            slug: track.slug ?? null,
          });
        } else {
          ms.playbackState = playing ? "playing" : "paused";
          self._deps.lastMediaSessionPlaybackStateRef.current = ms.playbackState;
        }
      } catch {
        /* MediaMetadata unsupported */
      }

      const audio = self._deps.audioRef.current;
      persistMediaSessionTrack(track, {
        playing,
        currentTime: audio?.currentTime ?? self._deps.stateRef.current.currentTime,
        duration: isFinite(audio?.duration)
          ? audio.duration
          : self._deps.stateRef.current.duration,
      });
      self.syncPositionState(true);
    },

    rehydrateMediaSession() {
      const s = self._deps.stateRef.current;
      if (!s.currentTrack || !s.hasStarted) return;
      void self.updateMediaSession(s.currentTrack, { playing: s.isPlaying });
      self.syncPositionState(true);
    },

    /** Phase 20C — Media Session parity after lifecycle return without hard recovery. */
    async syncMediaSessionAfterLifecycle(resumeAfter) {
      const s = self._deps.stateRef.current;
      const track = s.currentTrack;
      const audio = self._deps.audioRef.current;
      if (!track) return;
      const shouldShowPlaying =
        resumeAfter &&
        !self._deps.userPausedRef.current &&
        !self._deps.userIntentPausedRef.current &&
        Boolean(audio && !audio.paused && !audio.ended);
      await self.updateMediaSession(track, { playing: shouldShowPlaying });
    },

    // ─── Web Audio Init ──────────────────────────────────────────────────────

    connectWebAudioDownstream() {
      const engine = getWebAudioEngine();
      engine.buildGraph();
      self._deps.mainGainRef.current = engine.mainGain;
      self._deps.userGainRef.current = engine.userGain;
      self._deps.analyserRef.current = engine.analyser;
      self._deps.stereoPannerRef.current = engine.stereoPanner;
      self._deps.bassFilterRef.current = engine.bassFilter;
      self._deps.limiterRef.current = engine.limiter;
      self._deps.webAudioInitializedRef.current = true;
      self._deps.webAudioAvailableRef.current = true;
      // audio.volume is locked at 1.0 by buildGraph() — do NOT restore user volume here.
      // All volume control flows through userGainRef (the single volume authority).
    },

    initWebAudio() {
      if (
        self._deps.webAudioInitializedRef.current ||
        typeof window === "undefined"
      )
        return;
      const audio = self._deps.audioRef.current;
      if (!audio) return;

      const engine = getWebAudioEngine();
      try {
        const { ok } = engine.createContextAndSource(audio);
        if (!ok) {
          self._deps.webAudioAvailableRef.current = false;
          self._deps.webAudioInitializedRef.current = false;
          return;
        }
        self._deps.audioCtxRef.current = engine.ctx;
        self._deps.sourceRef.current = engine.source;
        self._deps.mediaElementSourceElementRef.current = audio;

        self.connectWebAudioDownstream();

        recordAudioContextState(engine.ctx, "initWebAudio");

        // Bluetooth / headphone reconnect recovery.
        engine.registerContextRunningCallback(() => {
          const el = self._deps.audioRef.current;
          const s = self._deps.stateRef.current;
          // Resume if audio was interrupted by the OS (phone call, Siri, system event) —
          // not just when isPlaying is true, because onPause already set isPlaying:false.
          // playbackIntentBeforeHideRef stays true through the call; osInterrupted is set
          // by onPause specifically for this case.
          const hasIntent =
            s.isPlaying ||
            s.osInterrupted ||
            self._deps.playbackIntentBeforeHideRef.current;
          const userStopped =
            self._deps.userIntentPausedRef.current || self._deps.userPausedRef.current;
          if (!hasIntent || userStopped || !el || !el.paused) return;
          // 150 ms grace — let the OS fully stabilize the audio route before play().
          setTimeout(() => {
            const current = self._deps.stateRef.current;
            const elem = self._deps.audioRef.current;
            const stillHasIntent =
              current.isPlaying ||
              current.osInterrupted ||
              self._deps.playbackIntentBeforeHideRef.current;
            const stillUserStopped =
              self._deps.userIntentPausedRef.current || self._deps.userPausedRef.current;
            if (!stillHasIntent || stillUserStopped || !elem || !elem.paused) return;
            void playAudioIfNotPaused(elem, true, {
              command: PLAYBACK_COMMANDS.RECOVER,
              requestId: self._deps.activeCommandRef.current?.requestId || null,
              state: current,
              context: { source: "audio_context_reconnect" },
              effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
              mediaIdentity: current.currentTrack?.id ?? current.currentTrack?.slug ?? null,
            }).then((played) => {
              if (played) return;
              void playbackStateMachine.transition(
                PLAYBACK_ORCHESTRATION_EVENTS.RECOVERY_REQUESTED,
                { reason: "audio_context_reconnect_stall", resumeAfter: true }
              );
            });
          }, 150);
        });
      } catch (err) {
        console.warn(
          "[AUDIO] Web Audio graph init failed, routing direct:",
          err?.message || err
        );
        try {
          self._deps.analyserRef.current?.disconnect();
        } catch {}
        try {
          self._deps.stereoPannerRef.current?.disconnect();
        } catch {}
        try {
          self._deps.bassFilterRef.current?.disconnect();
        } catch {}
        // Emergency fallback: createMediaElementSource muted direct output.
        // Route source → emergency GainNode → destination so audio is audible and
        // mainGainRef.current is never null (crossfade/preview-fade code relies on it).
        // All normalization/EQ/limiting is lost but silence is never acceptable.
        try {
          const src = engine.source;
          const ctx = engine.ctx;
          const dst = ctx?.destination;
          if (src && ctx && dst) {
            const emergencyGain = ctx.createGain();
            emergencyGain.gain.value = self._deps.userVolumeRef.current;
            src.connect(emergencyGain);
            emergencyGain.connect(dst);
            self._deps.mainGainRef.current = emergencyGain;
            self._deps.userGainRef.current = emergencyGain;
          } else {
            self._deps.mainGainRef.current = null;
          }
        } catch {
          self._deps.mainGainRef.current = null;
        }
        self._deps.limiterRef.current = null;
        self._deps.analyserRef.current = null;
        self._deps.stereoPannerRef.current = null;
        self._deps.bassFilterRef.current = null;
        self._deps.webAudioInitializedRef.current = false;
        self._deps.webAudioAvailableRef.current = false;
      }
    },

    async attemptLightweightPlaybackResume(source, effectContext = {}) {
      const audio = self._deps.audioRef.current;
      const track = self._deps.stateRef.current.currentTrack;
      if (
        !audio ||
        !track ||
        self._deps.userPausedRef.current ||
        self._deps.userIntentPausedRef.current
      )
        return false;
      if (!hasIntactPlaybackTransport(audio, track)) return false;

      self._deps.internalPlaybackAuthorityRef.current = true;
      try {
        self.initWebAudio();
        await resumeWebAudioContextIfSuspended(self._deps.audioCtxRef);
        recordAudioContextState(
          self._deps.audioCtxRef.current,
          `lightweightResume:${source}`
        );
        if (!(await ensureWebAudioRunning(self._deps.audioCtxRef))) {
          return false;
        }

        if (track?.metadata?.access?.previewOnly && audio.currentTime >= PREVIEW_HARD_CAP_SEC) {
          audio.currentTime = 0;
        }

        if (audio.paused) {
          self._deps.skipPauseInterruptionRef.current = true;
          await playAudioIfNotPaused(audio, true, {
            command: PLAYBACK_COMMANDS.RECOVER,
            requestId: self._deps.activeCommandRef.current?.requestId || null,
            state: self._deps.stateRef.current,
            context: { source, lightweight: true },
            effectAuthorityMode:
              effectContext.effectAuthorityMode ?? PhysicalEffectAuthorityMode.CORE_CURRENT,
            effectGuardRequired: effectContext.effectGuardRequired === true,
            effectAuthority: effectContext.effectAuthority ?? null,
            canApplyEffect: effectContext.canApplyEffect,
            mediaIdentity:
              effectContext.mediaIdentity ?? track.id ?? track.slug ?? null,
          });
        }

        updateAudibilitySample(audio, self._deps.audibilitySampleRef);
        const params = self.getAudibilityParams();
        if (isAudioActuallyAudible(params)) return true;
        return !audio.paused && !audio.ended && audio.readyState >= 2;
      } catch {
        return false;
      } finally {
        self._deps.internalPlaybackAuthorityRef.current = false;
      }
    },

    // ─── CS Mode / Stream ────────────────────────────────────────────────────

    applyCsToElement(audio, presentation, resumeAt = null) {
      if (!audio || !presentation) return;
      audio.playbackRate = presentation.playbackRate ?? 1;
      if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
      if (typeof audio.webkitPreservePitch !== "undefined") audio.webkitPreservePitch = true;
      self._deps.csUsingAlternateSrcRef.current = Boolean(presentation.useCsSrc);
      if (resumeAt != null && resumeAt > 0) {
        const applySeek = () => {
          if (isFinite(audio.duration)) {
            audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
          }
        };
        if (isFinite(audio.duration) && audio.duration > 0) {
          applySeek();
        } else {
          audio.addEventListener("loadedmetadata", applySeek, { once: true });
        }
      }
    },

    async resolveLibraryStreamForTrack(track, { force = false, signal } = {}) {
      const slug = parseStreamSlugFromSrc(track.src) || track.slug;
      const trackSlug =
        track.trackSlug ||
        track.metadata?.trackSlug ||
        track.metadata?.track_slug ||
        parseStreamTrackSlugFromSrc(track.src) ||
        null;
      if (!slug || !isLibraryStreamSrc(track.src)) return { track, meta: null };

      self.patchState({ playbackNetworkState: "loading_stream" });
      const data = await fetchLibraryStream(slug, { force, signal, trackSlug });
      if (data?.contentType && !AUDIO_CONTENT_TYPE_RE.test(data.contentType)) {
        const err = new Error("stream_invalid_content_type");
        err.code = "INVALID_STREAM_CONTENT_TYPE";
        err.status = 415;
        err.slug = slug;
        throw err;
      }
      const meta = {
        slug,
        url: data.url,
        fetchedAt: Date.now(),
        expiresIn: data.expiresIn || 3600,
        streamEventId: data.streamEventId || null,
        sessionId: data.sessionId || null,
      };
      self._deps.streamMetaRef.current = meta;
      return {
        track: { ...track, src: data.url },
        meta,
      };
    },

    // Pre-buffer the next queue item while the current track is playing.
    // CDN tracks: load bytes directly into a hidden Audio element.
    // Library streams: pre-fetch the signed URL so the swap is instant.
    async scheduleNextTrackPreload() {
      // Adaptive preload: skip on slow connections (2G/slow-2G) — bandwidth is too scarce
      // to buffer the next track without starving the current one. Also skip while the
      // current track is still buffering for the same reason.
      if (typeof navigator !== "undefined") {
        const effectiveType = navigator.connection?.effectiveType;
        if (effectiveType === "slow-2g" || effectiveType === "2g") return;
      }
      if (self._deps.stateRef.current.isBuffering) return;
      // After a stall, give the current track 15 s of undivided bandwidth before
      // starting any preload that would compete with its recovery download.
      if (Date.now() - self._deps.recentStallTimeRef.current < 15_000) return;

      // Opportunistic sweep: any registered cache over its maxEntries limit is trimmed
      // here since scheduleNextTrackPreload runs as a natural playback-time background job.
      evictOverflowingCaches();

      const queue = self._deps.queueRef.current;
      const idx = self._deps.queueIndexRef.current;
      const nextIdx = idx + 1;
      if (nextIdx >= queue.length) return;
      const next = queue[nextIdx];
      if (!next?.src) return;
      const preloadEl = self._deps.nextTrackPreloadRef.current;
      if (!preloadEl) return;

      const kind = classifySourceUrl(next.src);
      if (isPlaybackTraceEnabled()) {
        logPlaybackEvent({
          type: "preload:schedule",
          source: "scheduleNextTrackPreload",
          trackId: next.slug,
          extra: { nextSlug: next.slug, nextIdx, kind, queueLength: queue.length },
        });
      }

      if (isDirectlyBufferable(kind)) {
        if (kind === SOURCE_KIND.REDIRECT) {
          // Preload the next redirect-path track with ?preload=1 so the stream route
          // buffers audio bytes without creating a session event.
          const normalized = normalizePlaybackSrc(next.src);
          if (!normalized) return;
          const preloadSrc = normalized.includes("preload=1")
            ? normalized
            : `${normalized}&preload=1`;
          if (preloadEl.src !== preloadSrc) {
            preloadEl.src = preloadSrc;
            preloadEl.load();
          }

          // For HLS-eligible tracks (Subscriber / Collector / Admin), also pre-fetch
          // the first segments into the in-memory segment cache. hls-prefetch-loader
          // serves them to hls.js at zero CDN latency, satisfying the buffer gate
          // in < 50 ms instead of 2–5 s (Spotify-level next-track start latency).
          // isHlsJsActive() guards against running this on Safari: Safari uses native
          // HLS (AVPlayer) and never consults the in-memory segment cache, so the
          // prefetch would waste ~500 KB of CDN bandwidth and one auth API call per
          // queued track with zero latency benefit for the user.
          if (next.metadata?.access?.canStream && isHlsJsActive()) {
            const hlsSlug = parseStreamSlugFromSrc(next.src) || next.slug;
            const hlsTrackSlug =
              parseStreamTrackSlugFromSrc(next.src) || next.metadata?.trackSlug || null;
            if (hlsSlug) void prefetchHlsSegmentsForTrack(hlsSlug, hlsTrackSlug);
          }
          return;
        }
        const normalized = normalizePlaybackSrc(next.src);
        if (normalized && preloadEl.src !== normalized) {
          preloadEl.src = normalized;
          preloadEl.load();
        }
      } else if (requiresSignedUrlFetch(kind)) {
        const slug = parseStreamSlugFromSrc(next.src) || next.slug;
        if (!slug) return;
        // Album/EP tracks carry both slug (release) and trackSlug (individual track).
        const trackSlug =
          parseStreamTrackSlugFromSrc(next.src) || next.metadata?.trackSlug || null;
        const cacheKey = trackSlug ? `${slug}:${trackSlug}` : slug;
        const cached = self._deps.nextTrackSignedUrlCacheRef.current[cacheKey];
        if (
          cached &&
          !streamUrlNeedsRefresh(cached) &&
          Date.now() - cached.fetchedAt < SIGNED_URL_CLIENT_TTL_MS
        )
          return;
        try {
          const data = await fetchLibraryStream(slug, { force: false, trackSlug });
          if (data?.url) {
            self._deps.nextTrackSignedUrlCacheRef.current[cacheKey] = {
              url: data.url,
              fetchedAt: Date.now(),
              expiresIn: data.expiresIn ?? 3600,
            };
            // Evict oldest when cache exceeds 20 entries to prevent unbounded growth.
            const cacheEntries = Object.entries(
              self._deps.nextTrackSignedUrlCacheRef.current
            );
            if (cacheEntries.length > 20) {
              let oldestKey = cacheEntries[0][0];
              let oldestAt = cacheEntries[0][1].fetchedAt;
              for (let i = 1; i < cacheEntries.length; i++) {
                if (cacheEntries[i][1].fetchedAt < oldestAt) {
                  oldestAt = cacheEntries[i][1].fetchedAt;
                  oldestKey = cacheEntries[i][0];
                }
              }
              delete self._deps.nextTrackSignedUrlCacheRef.current[oldestKey];
            }
            const normalized = normalizePlaybackSrc(data.url);
            if (normalized && preloadEl.src !== normalized) {
              preloadEl.src = normalized;
              preloadEl.load();
            }

            // For HLS-eligible tracks, also pre-fetch segments into the cache.
            // isHlsJsActive() prevents wasteful CDN fetches on Safari native HLS.
            if (next.metadata?.access?.canStream && isHlsJsActive()) {
              void prefetchHlsSegmentsForTrack(slug, trackSlug);
            }
          }
        } catch {
          // Non-fatal — next track fetches fresh on demand
        }
      }

      // 2nd-ahead passive preload: buffer index+2 CDN preview for deeper gapless coverage.
      const nnIdx = nextIdx + 1;
      if (nnIdx < queue.length && self._deps.nextNextTrackPreloadRef.current) {
        const nn = queue[nnIdx];
        const nnSrc = nn?.src;
        if (nnSrc) {
          const nnKind = classifySourceUrl(nnSrc);
          if (isDirectlyBufferable(nnKind)) {
            const nnNorm = normalizePlaybackSrc(nnSrc);
            const nnEl = self._deps.nextNextTrackPreloadRef.current;
            if (nnNorm && nnEl.src !== nnNorm) {
              nnEl.src = nnNorm;
              nnEl.load();
            }
          }
        }
      }
    },

    // Intent-signal preload — Spotify parity: buffer audio bytes the moment the user
    // signals intent (hover, touchstart, sheet/modal open) so waitAudioSrcReady gets
    // an instant HTTP-cache hit when play is pressed 150 ms – 5 s later.
    async hintUpcomingPlay(track) {
      if (!track?.src) return;
      if (typeof navigator !== "undefined") {
        const conn = navigator.connection;
        if (conn?.saveData) return;
        const et = conn?.effectiveType;
        if (et === "slow-2g" || et === "2g") return;
      }
      const preloadEl = self._deps.intentPrewarmRef.current;
      if (!preloadEl) return;

      const kind = classifySourceUrl(track.src);
      if (isDirectlyBufferable(kind)) {
        const normalized = normalizePlaybackSrc(track.src);
        if (!normalized) return;
        if (kind === SOURCE_KIND.REDIRECT) {
          if (track.metadata?.access?.canStream) {
            // HLS-eligible tracks: pre-fetch the manifest (~200 bytes) into the
            // HTTP cache so hls.js gets an instant cache hit on loadSource().
            // Loading the redirect URL into intentPrewarmRef is wasted here —
            // hls.js ignores it and loads the MSE manifest directly.
            const slug = parseStreamSlugFromSrc(track.src) || track.slug;
            if (slug) {
              fetch(`/api/library/hls?slug=${encodeURIComponent(slug)}`, { priority: "low" }).catch(() => {});
            }
            return;
          }
          const preloadSrc = normalized.includes("preload=1")
            ? normalized
            : `${normalized}&preload=1`;
          if (preloadEl.src !== preloadSrc) {
            preloadEl.src = preloadSrc;
            preloadEl.load();
          }
          return;
        }
        if (preloadEl.src !== normalized) {
          preloadEl.src = normalized;
          preloadEl.load();
        }
      } else if (requiresSignedUrlFetch(kind)) {
        const slug = parseStreamSlugFromSrc(track.src) || track.slug;
        if (!slug) return;
        const trackSlug =
          parseStreamTrackSlugFromSrc(track.src) || track.metadata?.trackSlug || null;
        const cacheKey = trackSlug ? `${slug}:${trackSlug}` : slug;
        const cached = self._deps.nextTrackSignedUrlCacheRef.current[cacheKey];
        if (
          cached &&
          !streamUrlNeedsRefresh(cached) &&
          Date.now() - cached.fetchedAt < SIGNED_URL_CLIENT_TTL_MS
        )
          return;
        try {
          const data = await fetchLibraryStream(slug, { force: false, trackSlug });
          if (data?.url) {
            self._deps.nextTrackSignedUrlCacheRef.current[cacheKey] = {
              url: data.url,
              fetchedAt: Date.now(),
              expiresIn: data.expiresIn ?? 3600,
            };
            // Evict oldest when cache exceeds 20 entries — mirrors scheduleNextTrackPreload.
            // hintUpcomingPlay is called on hover/touchstart for every visible card, so
            // without this guard the cache grows to the full catalog size.
            const hintEntries = Object.entries(self._deps.nextTrackSignedUrlCacheRef.current);
            if (hintEntries.length > 20) {
              let oldestKey = hintEntries[0][0];
              let oldestAt = hintEntries[0][1].fetchedAt;
              for (let i = 1; i < hintEntries.length; i++) {
                if (hintEntries[i][1].fetchedAt < oldestAt) {
                  oldestAt = hintEntries[i][1].fetchedAt;
                  oldestKey = hintEntries[i][0];
                }
              }
              delete self._deps.nextTrackSignedUrlCacheRef.current[oldestKey];
            }
            const isHlsEligible = Boolean(track.metadata?.access?.canStream);
            if (!isHlsEligible) {
              const normalized = normalizePlaybackSrc(data.url);
              if (normalized && preloadEl.src !== normalized) {
                preloadEl.src = normalized;
                preloadEl.load();
              }
            }
          }
        } catch {
          // Non-fatal — play fetches fresh on demand
        }
      }
    },

    setUserVolume(level) {
      const engine = getWebAudioEngine();
      engine.setUserVolume(level);
      self._deps.userVolumeRef.current = engine.getUserVolume();
      reportTransportMode({ volume: self._deps.userVolumeRef.current });
    },
  };

  return self;
}
