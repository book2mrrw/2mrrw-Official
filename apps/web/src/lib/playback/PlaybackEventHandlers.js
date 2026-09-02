/**
 * PlaybackEventHandlers — audio element event handler logic, extracted from AudioContext.js.
 *
 * Phase B-4a of the B+C architecture migration.
 * Each handler was previously defined inline inside a useEffect in AudioContext.js, closing over
 * component-scoped refs and callbacks. This factory receives all dependencies via injection,
 * preserving zero behavior change while decoupling the handler logic from the React render cycle.
 *
 * Architecture position:
 *   WebAudioEngine emits events → engine.on(EVENT, handlers.onX) wired in AudioContext.js
 *   handlers.onX reads authoritative state via stateRef (SM getter proxy) and mutates via
 *   patchState / syncProgressTime / SM.updateContext directly.
 *
 * Next phases:
 *   B-4b: Extract PlaybackCommandService (playTrackInternal, pause/resume/stop/seek/etc.)
 *   B-4c: Extract LifecycleRecoveryService
 */

import {
  fetchLibraryStream,
  isLibraryStreamRedirectSrc,
  isLibraryStreamSrc,
  parseStreamTrackSlugFromSrc,
} from "@/lib/playback/stream-client";
import { writeAvailabilityCache } from "@/lib/media/availability-cache";
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";
import { PhysicalEffectAuthorityMode } from "@/lib/audio/physical-effect-authority";
import { logPlaybackResilience } from "@/lib/diagnostics/state-churn-log";
import {
  waitAudioSrcReady,
  playAudioIfNotPaused,
  RESTORE_NEAR_END_BUFFER_SEC,
  isNearEndRestorePosition,
} from "@/lib/audio/audio-element-utils";
import { savePlaybackPosition } from "@/lib/playback/position-memory";
import { updateAudibilitySample } from "@/lib/playback/audibility";

import { dispatchPreviewEnded } from "@/lib/playback/playback-track-utils";
import { setResolvedCdnUrl } from "@/lib/playback/redirect-resolve-cache";
import { isDocumentPlaybackHidden } from "@/lib/playback/playback-transport-utils";
import {
  classifyAudioOutputSilence,
  capturePlaybackSnapshotOnPause,
  classifyPlaybackInterruption,
  isPlaybackTraceEnabled,
  logPlaybackEvent,
} from "@/lib/diagnostics/playback-trace";
import {
  logLifecycleAudioStateTransition,
  logOsSuspendDetected,
  logAudioOutputSilenceReason,
  logPlaybackIntentCaptured,
  logPlaybackIntentRetry,
  logBackgroundPlaybackStopped,
  logLockscreenMediaSessionActive,
  logPlaybackIntentState,
} from "@/lib/diagnostics/playback-trace";
import { sendControlSystemPlaybackEvent } from "@/lib/control-system/playback";
import {
  MARKS,
  perfMark,
  dumpPlaybackTiming,
  setPlaybackScenario,
  PLAYBACK_SCENARIOS,
  resetPlaybackTimingCapture,
} from "@/lib/dev/performanceMarks";
import { PLAYBACK_COMMANDS } from "@/lib/playback/playback-commands";
import {
  playbackStateMachine,
  PLAYBACK_ORCHESTRATION_EVENTS,
} from "@/media/PlaybackStateMachine";
import { classifySourceUrl, isDirectlyBufferable } from "@/lib/playback/audio-source-resolver";
import { normalizePlaybackSrc } from "@/lib/audio/audio-element-utils";
import { recoveryCoordinator } from "@/lib/playback/recovery-coordinator";

// ── Exported constants ─────────────────────────────────────────────────────────
// Defined here because handler logic is their primary consumer.
// AudioContext.js (for seekInternal, playTrackInternal) imports them from here.

export const LIFECYCLE_AUDIO_TRUTH_STATES = Object.freeze({
  USER_PLAYING: "USER_PLAYING",
  USER_PAUSED:  "USER_PAUSED",
  OS_SUSPENDED: "OS_SUSPENDED",
  RECOVERING:   "RECOVERING",
});

// ── Audibility watchdog ────────────────────────────────────────────────────────
// Some browsers (iOS Safari) do not reliably fire the 'playing' event after an
// HLS source swap, leaving isBuffering permanently true while audio is audible.
// This singleton polls at 150ms to detect that currentTime is advancing and
// clears the spinner exactly as onPlaying would. Module-level is safe because
// there is only one HTMLAudioElement / one active handler set at any time.
let _audWatchdogId = null;
let _audWatchdogLastTime = 0;

function _clearAudibilityWatchdog() {
  if (_audWatchdogId !== null) {
    clearInterval(_audWatchdogId);
    _audWatchdogId = null;
  }
}

function _startAudibilityWatchdog(audioRef, stateRef, patchState) {
  _clearAudibilityWatchdog();
  _audWatchdogLastTime = audioRef.current?.currentTime ?? 0;
  _audWatchdogId = setInterval(() => {
    const el = audioRef.current;
    if (!el || el.paused) { _clearAudibilityWatchdog(); return; }
    const t = el.currentTime;
    // Confirm audibility: time is advancing AND buffer is ready.
    if (t !== _audWatchdogLastTime && el.readyState >= 3) {
      _clearAudibilityWatchdog();
      if (stateRef.current?.isBuffering) {
        patchState({ isBuffering: false, playbackNetworkState: "playing" });
        playbackStateMachine.transition(PLAYBACK_ORCHESTRATION_EVENTS.BUFFER_END);
      }
    }
    _audWatchdogLastTime = t;
  }, 150);
}

export const PREVIEW_HARD_CAP_SEC = 15;
export const SPURIOUS_ENDED_GUARD_MS = 1200;

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Create the set of audio element event handlers.
 * Called once per effect run (when the audio element or any callback dep changes).
 * All handler bodies are verbatim from AudioContext.js — zero logic changes in B-4a.
 *
 * @param {object} deps — all refs and callbacks previously closed over in AudioContext.js useEffect
 * @returns {{ onPlay, onPause, onTime, onDuration, onEnded, onError, onEmptied,
 *             onWaiting, onStalled, onPlaying, onCanPlayThrough }}
 */
export function createPlaybackEventHandlers({
  // The audio element captured at useEffect run time.
  audio,

  // Refs (from engineRefsRef + local AudioProvider refs)
  stateRef,
  audioRef,
  audioCtxRef,
  mainGainRef,
  trackGainRef,
  userGainRef,
  activeCommandRef,
  activeStreamAbortRef,
  streamMetaRef,
  streamErrorRetriedRef,
  previewFadeInitRef,
  userPausedRef,
  userIntentPausedRef,
  skipPauseInterruptionRef,
  pendingResumeAfterInterruptRef,
  viewportPauseRef,
  playbackIntentBeforeHideRef,
  listeningProgressRef,
  lifecycleAudioTruthStateRef,
  lastMediaSessionPlaybackStateRef,
  recentStallTimeRef,
  bufferShowTimerRef,
  nextTrackPreloadRef,
  prevTrackPreloadRef,
  pendingSessionUpgradeRef,
  broadcastChannelRef,
  tabIdRef,
  audibilitySampleRef,
  lastPersistRef,
  playTrackRef,
  applyCSModeToTrackRef,
  dispatchPlaybackCommandRef,
  queueRef,
  queueIndexRef,
  repeatModeRef,
  shuffleRef,
  csModeRef,
  stopAfterEachTrackRef,
  onPreviewEndedRef,
  spuriousEndedGuardRef,
  sleepTimerRef,
  userVolumeRef,
  listeningUserIdRef,

  // Callbacks (useCallback from AudioContext.js)
  patchState,
  syncProgressTime,
  syncPositionState,
  startProgressRaf,
  stopProgressRaf,
  startKeepAlivePing,
  stopKeepAlivePing,
  startPositionSaveTimer,
  stopPositionSaveTimer,
  startStallRecovery,
  stopStallRecovery,
  updateMediaSession,
  finalizeStreamSession,
  recordLocalListening,
  tracePlayback,
  emitPhase21AudibleSnapshot,
  emitBackgroundPlaybackDiagnostics,
  scheduleNextTrackPreload,

  // SM UI channel write — replaces individual React state setters
  patchUI,
}) {

  // ── Private helpers ──────────────────────────────────────────────────────────

  const persistPlayback = (eventType = "progress") => {
    const track = stateRef.current.currentTrack;
    if (!track?.slug) return;
    const now = Date.now();
    const key = `${track.slug}:${eventType}`;
    if (eventType === "progress" && lastPersistRef.current.key === track.slug && now - lastPersistRef.current.at < 15000) {
      return;
    }
    lastPersistRef.current = { key: eventType === "progress" ? track.slug : key, at: now };
    fetch("/api/media/playback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        slug: track.slug,
        title: track.title,
        eventType,
        mediaType: "audio",
        source: track.source,
        positionSeconds: audio.currentTime,
        durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
        completed: eventType === "complete",
      }),
    }).catch((error) => {
      reportPlaybackDiagnostic({
        level: "warn",
        code: "PLAYBACK_EVENT_POST_FAILED",
        command: "PLAYBACK_EVENT_POST",
        requestId: activeCommandRef.current?.requestId || null,
        state: stateRef.current,
        error,
        context: { eventType, slug: track.slug },
      });
    });
    sendControlSystemPlaybackEvent(track, eventType, {
      mediaType: "audio",
      positionSeconds: audio.currentTime,
      durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
      completed: eventType === "complete",
    });
  };

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const onWaiting = () => {
    recentStallTimeRef.current = Date.now();
    startStallRecovery();
    if (bufferShowTimerRef.current) clearTimeout(bufferShowTimerRef.current);
    bufferShowTimerRef.current = setTimeout(() => {
      bufferShowTimerRef.current = null;
      const el = audioRef.current;
      const networkState = el && !el.played?.length ? "loading_stream" : "buffering";
      patchState({ isBuffering: true, playbackNetworkState: networkState });
      playbackStateMachine.transition(PLAYBACK_ORCHESTRATION_EVENTS.BUFFER_START);
      // Start the audibility watchdog. If the browser fails to fire 'playing' (iOS
      // Safari after an HLS source swap), the watchdog detects currentTime advancing
      // and clears isBuffering exactly as onPlaying would.
      _startAudibilityWatchdog(audioRef, stateRef, patchState);
    }, 500);
  };

  const onStalled = () => {
    recentStallTimeRef.current = Date.now();
    startStallRecovery();
    if (bufferShowTimerRef.current) clearTimeout(bufferShowTimerRef.current);
    bufferShowTimerRef.current = setTimeout(() => {
      bufferShowTimerRef.current = null;
      const el = audioRef.current;
      const networkState = el && !el.played?.length ? "loading_stream" : "buffering";
      patchState({ isBuffering: true, playbackNetworkState: networkState });
      playbackStateMachine.transition(PLAYBACK_ORCHESTRATION_EVENTS.BUFFER_START);
    }, 500);
  };

  const onPlaying = () => {
    if (bufferShowTimerRef.current) {
      clearTimeout(bufferShowTimerRef.current);
      bufferShowTimerRef.current = null;
    }
    _clearAudibilityWatchdog();
    stopStallRecovery();
    patchState({ isBuffering: false, playbackNetworkState: "playing" });
    playbackStateMachine.transition(PLAYBACK_ORCHESTRATION_EVENTS.BUFFER_END);
    perfMark(MARKS.PLAYBACK_AUDIBLE);
    perfMark(MARKS.AUDIO_START_LATENCY_END);
    dumpPlaybackTiming();
  };

  const onCanPlayThrough = () => {
    if (bufferShowTimerRef.current) {
      clearTimeout(bufferShowTimerRef.current);
      bufferShowTimerRef.current = null;
    }
    _clearAudibilityWatchdog();
    stopStallRecovery();
    perfMark(MARKS.PLAYBACK_CANPLAYTHROUGH);
    patchState({ isBuffering: false, playbackNetworkState: "playing" });
    playbackStateMachine.transition(PLAYBACK_ORCHESTRATION_EVENTS.BUFFER_END);
  };

  const onPlay = () => {
    // Cancel any pending buffer-show timer: onPlay means the element has started (or
    // resumed) playing, so isBuffering must not be set true by a stale 500ms timer that
    // fired after the element already began playing. Without this clear, the timer fires
    // after onPlay, sets isBuffering:true silently in transport, and the next context
    // emission (e.g. identity change) reads the stale true value — locking the spinner.
    if (bufferShowTimerRef.current) {
      clearTimeout(bufferShowTimerRef.current);
      bufferShowTimerRef.current = null;
    }
    _clearAudibilityWatchdog();
    userPausedRef.current = false;

    if (stateRef.current.source === "library_stream") {
      const audio_ = audioRef.current;
      if (audio_ && audio_.currentSrc && audio_.currentSrc !== audio_.src) {
        void updateMediaSession(stateRef.current.currentTrack, { playing: true }).catch(() => {});
      }
    }

    patchState({
      isPlaying: true,
      error: null,
      hasStarted: true,
      isBuffering: false,
      playbackNetworkState: "playing",
      osInterrupted: false,
    });
    // Advance SM to PLAYING so BUFFER_START/BUFFER_END transitions are live. Without this,
    // the SM stays in IDLE (LOAD_START/PLAY_SUCCESS were never dispatched previously) and
    // BUFFER_START is silently rejected, meaning the orchestration channel never fires to
    // clear the spinner when BUFFER_END arrives.
    playbackStateMachine.transition(PLAYBACK_ORCHESTRATION_EVENTS.PLAY_SUCCESS);
    startKeepAlivePing();
    startProgressRaf();
    startPositionSaveTimer();
    persistPlayback("play");
    const track = stateRef.current.currentTrack;
    if (track) {
      listeningProgressRef.current = { slug: track.slug, recorded30s: false };
      recordLocalListening(track, {
        positionSeconds: audio.currentTime || 0,
        durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
        completed: false,
      });
      void updateMediaSession(track, { playing: true });
      // Cache the resolved CDN URL for redirect-path tracks so replay skips the 302.
      // Compound key (albumSlug:trackSlug) prevents tracks in the same album from
      // overwriting each other's cached CDN URL.
      if (track.slug && isLibraryStreamRedirectSrc(track.src || "")) {
        const resolvedCdn = audio.currentSrc;
        if (resolvedCdn && resolvedCdn !== audio.src && !isLibraryStreamSrc(resolvedCdn)) {
          const onPlayTrackSlug = parseStreamTrackSlugFromSrc(track.src || "") || track.metadata?.trackSlug || null;
          const onPlayCacheKey = onPlayTrackSlug ? `${track.slug}:${onPlayTrackSlug}` : track.slug;
          setResolvedCdnUrl(onPlayCacheKey, resolvedCdn);
        }
      }
    }
    logLifecycleAudioStateTransition({
      source: "onPlay",
      classification: "USER_PLAYING",
      reactIsPlaying: true,
      elementPaused: audio.paused,
      ctxState: audioCtxRef.current?.state ?? null,
      slug: track?.slug ?? null,
    });
    lifecycleAudioTruthStateRef.current = LIFECYCLE_AUDIO_TRUTH_STATES.USER_PLAYING;
    lastMediaSessionPlaybackStateRef.current = "playing";
    emitPhase21AudibleSnapshot("onPlay");
    // Begin buffering the next queue item — delayed so the current track builds a healthy
    // decode buffer before any competing download starts. Short tracks use a proportional delay.
    {
      const knownDur = isFinite(audioRef.current?.duration) ? audioRef.current.duration : 0;
      const preloadDelayMs = knownDur > 0
        ? Math.max(500, Math.min(3000, knownDur * 0.15 * 1000))
        : 3000;
      setTimeout(() => {
        if (stateRef.current.isPlaying && !stateRef.current.isBuffering) {
          void scheduleNextTrackPreload();
        }
      }, preloadDelayMs);
    }

    // Broadcast to other tabs so they pause (last-tab-wins coordination).
    const bc = broadcastChannelRef.current;
    if (bc) {
      try { bc.postMessage({ type: "play-started", tabId: tabIdRef.current }); } catch {}
    }

    // Prime the previous-track element for back-navigation (CDN preview only).
    const prevIdx = queueIndexRef.current - 1;
    if (prevIdx >= 0 && prevTrackPreloadRef.current) {
      const prevTrack = queueRef.current[prevIdx];
      const prevSrc = prevTrack?.src;
      if (prevSrc) {
        const prevKind = classifySourceUrl(prevSrc);
        if (isDirectlyBufferable(prevKind)) {
          const prevNorm = normalizePlaybackSrc(prevSrc);
          if (prevNorm && prevTrackPreloadRef.current.src !== prevNorm) {
            prevTrackPreloadRef.current.src = prevNorm;
            prevTrackPreloadRef.current.load();
          }
        }
      }
    }

    // Dispatch stream upgrade for session-restore plays (callers don't schedule it).
    const pendingUpgrade = pendingSessionUpgradeRef.current;
    if (pendingUpgrade && stateRef.current.currentTrack?.slug === pendingUpgrade) {
      pendingSessionUpgradeRef.current = null;
      const upgradeSlug = pendingUpgrade;
      setTimeout(() => {
        if (stateRef.current.currentTrack?.slug === upgradeSlug) {
          void dispatchPlaybackCommandRef.current?.("upgradeStream");
        }
      }, 4000);
    }
  };

  const onPause = () => {
    // Cancel any pending buffer-show timer so a user or OS pause doesn't end up
    // showing the spinner after the element is already paused.
    if (bufferShowTimerRef.current) {
      clearTimeout(bufferShowTimerRef.current);
      bufferShowTimerRef.current = null;
    }
    _clearAudibilityWatchdog();
    stopStallRecovery();
    if (previewFadeInitRef.current) {
      const gain = userGainRef.current;
      const ctx = audioCtxRef.current;
      if (gain && ctx) {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        // Ramp back over 80 ms — inaudible while paused, prevents gain-snap pop
        gain.gain.linearRampToValueAtTime(userVolumeRef.current, now + 0.08);
      }
    }
    const userInitiated = userPausedRef.current;
    const wasViewportPause = viewportPauseRef.current;
    userPausedRef.current = false;

    if (skipPauseInterruptionRef.current) {
      skipPauseInterruptionRef.current = false;
      tracePlayback("pauseSkipped", "onPause", { reason: "skipPauseInterruption" });
      return;
    }

    tracePlayback("pause", "onPause", { userInitiated, wasViewportPause });
    const sBeforePause = stateRef.current;
    const wasPlayingBeforePause =
      sBeforePause.isPlaying &&
      sBeforePause.hasStarted &&
      !userInitiated &&
      !wasViewportPause;
    if (wasPlayingBeforePause) {
      playbackIntentBeforeHideRef.current = true;
      logPlaybackIntentCaptured({
        source: "onPause",
        trackId:
          sBeforePause.currentTrack?.id ?? sBeforePause.currentTrack?.slug ?? null,
        slug: sBeforePause.currentTrack?.slug ?? null,
        wasPlayingBeforePause: true,
      });
      logPlaybackIntentState({
        source: "onPause_capture",
        intent: true,
        hidden: isDocumentPlaybackHidden(),
        slug: sBeforePause.currentTrack?.slug ?? null,
      });
      logBackgroundPlaybackStopped({
        source: "onPause",
        userInitiated,
        wasViewportPause,
        hidden: isDocumentPlaybackHidden(),
        slug: sBeforePause.currentTrack?.slug ?? null,
      });
      emitBackgroundPlaybackDiagnostics("onPause_interrupt");
      const silenceReason = classifyAudioOutputSilence({
        audio,
        webAudioContext: audioCtxRef.current,
        userPaused: false,
        playbackIntent: true,
      });
      logOsSuspendDetected({
        source: "onPause",
        hidden: isDocumentPlaybackHidden(),
        elementPaused: audio.paused,
        ctxState: audioCtxRef.current?.state ?? null,
        slug: sBeforePause.currentTrack?.slug ?? null,
      });
      logAudioOutputSilenceReason({
        source: "onPause",
        reason: silenceReason,
        classification: "OS_SUSPENDED",
        slug: sBeforePause.currentTrack?.slug ?? null,
      });
      logLifecycleAudioStateTransition({
        source: "onPause",
        classification: "OS_SUSPENDED",
        prevReactIsPlaying: sBeforePause.isPlaying,
        nextReactIsPlaying: false,
        mediaSessionPreserved: true,
        playbackIntent: true,
        slug: sBeforePause.currentTrack?.slug ?? null,
      });
      if (audio.paused) {
        setTimeout(() => {
          // Do not auto-resume during an intentional track-change load.
          // "loading_stream" means playTrackInternal is setting up a new src and will
          // call play() once the buffer gate clears. Resuming here bypasses the gate,
          // triggering an immediate buffer underrun — the modal auto-play starts-then-
          // stops bug: audio plays for <1 s, stalls, then appears to have stopped.
          // Spurious double-pause events (audio.load() on an already-paused element on
          // iOS Safari / Chrome mobile) trigger this onPause path — this guard ensures
          // those spurious events never race against playTrackInternal's buffer gate.
          if (
            !userPausedRef.current &&
            !userIntentPausedRef.current &&
            stateRef.current.playbackNetworkState !== "loading_stream"
          ) {
            void playAudioIfNotPaused(audio, true, {
              command: PLAYBACK_COMMANDS.RECOVER,
              requestId: activeCommandRef.current?.requestId || null,
              state: stateRef.current,
              context: { source: "onPause_os_suspend" },
              effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
            });
          }
        }, 0);
      }
    }
    if (userInitiated) {
      playbackIntentBeforeHideRef.current = false;
      // A user-initiated pause must cancel any pending OS-interrupt canplay listener.
      // Without this, if an OS event (headphone disconnect, phone call) registered a
      // canplay auto-resume listener and the user then explicitly pauses, the stale
      // listener fires on the next canplay event and overrides the user's pause intent.
      if (pendingResumeAfterInterruptRef.current) {
        audio.removeEventListener("canplay", pendingResumeAfterInterruptRef.current);
        pendingResumeAfterInterruptRef.current = null;
      }
      logLifecycleAudioStateTransition({
        source: "onPause",
        classification: "USER_PAUSED",
        slug: sBeforePause.currentTrack?.slug ?? null,
      });
      logAudioOutputSilenceReason({
        source: "onPause",
        reason: "user_paused",
        classification: "USER_PAUSED",
        slug: sBeforePause.currentTrack?.slug ?? null,
      });
    }
    if (!userInitiated && !wasViewportPause) {
      const s = stateRef.current;
      const snap = capturePlaybackSnapshotOnPause({
        trackId: s.currentTrack?.id ?? s.currentTrack?.slug ?? null,
        queue: queueRef.current,
        queueIndex: queueIndexRef.current,
        position: audio.currentTime ?? s.currentTime ?? 0,
        isPlaying: s.isPlaying,
        playbackState: s.playbackState,
        userInitiated,
        viewportPause: wasViewportPause,
        source: "onPause",
      });
      classifyPlaybackInterruption({
        viewportPause: wasViewportPause,
        authLoading: false,
        playbackState: s.playbackState,
        lastEvents: snap?.lastEvents,
      });
    }

    stopKeepAlivePing();
    stopProgressRaf();
    // Save position on OS-initiated pauses (phone call, headphone disconnect, interruption)
    // before the interval timer is cleared. User-initiated pauses skip this because the
    // 15s timer already covers them and a redundant save adds no value.
    if (!userInitiated && !wasViewportPause && !skipPauseInterruptionRef.current) {
      const osTrack = stateRef.current.currentTrack;
      const osUserId = listeningUserIdRef.current;
      if (osTrack?.slug && osUserId && isFinite(audio.duration) && audio.duration > 0) {
        const osPos = audio.currentTime || 0;
        if (!isNearEndRestorePosition(osPos, audio.duration)) {
          savePlaybackPosition(osUserId, osTrack.slug, osPos, audio.duration);
        }
      }
    }
    stopPositionSaveTimer();
    // If the Recovery Coordinator is managing an active transition — stall recovery,
    // stream upgrade, or signed-URL swap — this pause is part of a controlled handoff.
    // Setting isPlaying:false here destroys the play intent that coordinator-managed
    // resume depends on. The coordinator signals completion via onPlaybackResumed().
    // Exception: a user-initiated pause ALWAYS wins — the user's intent supersedes
    // any in-flight recovery, and the button must immediately reflect paused state.
    if (userInitiated || !recoveryCoordinator.isActive()) {
      patchState({ isPlaying: false, playbackNetworkState: "idle", isBuffering: false });
      playbackStateMachine.transition(PLAYBACK_ORCHESTRATION_EVENTS.PLAY_PAUSE);
    }
    persistPlayback("pause");

    const track = stateRef.current.currentTrack;
    const preserveLockScreenPlaying =
      wasPlayingBeforePause && playbackIntentBeforeHideRef.current;
    if (track) {
      void updateMediaSession(track, {
        playing: preserveLockScreenPlaying,
      });
      if (preserveLockScreenPlaying) {
        lastMediaSessionPlaybackStateRef.current = "playing";
        logLockscreenMediaSessionActive({
          source: "onPause_preserve",
          slug: track.slug ?? null,
        });
      }
    } else if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.playbackState = preserveLockScreenPlaying
        ? "playing"
        : "paused";
    }

    if (viewportPauseRef.current || false) {
      viewportPauseRef.current = false;
    } else if (!userInitiated && track && audio.paused) {
      const shouldResumeAfterInterrupt =
        wasPlayingBeforePause || playbackIntentBeforeHideRef.current;
      if (shouldResumeAfterInterrupt) {
        // Remove any previously-registered interrupt listener before adding a new one.
        // Without this, rapid OS interrupts (e.g. phone call → AirPods swap → Siri)
        // accumulate listeners that each fire on the next canplay, calling play() N times.
        if (pendingResumeAfterInterruptRef.current) {
          audio.removeEventListener("canplay", pendingResumeAfterInterruptRef.current);
          pendingResumeAfterInterruptRef.current = null;
        }
        const resumeAfterInterrupt = () => {
          pendingResumeAfterInterruptRef.current = null;
          if (
            (wasPlayingBeforePause || playbackIntentBeforeHideRef.current) &&
            audio.paused &&
            !userIntentPausedRef.current
          ) {
            logPlaybackIntentRetry({
              source: "onPause_canplay",
              trackId: track?.id ?? track?.slug ?? null,
              slug: track?.slug ?? null,
            });
            void playAudioIfNotPaused(audio, true, {
              command: PLAYBACK_COMMANDS.RECOVER,
              requestId: activeCommandRef.current?.requestId || null,
              state: stateRef.current,
              context: { source: "onPause_canplay_interrupt" },
              effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
            });
          }
        };
        pendingResumeAfterInterruptRef.current = resumeAfterInterrupt;
        audio.addEventListener("canplay", resumeAfterInterrupt, { once: true });
        // Mark state as OS-interrupted so the player button shows buffering/loading
        // instead of ▶ Play. Cleared on the next onPlay event.
        patchState({ osInterrupted: true });
      }
    }
    emitPhase21AudibleSnapshot("onPause");
  };

  const onTime = () => {
    if (!audio.paused && !audio.ended) {
      updateAudibilitySample(audio, audibilitySampleRef);
    }
    persistPlayback("progress");
    syncPositionState(false);

    const track = stateRef.current.currentTrack;
    const previewOnly = track?.metadata?.access?.previewOnly;

    if (previewOnly && audio.currentTime >= PREVIEW_HARD_CAP_SEC - 2) {
      // Schedule the userGain fade once via Web Audio API for sample-accurate smoothness.
      // Per-frame audio.volume assignments are replaced by a single scheduled ramp —
      // GainNode automation runs on the audio thread, not the main thread.
      if (!previewFadeInitRef.current) {
        previewFadeInitRef.current = true;
        const gain = userGainRef.current;
        const ctx = audioCtxRef.current;
        if (gain && ctx && ctx.state === "running") {
          const rem = Math.max(0.05, PREVIEW_HARD_CAP_SEC - audio.currentTime);
          const now = ctx.currentTime;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(userVolumeRef.current, now);
          gain.gain.linearRampToValueAtTime(0, now + rem);
        }
      }

      if (audio.currentTime >= PREVIEW_HARD_CAP_SEC) {
        previewFadeInitRef.current = false;
        skipPauseInterruptionRef.current = true;
        audio.pause();
        // Restore gain after pause. Pin to 0 first so any residual ramp drift
        // doesn't create a discontinuity, then ramp back over 80 ms — inaudible
        // while the element is paused, and eliminates the post-fade pop.
        const gain = userGainRef.current;
        const ctx = audioCtxRef.current;
        if (gain && ctx) {
          const now = ctx.currentTime;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(userVolumeRef.current, now + 0.08);
        }
        syncProgressTime(0);
        patchState({
          isPlaying: false,
          playbackState: "ended_preview",
        });
        patchUI({ previewEnded: true });
        onPreviewEndedRef.current?.(track);
        dispatchPreviewEnded(track.slug);
      }
      return;
    }

    if (track?.slug && audio.currentTime >= 30) {
      if (listeningProgressRef.current.slug !== track.slug) {
        listeningProgressRef.current = { slug: track.slug, recorded30s: false };
      }
      if (!listeningProgressRef.current.recorded30s) {
        listeningProgressRef.current.recorded30s = true;
        recordLocalListening(track, {
          positionSeconds: audio.currentTime,
          durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
          completed: false,
        });
      }
    }

    // Sleep timer: pause when the scheduled end time is reached.
    if (sleepTimerRef.current.endsAt && Date.now() >= sleepTimerRef.current.endsAt) {
      sleepTimerRef.current = { endsAt: null, afterCurrentTrack: false };
      patchUI({ sleepTimerEndsAt: null, sleepAfterCurrentTrack: false });
      audio.pause();
      userPausedRef.current = true;
      patchState({ isPlaying: false, playbackState: "paused" });
    }

    // Preload safety-net: if within 30s of track end and the preload element has no
    // buffered audio data (readyState < 2), retrigger preload to ensure gapless bytes.
    const PRELOAD_LEAD_SEC = 30;
    const cfDur = isFinite(audio.duration) ? audio.duration : 0;
    const cfRem = cfDur > 0 ? cfDur - audio.currentTime : 0;
    if (
      !previewOnly &&
      cfDur > 10 &&
      cfRem > 5 &&
      cfRem <= PRELOAD_LEAD_SEC
    ) {
      const preloadEl = nextTrackPreloadRef.current;
      if (preloadEl && preloadEl.readyState < 2) {
        void scheduleNextTrackPreload();
      }
    }
  };

  const onDuration = () => patchState({ duration: isFinite(audio.duration) ? audio.duration : 0 });

  const onEnded = () => {
    const track = stateRef.current.currentTrack;
    const previewOnly = track?.metadata?.access?.previewOnly;

    if (stateRef.current.isPlaying) {
      patchState({ isPlaying: false });
    }

    if (Date.now() < spuriousEndedGuardRef.current) {
      const dur = isFinite(audio.duration) ? audio.duration : 0;
      if (dur > 0 && audio.currentTime >= dur - RESTORE_NEAR_END_BUFFER_SEC) {
        audio.currentTime = Math.max(0, dur - RESTORE_NEAR_END_BUFFER_SEC - 0.5);
      } else {
        audio.currentTime = 0;
      }
      patchState({
        playbackState: stateRef.current.playbackState === "ending" ? null : stateRef.current.playbackState,
      });
      syncProgressTime(audio.currentTime);
      return;
    }

    if (previewOnly) {
      // If a session upgrade is already queued for this track, fire it now instead
      // of dropping into preview-ended state (user just unlocked while playing preview).
      const pendingUpgrade = pendingSessionUpgradeRef.current;
      if (pendingUpgrade && track?.slug === pendingUpgrade) {
        pendingSessionUpgradeRef.current = null;
        void dispatchPlaybackCommandRef.current?.("upgradeStream");
        return;
      }
      // Restore gain if the preview fade was in progress when the file ended naturally
      // (file shorter than PREVIEW_HARD_CAP_SEC). Same pop-free ramp used by the hard cap.
      if (previewFadeInitRef.current) {
        previewFadeInitRef.current = false;
        const gain = userGainRef.current;
        const ctx = audioCtxRef.current;
        if (gain && ctx) {
          const now = ctx.currentTime;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(userVolumeRef.current, now + 0.08);
        }
      }
      stopProgressRaf();
      stopPositionSaveTimer();
      audio.currentTime = 0;
      patchState({ isPlaying: false, playbackState: "ended_preview" });
      syncProgressTime(0);
      patchUI({ previewEnded: true });
      onPreviewEndedRef.current?.(track);
      dispatchPreviewEnded(track?.slug);
      if (track) void updateMediaSession(track, { playing: false });
      return;
    }

    const meta = streamMetaRef.current;
    if (meta) {
      finalizeStreamSession(meta, {
        completed: true,
        durationSeconds: isFinite(audio.duration) ? audio.duration : audio.currentTime,
      });
    }
    if (track?.slug) {
      recordLocalListening(track, {
        positionSeconds: isFinite(audio.duration) ? audio.duration : audio.currentTime,
        durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
        completed: true,
      });
      listeningProgressRef.current = { slug: null, recorded30s: false };
    }
    stopProgressRaf();
    stopPositionSaveTimer();
    persistPlayback("complete");
    patchState({ playbackState: "ending" });

    const repeatMode = repeatModeRef.current;
    const queue = queueRef.current;
    const queueIndex = queueIndexRef.current;
    const endedTrackSlug = track?.slug;
    if (!endedTrackSlug) return;

    const finishEnded = () => {
      // If the user tapped a new track between the `ended` event and this microtask,
      // currentTrack will have changed — stale auto-advance must not proceed.
      if (stateRef.current.currentTrack?.slug !== endedTrackSlug) return;

      if (repeatMode === "one" && stateRef.current.currentTrack) {
        audio.currentTime = 0;
        void playAudioIfNotPaused(audio, true, {
          command: PLAYBACK_COMMANDS.COMPLETE,
          requestId: activeCommandRef.current?.requestId || null,
          state: stateRef.current,
          context: { source: "finishEnded_repeat_one" },
          effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
        });
        return;
      }

      // Singles/features mode: stop after this track unless repeat-all is on
      if (stopAfterEachTrackRef.current && repeatMode !== "all") {
        patchState({ isPlaying: false, playbackState: "idle" });
        syncProgressTime(0);
        patchUI({ previewEnded: false });
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
        }
        if (track) void updateMediaSession(track, { playing: false });
        return;
      }

      // Sleep after current track
      if (sleepTimerRef.current.afterCurrentTrack) {
        sleepTimerRef.current = { endsAt: null, afterCurrentTrack: false };
        patchUI({ sleepTimerEndsAt: null, sleepAfterCurrentTrack: false, previewEnded: false });
        patchState({ isPlaying: false, playbackState: "idle" });
        syncProgressTime(0);
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
        }
        if (track) void updateMediaSession(track, { playing: false });
        return;
      }

      if (queue.length > 0) {
        let nextIndex = queueIndex + 1;
        if (shuffleRef.current && queue.length > 1) {
          nextIndex = advanceShuffleOrder(queue, queueIndex);
        } else if (nextIndex >= queue.length) {
          if (repeatMode === "all") nextIndex = 0;
          else {
            // End of queue, no repeat: wrap silently to track 1, stay paused
            const firstTrack = queue[0];
            queueIndexRef.current = 0;
            skipPauseInterruptionRef.current = true;
            audio.removeAttribute("src");
            audio.load();
            patchState({
              isPlaying: false,
              playbackState: "paused",
              queueIndex: 0,
              currentTrack: firstTrack || track,
              currentTrackId: firstTrack?.id || firstTrack?.trackId || null,
            });
            syncProgressTime(0);
            patchUI({ previewEnded: false });
            if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
              navigator.mediaSession.playbackState = "paused";
            }
            void updateMediaSession(firstTrack || track, { playing: false });
            return;
          }
        }
        let attempts = 0;
        while (attempts < queue.length) {
          const nextTrack = queue[nextIndex];
          if (!nextTrack?.src) {
            nextIndex += 1;
            if (nextIndex >= queue.length) {
              if (repeatMode === "all") nextIndex = 0;
              else {
                const firstTrack = queue[0];
                queueIndexRef.current = 0;
                skipPauseInterruptionRef.current = true;
                audio.removeAttribute("src");
                audio.load();
                patchState({
                  isPlaying: false,
                  playbackState: "paused",
                  queueIndex: 0,
                  currentTrack: firstTrack || track,
                  currentTrackId: firstTrack?.id || firstTrack?.trackId || null,
                });
                syncProgressTime(0);
                patchUI({ previewEnded: false });
                if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
                  navigator.mediaSession.playbackState = "paused";
                }
                void updateMediaSession(firstTrack || track, { playing: false });
                return;
              }
            }
            attempts += 1;
            continue;
          }
          queueIndexRef.current = nextIndex;
          patchState({ queueIndex: nextIndex });
          resetPlaybackTimingCapture();
          setPlaybackScenario(PLAYBACK_SCENARIOS.QUEUE_AUTO_ADVANCE, { source: "ended-handler" });
          // Block any spurious second `ended` from the audio element while
          // playTrackInternal is still setting up the next track's src. Without
          // this, a fast second `ended` (e.g. from a src swap race) sees the same
          // endedTrackSlug and calls playTrackRef a second time.
          spuriousEndedGuardRef.current = Date.now() + SPURIOUS_ENDED_GUARD_MS;
          perfMark(MARKS.PLAYBACK_TAP);
          if (isPlaybackTraceEnabled()) {
            const preloadEl = nextTrackPreloadRef.current;
            logPlaybackEvent({
              type: "tracklist:auto-advance",
              source: "onEnded",
              trackId: nextTrack.slug,
              extra: {
                endedSlug: endedTrackSlug,
                nextSlug: nextTrack.slug,
                nextIndex,
                queueLength: queue.length,
                preloadReadyState: preloadEl?.readyState ?? -1,
                preloadSrcTail: preloadEl?.src ? preloadEl.src.slice(-80) : null,
                preloadCurrentSrcTail: preloadEl?.currentSrc ? preloadEl.currentSrc.slice(-80) : null,
              },
            });
          }
          void playTrackRef.current?.(nextTrack, {
            resumeAt: 0,
            playbackScenario: PLAYBACK_SCENARIOS.QUEUE_AUTO_ADVANCE,
          }).then((ok) => {
            if (ok && csModeRef.current) void applyCSModeToTrackRef.current?.(nextTrack);
          });
          return;
        }
      }

      patchState({ isPlaying: false, playbackState: "idle" });
      syncProgressTime(0);
      patchUI({ previewEnded: false });
      if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "none";
      }
      if (track) void updateMediaSession(track, { playing: false });
    };

    queueMicrotask(finishEnded);
  };

  const onError = async () => {
    stopStallRecovery();
    const track = stateRef.current.currentTrack;
    const slug = track?.slug || streamMetaRef.current?.slug;
    const at = new Date().toISOString();
    const mediaError = audio.error;
    reportPlaybackDiagnostic({
      level: "warn",
      code: "AUDIO_ELEMENT_ERROR",
      command: PLAYBACK_COMMANDS.PLAY_TRACK,
      requestId: activeCommandRef.current?.requestId || null,
      state: stateRef.current,
      context: {
        slug,
        mediaErrorCode: mediaError?.code ?? null,
        src: audio.currentSrc || audio.src || null,
        at,
      },
    });
    logPlaybackResilience("stream-error", {
      source: "AudioContext",
      code: "AUDIO_ELEMENT_ERROR",
      slug,
      mediaErrorCode: mediaError?.code ?? null,
    });

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const onOnline = () => {
        window.removeEventListener("online", onOnline);
        const current = stateRef.current.currentTrack;
        if (current) {
          streamErrorRetriedRef.current = 0;
          void playTrackRef.current?.(current, {
            resumeAt: audio.currentTime || 0,
            forceStream: true,
          });
        }
      };
      window.addEventListener("online", onOnline);
      patchState({ error: "RECONNECTING", isBuffering: true, playbackNetworkState: "retrying_stream" });
      return;
    }

    const meta = streamMetaRef.current;
    const resumeAt = audio.currentTime || 0;

    const onLibraryStreamSrc =
      isLibraryStreamSrc(audio.currentSrc || audio.src || "") ||
      isLibraryStreamSrc(track?.src || "");
    const MAX_STREAM_RETRIES = 3;
    if (slug && (streamMetaRef.current || onLibraryStreamSrc) && streamErrorRetriedRef.current < MAX_STREAM_RETRIES) {
      streamErrorRetriedRef.current += 1;
      const attempt = streamErrorRetriedRef.current;
      const retryRequestId = activeCommandRef.current?.requestId;
      // Exponential backoff: immediate on first error, 2s on second, 5s on third.
      // Gives transient network blips time to clear without stranding the user.
      const retryDelayMs = attempt === 1 ? 0 : attempt === 2 ? 2000 : 5000;
      if (retryDelayMs > 0) {
        patchState({ playbackNetworkState: "retrying_stream", isBuffering: true, error: `Reconnecting… (attempt ${attempt}/${MAX_STREAM_RETRIES})` });
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        if (activeCommandRef.current?.requestId !== retryRequestId) return;
      }
      patchState({ playbackNetworkState: "retrying_stream", isBuffering: true });
      try {
        const data = await fetchLibraryStream(slug, { force: true, signal: activeStreamAbortRef.current?.signal });
        // Bail if a new track command superseded this error-retry
        if (activeCommandRef.current?.requestId !== retryRequestId) return;
        streamMetaRef.current = {
          slug,
          url: data.url,
          fetchedAt: Date.now(),
          expiresIn: data.expiresIn || 3600,
          streamEventId: data.streamEventId || meta?.streamEventId || null,
          sessionId: data.sessionId || meta?.sessionId || null,
        };
        skipPauseInterruptionRef.current = true;
        await waitAudioSrcReady(audio, data.url, { signal: activeStreamAbortRef.current?.signal });
        // Check again after the potentially long src-ready wait
        if (activeCommandRef.current?.requestId !== retryRequestId) return;
        if (resumeAt > 0) {
          let seekAfterLoadTimeout;
          const seekAfterLoad = () => {
            clearTimeout(seekAfterLoadTimeout);
            if (resumeAt > 0 && isFinite(audio.duration)) {
              audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
            }
          };
          if (isFinite(audio.duration) && audio.duration > 0) {
            seekAfterLoad();
          } else {
            audio.addEventListener("loadedmetadata", seekAfterLoad, { once: true });
            seekAfterLoadTimeout = setTimeout(
              () => audio.removeEventListener("loadedmetadata", seekAfterLoad),
              5000
            );
          }
        }
        const retryPlayed = await playAudioIfNotPaused(audio, true, {
          command: PLAYBACK_COMMANDS.PLAY_TRACK,
          requestId: activeCommandRef.current?.requestId || null,
          state: stateRef.current,
          context: { source: "onError_stream_retry" },
          effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
        });
        if (!retryPlayed || audio.paused) {
          patchState({
            isPlaying: false,
            error: "Stream unavailable — tap to retry",
            streamRetryable: true,
            isBuffering: false,
            playbackState: "paused",
            playbackNetworkState: "error_stream",
          });
          return;
        }
        // A successful retry fully recovered playback — reset the budget so an
        // unrelated later blip on this same track gets its own full 3 attempts,
        // instead of inheriting whatever count this one happened to reach.
        streamErrorRetriedRef.current = 0;
        patchState({
          error: null,
          streamRetryable: false,
          isBuffering: false,
          hasStarted: true,
          playbackState: "playing",
          playbackNetworkState: "playing",
        });
        return;
      } catch (retryErr) {
        if (retryErr?.code === "ACCESS_DENIED") {
          finalizeStreamSession(meta, { durationSeconds: resumeAt, completed: false });
          streamErrorRetriedRef.current = 0;
          if (!audio.paused) skipPauseInterruptionRef.current = true;
          audio.pause();
          patchState({
            isPlaying: false,
            accessDenied: true,
            streamRetryable: false,
            error: "Access unavailable",
            playbackNetworkState: "error_stream",
          });
          if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "none";
          }
          return;
        }
      }
    }

    if (meta) {
      finalizeStreamSession(meta, {
        completed: false,
        durationSeconds: resumeAt,
      });
    }

    // Auto-advance past unrecoverable track errors (missing file, 404, expired URL) to match
    // Spotify/Apple Music behavior — the queue never stops because one file is unavailable.
    // Only skip when in a multi-track queue where auto-advance makes sense.
    const errQueue = queueRef.current;
    const errQueueIdx = queueIndexRef.current;
    if (!stopAfterEachTrackRef.current && errQueue.length > 0) {
      let skipIdx = errQueueIdx + 1;
      while (skipIdx < errQueue.length) {
        const skipTrack = errQueue[skipIdx];
        if (skipTrack?.src) {
          queueIndexRef.current = skipIdx;
          patchState({ queueIndex: skipIdx });
          void playTrackRef.current?.(skipTrack, { resumeAt: 0, playbackScenario: PLAYBACK_SCENARIOS.QUEUE_AUTO_ADVANCE });
          return;
        }
        skipIdx += 1;
      }
    }

    patchState({
      isPlaying: false,
      error: "Stream unavailable — tap to retry",
      streamRetryable: true,
      isBuffering: false,
      playbackNetworkState: "error_stream",
    });
  };

  const onEmptied = () => {
    stopProgressRaf();
    syncProgressTime(0);
    if (stateRef.current.playbackState !== "loading") {
      patchState({ duration: 0 });
    }
  };

  return {
    onPlay,
    onPause,
    onTime,
    onDuration,
    onEnded,
    onError,
    onEmptied,
    onWaiting,
    onStalled,
    onPlaying,
    onCanPlayThrough,
  };
}
