"use client";

import { useCallback, startTransition, useMemo } from "react";
import { dispatchPlaybackCommand } from "@/lib/playback/command-dispatcher";
import { getProductionPlaybackCore } from "@/lib/playback-core/production/wireProductionCore";
import { PLAYBACK_COMMANDS } from "@/lib/playback/playback-commands";
import {
  normalizeTrack,
  playbackQueuesMatch,
  CS_PLAYBACK_RATE,
} from "@/lib/playback/playback-track-utils";
import { inferPlaybackScenario } from "@/lib/playback/playback-misc-utils";
import {
  MARKS,
  perfMark,
  resetPlaybackTimingCapture,
  setPlaybackScenario,
  PLAYBACK_SCENARIOS,
} from "@/lib/dev/performanceMarks";
import { resumeWebAudioContextFromUserGesture } from "@/lib/audio/web-audio-context-utils";
import { playbackStateMachine } from "@/media/PlaybackStateMachine";
import { savePlaybackSession } from "@/lib/playback/session-memory";
import { isAudioActuallyAudible } from "@/lib/playback/audibility";
import { waitAudioSrcReady, playAudioIfNotPaused } from "@/lib/audio/audio-element-utils";
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";
import { PhysicalEffectAuthorityMode } from "@/lib/audio/physical-effect-authority";
import {
  isPlaybackTraceEnabled,
  logPlaybackEvent,
  logTrackSwitchDuringRecovery,
  logTrackSwitchAfterUnlock,
  getPlaybackTraceContext,
} from "@/lib/diagnostics/playback-trace";
import { proposeSelection, getCanonicalSelection } from "@/lib/playback/selection-port.js";

const REPEAT_MODES = ["off", "one", "all"];

/**
 * All non-delegate public API callbacks for AudioProvider.
 * Returns a stable useMemo object — identity never changes.
 */
export function usePlaybackPublicApi({ refs, delegates }) {
  // Synchronous singleton construction guarantees Core + adapter + physical
  // effect guard are READY before any descendant can receive a playback event.
  const playbackCore = getProductionPlaybackCore();
  const playbackPort = playbackCore.port;
  const {
    stateRef, audioRef, audioCtxRef,
    queueRef, repeatModeRef, shuffleRef, csModeRef,
    userPausedRef, userIntentPausedRef,
    skipPauseInterruptionRef, activeStreamAbortRef, activeCommandRef,
    wasPlayingBeforeViewportPauseRef, resumeEligibleRef, lastTrackIdRef,
    lastUserActionRef, isInAudioVisualViewportRef,
    csHoldSavedRef, csHoldActiveRef, bassFilterRef, webAudioAvailableRef,
    lifecycleRecoveryLockRef, audibilitySampleRef,
    sleepTimerRef, listeningUserIdRef,
  } = refs;

  const {
    getCurrentTrackId, clearViewportResume, patchState,
    initWebAudio, pauseForViewport,
  } = delegates;

  const requestAuthoritativePlay = useCallback((track, options = {}, policy = {}) => {
    const trackIdentity = track?.id ?? track?.trackId ?? track?.slug ?? null;
    if (!trackIdentity) return false;

    const desired = playbackCore.desiredState;
    if (policy.requireCurrentPlaying && desired.desiredTransport !== "PLAYING") return false;
    if (
      policy.expectedCurrentMediaIdentity &&
      desired.requestedMediaIdentity !== policy.expectedCurrentMediaIdentity
    ) {
      return false;
    }

    // Selection commits ONCE, here, before Transport ever hears about the
    // track — never after. A caller that already committed the Selection
    // itself (queue-traversal commands: NEXT/PREVIOUS/playQueue) sets
    // alreadySelected so this does not needlessly re-propose it.
    let selection;
    if (policy.alreadySelected) {
      selection = getCanonicalSelection();
    } else if (Array.isArray(policy.queueEntries)) {
      const result = proposeSelection("setQueueAndSelect", [
        policy.queueEntries,
        Number.isInteger(policy.queueIndex) ? policy.queueIndex : 0,
      ]);
      if (!result.accepted) return false;
      selection = result.snapshot;
    } else {
      const result = proposeSelection("selectMedia", [
        track,
        { preferredIndex: Number.isInteger(policy.queueIndex) ? policy.queueIndex : undefined },
      ]);
      if (!result.accepted) return false;
      selection = result.snapshot;
    }

    playbackPort.play({
      trackId: trackIdentity,
      queueEntries: selection.queue,
      queueIndex: selection.queueIndex,
      resumePolicy: options.resumePolicy,
      options,
      source: policy.source ?? options.source ?? "user",
    });
    return true;
  }, [playbackCore, playbackPort]);

  // ─── Repeat / Shuffle ────────────────────────────────────────────────────────

  const setRepeatMode = useCallback((mode) => {
    const next = REPEAT_MODES.includes(mode) ? mode : "off";
    proposeSelection("setTraversalPolicy", [{ repeatMode: next }]);
    const selection = getCanonicalSelection();
    const userId = listeningUserIdRef.current;
    if (userId && selection.queue.length) {
      savePlaybackSession(userId, {
        queue: selection.queue,
        queueIndex: selection.queueIndex,
        shuffle: selection.shuffle,
        repeatMode: next,
      });
    }
  }, []);

  const toggleRepeat = useCallback(() => {
    const order = ["off", "one", "all"];
    const current = repeatModeRef.current || "off";
    const next = order[(order.indexOf(current) + 1) % order.length];
    setRepeatMode(next);
    return next;
  }, [setRepeatMode]);

  const setShuffle = useCallback((enabled) => {
    proposeSelection("setTraversalPolicy", [{ shuffle: Boolean(enabled) }]);
    const selection = getCanonicalSelection();
    const userId = listeningUserIdRef.current;
    if (userId && selection.queue.length) {
      savePlaybackSession(userId, {
        queue: selection.queue,
        queueIndex: selection.queueIndex,
        shuffle: Boolean(enabled),
        repeatMode: selection.repeatMode,
      });
    }
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle(!shuffleRef.current);
    return shuffleRef.current;
  }, [setShuffle]);

  // ─── Sound Modes ─────────────────────────────────────────────────────────────

  const toggleSpaceMode = useCallback(() => {
    patchState({ spaceMode: !stateRef.current.spaceMode });
  }, [patchState]);

  const toggleBassBoost = useCallback(() => {
    const next = !stateRef.current.bassMode;
    if (bassFilterRef.current && webAudioAvailableRef.current) {
      bassFilterRef.current.gain.setTargetAtTime(
        next ? 8 : 0,
        bassFilterRef.current.context.currentTime,
        0.1
      );
    }
    patchState({ bassMode: next });
  }, [patchState]);

  const cycleAtmosphere = useCallback(() => {
    const current = stateRef.current.atmosphereLevel ?? 3;
    const next = current <= 1 ? 3 : current - 1;
    patchState({ atmosphereLevel: next });
  }, [patchState]);

  // ─── Sleep Timer ─────────────────────────────────────────────────────────────

  const setSleepTimer = useCallback((minutes) => {
    if (!minutes || minutes <= 0) {
      sleepTimerRef.current = { endsAt: null, afterCurrentTrack: false };
      playbackStateMachine.updateContext({ sleepTimerEndsAt: null, sleepAfterCurrentTrack: false });
      return;
    }
    if (minutes === "end_of_track") {
      sleepTimerRef.current = { endsAt: null, afterCurrentTrack: true };
      playbackStateMachine.updateContext({ sleepTimerEndsAt: null, sleepAfterCurrentTrack: true });
      return;
    }
    const endsAt = Date.now() + minutes * 60 * 1000;
    sleepTimerRef.current = { endsAt, afterCurrentTrack: false };
    playbackStateMachine.updateContext({ sleepTimerEndsAt: endsAt, sleepAfterCurrentTrack: false });
  }, []);

  // ─── Core Transport ──────────────────────────────────────────────────────────

  const setQueue = useCallback(
    (tracks = [], startIndex = 0) =>
      dispatchPlaybackCommand(PLAYBACK_COMMANDS.SET_QUEUE, { tracks, startIndex }),
    []
  );

  const pause = useCallback(() => {
    playbackPort.pause();
  }, [playbackPort]);

  const resume = useCallback(() => {
    initWebAudio();
    resumeWebAudioContextFromUserGesture(audioCtxRef, "resume:gesture");
    return playbackPort.resume();
  }, [audioCtxRef, initWebAudio, playbackPort]);

  const seek = useCallback(
    (time) => playbackPort.seek({ positionSeconds: time }),
    [playbackPort]
  );

  const playPrevious = useCallback(
    () => dispatchPlaybackCommand(
      PLAYBACK_COMMANDS.PREV_TRACK,
      {},
      { serial: false, cancelActiveStream: true },
    ),
    [],
  );

  const stop = useCallback(() => {
    playbackPort.pause({ source: "stop" });
    return dispatchPlaybackCommand(
      PLAYBACK_COMMANDS.STOP,
      {},
      { cancelActiveStream: true },
    );
  }, [playbackPort]);

  const toggle = useCallback(() => {
    if (stateRef.current.isPlaying) {
      pause();
      return false;
    }
    return resume();
  }, [pause, resume]);

  const playNext = useCallback(() => {
    resetPlaybackTimingCapture();
    setPlaybackScenario(PLAYBACK_SCENARIOS.TRACK_SKIP, { manualSkip: true, commandType: PLAYBACK_COMMANDS.NEXT_TRACK });
    perfMark(MARKS.PLAYBACK_TAP);
    initWebAudio();
    resumeWebAudioContextFromUserGesture(audioCtxRef, "playNext:gesture");
    return dispatchPlaybackCommand(
      PLAYBACK_COMMANDS.NEXT_TRACK,
      {},
      { serial: false, cancelActiveStream: true },
    );
  }, [audioCtxRef, initWebAudio]);

  const playTrack = useCallback((track, options = {}) => {
    if (lifecycleRecoveryLockRef.current && isPlaybackTraceEnabled()) {
      logTrackSwitchDuringRecovery({
        source: "playTrack",
        slug: track?.slug ?? null,
        lock: true,
      });
    }
    const traceCtx = getPlaybackTraceContext();
    const msSinceVisibility =
      traceCtx.lastVisibilityChangeAt > 0
        ? Date.now() - traceCtx.lastVisibilityChangeAt
        : null;
    const afterLifecycleReturn =
      traceCtx.lastVisibilityState === "visible" &&
      msSinceVisibility != null &&
      msSinceVisibility < 8000;
    if (afterLifecycleReturn && isPlaybackTraceEnabled()) {
      logPlaybackEvent({
        type: "TRACK_SWITCH_AFTER_RETURN",
        source: "playTrack",
        trackId: track?.id ?? track?.trackId ?? track?.slug ?? null,
        extra: { slug: track?.slug ?? null, msSinceVisibility, scenario: options?.playbackScenario ?? null },
      });
      logTrackSwitchAfterUnlock({
        source: "playTrack",
        slug: track?.slug ?? null,
        msSinceVisibility,
        recoveryLock: lifecycleRecoveryLockRef.current,
      });
    }
    resetPlaybackTimingCapture();
    const scenario = inferPlaybackScenario(audioRef.current, track, {
      ...options,
      _hasStarted: stateRef.current.hasStarted,
      _isPlaying: stateRef.current.isPlaying,
      _currentTrack: stateRef.current.currentTrack,
    }, { commandType: PLAYBACK_COMMANDS.PLAY_TRACK });
    setPlaybackScenario(scenario.label, scenario.meta);
    perfMark(MARKS.PLAYBACK_TAP);
    initWebAudio();
    resumeWebAudioContextFromUserGesture(audioCtxRef, "playTrack:gesture");
    return requestAuthoritativePlay(track, options);
  }, [
    audioCtxRef,
    audioRef,
    initWebAudio,
    lifecycleRecoveryLockRef,
    requestAuthoritativePlay,
    stateRef,
  ]);

  const playQueue = useCallback((tracks = [], startIndex = 0, options = {}) => {
    resetPlaybackTimingCapture();
    const normalized = (tracks || []).map(normalizeTrack).filter((t) => t.src);
    const sameQueue = playbackQueuesMatch(normalized, queueRef.current);
    const startTrack = tracks[Math.max(0, Math.min(startIndex, tracks.length - 1))];
    const scenario = inferPlaybackScenario(audioRef.current, startTrack, {
      ...options,
      _hasStarted: stateRef.current.hasStarted,
      _isPlaying: stateRef.current.isPlaying,
      _currentTrack: stateRef.current.currentTrack,
    }, { commandType: PLAYBACK_COMMANDS.PLAY_QUEUE, queueLength: tracks.length });
    setPlaybackScenario(scenario.label, scenario.meta);
    perfMark(MARKS.PLAYBACK_TAP);
    initWebAudio();
    resumeWebAudioContextFromUserGesture(audioCtxRef, "playQueue:gesture");
    void dispatchPlaybackCommand(
      PLAYBACK_COMMANDS.SET_QUEUE,
      { tracks, startIndex },
      { serial: false },
    );
    return requestAuthoritativePlay(startTrack, {
      ...options,
      preserveActiveStream: sameQueue,
    }, {
      queueEntries: tracks,
      queueIndex: startIndex,
      source: options.source ?? "user",
    });
  }, [
    audioCtxRef,
    audioRef,
    initWebAudio,
    queueRef,
    requestAuthoritativePlay,
    stateRef,
  ]);

  // ─── Queue Mutation ──────────────────────────────────────────────────────────

  const enqueueTrack = useCallback((track, { playNext: pn = false } = {}) => {
    const normalized = normalizeTrack(track);
    if (!normalized?.src) return;
    startTransition(() => {
      proposeSelection("insertItem", [normalized, { playNext: pn }]);
    });
  }, []);

  const removeFromQueue = useCallback((index) => {
    startTransition(() => {
      proposeSelection("removeItem", [index]);
    });
  }, []);

  const moveInQueue = useCallback((from, to) => {
    if (from === to) return;
    startTransition(() => {
      proposeSelection("reorderQueue", [from, to]);
    });
  }, []);

  // ─── CS Hold Preview ─────────────────────────────────────────────────────────

  const beginCsHoldPreview = useCallback((csAudioUrl) => {
    const audio = audioRef.current;
    if (!audio || !csAudioUrl || csModeRef.current || csHoldActiveRef.current) return;

    csHoldSavedRef.current = {
      src: audio.currentSrc || audio.src,
      currentTime: audio.currentTime,
      playbackRate: audio.playbackRate,
      wasPlaying: !audio.paused,
    };
    skipPauseInterruptionRef.current = true;
    audio.pause();
    void (async () => {
      await waitAudioSrcReady(audio, csAudioUrl, { signal: activeStreamAbortRef.current?.signal });
      const seekTo = csHoldSavedRef.current.currentTime;
      if (seekTo > 0) {
        const applySeek = () => {
          if (isFinite(audio.duration)) {
            audio.currentTime = Math.min(seekTo, Math.max(0, audio.duration - 0.25));
          }
        };
        if (isFinite(audio.duration) && audio.duration > 0) {
          applySeek();
        } else {
          audio.addEventListener("loadedmetadata", applySeek, { once: true });
        }
      }
      audio.playbackRate = 1;
      if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
      if (typeof audio.webkitPreservePitch !== "undefined") audio.webkitPreservePitch = true;
      if (csHoldSavedRef.current?.wasPlaying) {
        await playAudioIfNotPaused(audio, true, {
          command: "CS_HOLD_PREVIEW",
          requestId: activeCommandRef.current?.requestId || null,
          state: stateRef.current,
          context: { source: stateRef.current?.source || null },
          effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
        });
      }
    })().catch((error) => {
      reportPlaybackDiagnostic({
        level: "warn",
        code: "CS_HOLD_PREVIEW_FAILED",
        command: "CS_HOLD_PREVIEW",
        requestId: activeCommandRef.current?.requestId || null,
        state: stateRef.current,
        error,
      });
    });
    csHoldActiveRef.current = true;
  }, []);

  const setCsHoldPlaybackRate = useCallback((progress) => {
    const audio = audioRef.current;
    if (!audio || csModeRef.current || csHoldActiveRef.current) return;
    audio.playbackRate = 1 - (1 - CS_PLAYBACK_RATE) * progress;
    if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
    if (typeof audio.webkitPreservePitch !== "undefined") audio.webkitPreservePitch = true;
  }, []);

  const endCsHoldPreview = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || csModeRef.current) return;

    const saved = csHoldSavedRef.current;
    if (csHoldActiveRef.current && saved) {
      const currentUrl = audio.currentSrc || audio.src;
      const savedUrl = saved.src ? new URL(saved.src, window.location.href).href : "";
      const track = stateRef.current.currentTrack;
      const csAudio = track?.csAudio || null;
      const needsSwap = csAudio && savedUrl && currentUrl !== savedUrl;
      void (async () => {
        if (needsSwap) {
          skipPauseInterruptionRef.current = true;
          audio.pause();
          await waitAudioSrcReady(audio, saved.src, { signal: activeStreamAbortRef.current?.signal });
          const seekTo = saved.currentTime;
          if (seekTo > 0) {
            const applySeek = () => {
              if (isFinite(audio.duration)) {
                audio.currentTime = Math.min(seekTo, Math.max(0, audio.duration - 0.25));
              }
            };
            if (isFinite(audio.duration) && audio.duration > 0) {
              applySeek();
            } else {
              audio.addEventListener("loadedmetadata", applySeek, { once: true });
            }
          }
        } else if (saved.currentTime > 0) {
          audio.currentTime = saved.currentTime;
        }
        audio.playbackRate = saved.playbackRate ?? 1;
        if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
        if (typeof audio.webkitPreservePitch !== "undefined") audio.webkitPreservePitch = true;
        if (saved.wasPlaying && audio.paused) {
          await playAudioIfNotPaused(audio, true, {
            command: "CS_HOLD_END",
            requestId: activeCommandRef.current?.requestId || null,
            state: stateRef.current,
            context: { source: stateRef.current?.source || null },
            effectAuthorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
          });
        }
      })().catch((error) => {
        reportPlaybackDiagnostic({
          level: "warn",
          code: "CS_HOLD_END_FAILED",
          command: "CS_HOLD_END",
          requestId: activeCommandRef.current?.requestId || null,
          state: stateRef.current,
          error,
        });
      });
    } else if (audio) {
      audio.playbackRate = 1;
      if (typeof audio.preservesPitch !== "undefined") audio.preservesPitch = true;
      if (typeof audio.webkitPreservePitch !== "undefined") audio.webkitPreservePitch = true;
    }

    csHoldActiveRef.current = false;
    csHoldSavedRef.current = null;
  }, []);

  // ─── Viewport Helpers ────────────────────────────────────────────────────────

  const shouldAutoResumeViewport = useCallback(() => {
    if (!wasPlayingBeforeViewportPauseRef.current) return false;
    if (!resumeEligibleRef.current) return false;
    if (lastUserActionRef.current === "pause" || lastUserActionRef.current === "stop") return false;

    const trackId = getCurrentTrackId();
    if (!trackId || lastTrackIdRef.current == null) return false;
    if (String(trackId) !== String(lastTrackIdRef.current)) return false;

    if (!stateRef.current.hasStarted) return false;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;

    const audio = audioRef.current;
    if (!audio || !audio.paused) return false;

    return true;
  }, [getCurrentTrackId]);

  const getCurrentPlaybackSnapshot = useCallback(() => {
    const s = stateRef.current;
    const audio = audioRef.current;
    const track = s.currentTrack;
    if (!track) {
      return { trackId: null, releaseSlug: null, position: 0, isPlaying: false };
    }
    const trackId = track.id || track.trackId || track.slug || null;
    const releaseSlug =
      track.metadata?.releaseSlug ||
      track.metadata?.albumSlug ||
      track.albumSlug ||
      track.slug ||
      null;
    const position = audio?.currentTime ?? s.currentTime ?? 0;
    const isPlayingNow = Boolean(
      s.isPlaying &&
        audio &&
        isAudioActuallyAudible({
          audio,
          webAudioContext: audioCtxRef.current,
          sampleRef: audibilitySampleRef,
        })
    );
    return { trackId, releaseSlug, position, isPlaying: isPlayingNow };
  }, []);

  const enterAudioVisualViewport = useCallback(() => {
    isInAudioVisualViewportRef.current = true;

    if (wasPlayingBeforeViewportPauseRef.current && resumeEligibleRef.current) {
      return;
    }

    const audio = audioRef.current;
    const s = stateRef.current;
    const playingNow = Boolean(s.isPlaying && audio && !audio.paused);

    if (playingNow && lastUserActionRef.current !== "pause") {
      wasPlayingBeforeViewportPauseRef.current = true;
      lastTrackIdRef.current = getCurrentTrackId();
      resumeEligibleRef.current = true;
      pauseForViewport();
      playbackPort.pause({ source: "viewport" });
    } else {
      wasPlayingBeforeViewportPauseRef.current = false;
      resumeEligibleRef.current = false;
    }
  }, [getCurrentTrackId, pauseForViewport, playbackPort]);

  const exitAudioVisualViewport = useCallback(() => {
    isInAudioVisualViewportRef.current = false;

    if (!shouldAutoResumeViewport()) {
      clearViewportResume();
      return;
    }

    resumeEligibleRef.current = false;
    wasPlayingBeforeViewportPauseRef.current = false;

    playbackPort.resume({ source: "viewport" });
  }, [clearViewportResume, playbackPort, shouldAutoResumeViewport]);

  // ─── Stable Return ───────────────────────────────────────────────────────────
  return useMemo(() => ({
    setRepeatMode, toggleRepeat, setShuffle, toggleShuffle,
    toggleSpaceMode, toggleBassBoost, cycleAtmosphere,
    setSleepTimer,
    setQueue, pause, resume, seek, playPrevious, stop, toggle, playNext,
    playTrack, playQueue, requestAuthoritativePlay,
    enqueueTrack, removeFromQueue, moveInQueue,
    beginCsHoldPreview, setCsHoldPlaybackRate, endCsHoldPreview,
    shouldAutoResumeViewport, getCurrentPlaybackSnapshot,
    enterAudioVisualViewport, exitAudioVisualViewport,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
}
