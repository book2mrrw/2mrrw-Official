"use client";

import { useEffect } from "react";

// Tracks which AudioContext objects already have a one-shot OS_SUSPENDED recovery
// listener armed so the watchdog never stacks duplicate statechange handlers.
const _osSuspendedRearmContexts = new WeakSet();
import {
  playbackStateMachine,
  PLAYBACK_ORCHESTRATION_EVENTS,
} from "@/media/PlaybackStateMachine";
import { notifyMediaEngineBridge, registerMediaEngineBridge } from "@/media/mediaEngineBridge";
import { mapContextTrackToMediaTrack } from "@/media/track-mapper";
import {
  isAudioActuallyAudible,
  updateAudibilitySample,
  validatePlaybackTruthIntegrity,
  PLAYBACK_TRUTH_VIOLATION,
} from "@/lib/playback/audibility";
import { resetPlaybackTelemetry } from "@/lib/control-system/playback";
import { getWebAudioEngine } from "@/lib/audio/WebAudioEngine";
import { AUDIO_ENGINE_EVENTS } from "@/lib/audio/AudioEngineInterface";
import {
  createPlaybackEventHandlers,
  LIFECYCLE_AUDIO_TRUTH_STATES,
} from "@/lib/playback/PlaybackEventHandlers";
import {
  attachPlaybackElementDevTelemetry,
  recordAudioContextState,
  MARKS,
  perfMark,
} from "@/lib/dev/performanceMarks";
import { logPlaybackResilience, logStateChurn } from "@/lib/diagnostics/state-churn-log";
import {
  isPlaybackTraceEnabled,
  logPlaybackEvent,
  recordPlaybackTraceContext,
  logWatchdogSkippedOsSuspend,
  logLifecycleRecoverySuppressed,
  logRecoveryPathClassification,
  logLifecycleAudioStateTransition,
  logOsSuspendDetected,
  logAudioOutputSilenceReason,
  logLifecycleTransportHealthy,
  classifyAudioOutputSilence,
} from "@/lib/diagnostics/playback-trace";
import { logPlayback } from "@/lib/observability/client-log";
import { savePlaybackSession, fetchQueueFromServer, loadPlaybackSession } from "@/lib/playback/session-memory";
import { savePlaybackPosition } from "@/lib/playback/position-memory";
import { isNearEndRestorePosition } from "@/lib/audio/audio-element-utils";
import { resolveTrackAccess, libraryStreamRedirectSrc } from "@/lib/music-access";
import {
  fetchLibraryStream,
  streamUrlNeedsRefresh,
  isLibraryStreamRedirectSrc,
  parseStreamSlugFromSrc,
} from "@/lib/playback/stream-client";
import { persistMediaSessionTrack } from "@/lib/media-session-artwork";
import { isEntitledFullPlaybackTrack } from "@/lib/playback/playback-track-utils";
import { evaluatePlaybackTransportHealth } from "@/lib/playback/playback-transport-utils";
import {
  resumeWebAudioContextIfSuspended,
  ensureWebAudioRunning,
} from "@/lib/audio/web-audio-context-utils";
import { isStandalonePwa } from "@/lib/playback/playback-misc-utils";
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";
import { dispatchPlaybackCommand } from "@/lib/playback/command-dispatcher";
import { PLAYBACK_COMMANDS } from "@/lib/playback/playback-commands";
import {
  ensureDetachedAudioElement,
  isBrowserPlaybackEnvironment,
  noteAudioProviderMount,
  noteAudioProviderUnmount,
} from "@/lib/playback/audio-engine-runtime";
import { recoveryCoordinator } from "@/lib/playback/recovery-coordinator";
import { registerPlaybackKeyboardShortcuts } from "@/lib/playback/keyboard-shortcuts";

const GESTURE_UNLOCK_EVENTS = ["touchstart", "touchend", "click", "keydown"];
const AUDIBILITY_WATCHDOG_MS = 1250;

/**
 * Registers all useEffects for AudioProvider.
 * Pure side-effects only — no return value.
 * Receives the full state bags from AudioProvider:
 *   refs       — all React refs + state setters from usePlaybackRefs
 *   delegates  — all thin service delegates from usePlaybackDelegates
 *   publicApi  — public API callbacks from usePlaybackPublicApi
 *   state      — SM context snapshot (re-renders AudioProvider on change)
 *   user       — from useAuth
 *   authLoading — from useAuth
 *   entitlementAccountState — from useEntitlementAccountState
 */
export function usePlaybackEffects({
  refs,
  delegates,
  publicApi,
  state,
  user,
  authLoading,
  entitlementAccountState,
}) {
  // ─── Destructure Refs ────────────────────────────────────────────────────────
  const {
    audioRef, audioCtxRef, stateRef, queueRef, queueIndexRef,
    commandHandlersRef, dispatchPlaybackCommandRef, initWebAudioRef,
    stateGetterRef, tracePlaybackRef, analyserRef, webAudioAvailableRef,
    audibilitySampleRef, hlsEngineRef,
    repeatModeRef, shuffleRef, csModeRef, continuityFrozenRef,
    sessionRestoredRef, sessionSaveTimerRef, pendingSessionUpgradeRef,
    tabIdRef, broadcastChannelRef, skipPauseInterruptionRef,
    userPausedRef, userIntentPausedRef, playbackIntentBeforeHideRef,
    lifecycleInBackgroundRef, lifecycleRecoveryLockRef, lifecycleRecoveryLockTimerRef,
    lifecycleRecoverySuppressedUntilRef, bfcacheRecoveryInProgressRef,
    bfcacheRecoveryTimeoutRef, recoveryCooldownUntilRef, isRecoveringRef,
    wasPlayingBeforeHideRef, wasPlayingBeforeViewportPauseRef,
    streamMetaRef, activeCommandRef, activeStreamAbortRef,
    stallHardAttemptRef, streamErrorRetriedRef, nextTrackPreloadRef,
    streamSwapPreloadRef, nextNextTrackPreloadRef, prevTrackPreloadRef,
    intentPrewarmRef, csAudioRef, csVidRef, queueWatchdogRef,
    bufferShowTimerRef, listeningUserIdRef, playTrackRef, applyCSModeToTrackRef,
    authLoadingRef, entitlementAccountStateRef, recoverAudioHardRef,
    retryStreamPlaybackRef, wakeLockRef, isInAudioVisualViewportRef,
  } = refs;

  // ─── Destructure Delegates ───────────────────────────────────────────────────
  const {
    patchState, patchTransport, patchUI, initWebAudio, tracePlayback,
    syncProgressTime, syncPositionState, updateMediaSession, rehydrateMediaSession,
    syncMediaSessionAfterLifecycle, finalizeStreamSession, recordLocalListening,
    startProgressRaf, stopProgressRaf, startKeepAlivePing, stopKeepAlivePing,
    startPositionSaveTimer, stopPositionSaveTimer, startStallRecovery, stopStallRecovery,
    emitBackgroundPlaybackDiagnostics, emitPhase21AudibleSnapshot,
    scheduleNextTrackPreload, cancelCrossfade, advanceShuffleOrder,
    armLifecycleRecoverySuppression, evaluateLifecyclePlaybackHealth,
    attemptLightweightPlaybackResume, readIsAudiblyPlaying,
    computeLifecycleAudioTruthState, getAudibilityParams, getPlaybackTransportHealth,
    isLifecycleRecoverySuppressed, requestPlaybackRecovery, runCoalescedLifecycleRecovery,
    blockRecoveryForLifecycleOsSuspended,
    recoverAudioHard, retryStreamPlayback, upgradeToFullStream,
    pauseInternal, playTrackInternal, playQueueInternal, setQueueInternal,
    playNextInternal, playPreviousInternal, seekInternal, resumeInternal, stopInternal,
    resumeFromViewport, setPlaybackRateInternal, applyCSModeToTrack, toggleCSMode,
  } = delegates;

  // ─── Destructure Public API ──────────────────────────────────────────────────
  const {
    pause, resume, seek, stop, playNext, playPrevious, playTrack,
  } = publicApi;

  // ─── Effect 1: Sync authLoadingRef ──────────────────────────────────────────
  useEffect(() => {
    authLoadingRef.current = authLoading;
  }, [authLoading]);

  // ─── Effect 2: Sync listeningUserIdRef ──────────────────────────────────────
  useEffect(() => {
    listeningUserIdRef.current = user?.id || null;
  }, [user?.id]);

  // ─── Effect 3: Session Restore ──────────────────────────────────────────────
  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      sessionRestoredRef.current = false;
      return;
    }
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;

    function applySession(session) {
      if (!session?.queue?.length) return;
      const valid = session.queue.filter((t) => t?.slug && t?.src);
      if (!valid.length) return;
      const idx = Math.max(0, Math.min(session.queueIndex ?? 0, valid.length - 1));
      queueRef.current = valid;
      queueIndexRef.current = idx;
      shuffleRef.current = Boolean(session.shuffle);
      repeatModeRef.current = session.repeatMode || "off";
      const restoredTrack = valid[idx] || null;
      patchState({
        queue: valid,
        queueIndex: idx,
        currentTrack: restoredTrack,
        shuffle: Boolean(session.shuffle),
        repeatMode: session.repeatMode || "off",
        isPlaying: false,
        playbackState: "idle",
      });
      if (
        restoredTrack?.metadata?.access?.canStream &&
        !restoredTrack?.metadata?.access?.previewOnly
      ) {
        pendingSessionUpgradeRef.current = restoredTrack.slug;
      }
    }

    const local = loadPlaybackSession(userId);
    if (local?.queue?.length) {
      applySession(local);
    } else {
      fetchQueueFromServer().then((serverSession) => {
        if (!serverSession?.queue?.length) return;
        if (stateRef.current.hasStarted || stateRef.current.isPlaying) return;
        applySession(serverSession);
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ─── Effect 4: BroadcastChannel — cross-tab pause ───────────────────────────
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return undefined;
    if (!tabIdRef.current) tabIdRef.current = Math.random().toString(36).slice(2);
    const bc = new BroadcastChannel("2mrrw-audio");
    broadcastChannelRef.current = bc;
    bc.onmessage = (ev) => {
      if (ev.data?.type !== "play-started" || ev.data?.tabId === tabIdRef.current) return;
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      skipPauseInterruptionRef.current = false;
      userPausedRef.current = true;
      userIntentPausedRef.current = true;
      audio.pause();
    };
    return () => {
      bc.close();
      broadcastChannelRef.current = null;
    };
  }, []);

  // ─── Effect 5: Entitlements — sync ref + update queue access flags ───────────
  useEffect(() => {
    entitlementAccountStateRef.current = entitlementAccountState;

    const queue = queueRef.current;
    if (!queue.length) return;

    let changed = false;
    const updated = queue.map((track) => {
      const fresh = resolveTrackAccess(track, entitlementAccountState);
      const prev = track.metadata?.access;
      if (prev?.canStream === fresh.canStream && prev?.previewOnly === fresh.previewOnly) {
        return track;
      }
      changed = true;
      const justGainedStream = !prev?.canStream && fresh.canStream && track.slug;
      const rawTrackSlug = track.metadata?.trackSlug || null;
      const subTrackSlug = rawTrackSlug && rawTrackSlug !== track.slug ? rawTrackSlug : null;
      const freshSrc = justGainedStream
        ? libraryStreamRedirectSrc(track.slug, { trackSlug: subTrackSlug })
        : track.src;
      return {
        ...track,
        src: freshSrc,
        metadata: {
          ...(track.metadata || {}),
          access: { ...(prev || {}), ...fresh },
        },
      };
    });

    if (!changed) return;
    queueRef.current = updated;
    patchState({ queue: updated });

    const currentTrack = stateRef.current.currentTrack;
    if (currentTrack?.slug) {
      const wasPreviewOnly = currentTrack.metadata?.access?.previewOnly;
      const updatedCurrent = updated.find((t) => t.slug === currentTrack.slug);
      if (wasPreviewOnly && updatedCurrent?.metadata?.access?.canStream) {
        const upgradeSlug = currentTrack.slug;
        setTimeout(() => {
          if (stateRef.current.currentTrack?.slug === upgradeSlug) {
            void dispatchPlaybackCommandRef.current?.("upgradeStream");
          }
        }, 500);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitlementAccountState]);

  // ─── Effect 6: Engine / Audio Element Init ───────────────────────────────────
  useEffect(() => {
    if (!isBrowserPlaybackEnvironment()) return undefined;
    noteAudioProviderMount();
    perfMark(MARKS.PLAYBACK_PROVIDER_MOUNT);
    const el = ensureDetachedAudioElement();
    if (el) perfMark(MARKS.PLAYBACK_AUDIO_ELEMENT_READY);
    if (!streamSwapPreloadRef.current) {
      const preload = new Audio();
      preload.preload = "auto";
      preload.crossOrigin = "anonymous";
      streamSwapPreloadRef.current = preload;
    }
    if (!nextTrackPreloadRef.current) {
      const nextPreload = new Audio();
      nextPreload.preload = "auto";
      nextPreload.crossOrigin = "anonymous";
      nextTrackPreloadRef.current = nextPreload;
    }
    if (!nextNextTrackPreloadRef.current) {
      const nn = new Audio();
      nn.preload = "auto";
      nn.crossOrigin = "anonymous";
      nextNextTrackPreloadRef.current = nn;
    }
    if (!prevTrackPreloadRef.current) {
      const prev = new Audio();
      prev.preload = "auto";
      prev.crossOrigin = "anonymous";
      prevTrackPreloadRef.current = prev;
    }
    if (!intentPrewarmRef.current) {
      const intent = new Audio();
      intent.preload = "auto";
      intent.crossOrigin = "anonymous";
      intentPrewarmRef.current = intent;
    }
    const cleanupKeyboard = registerPlaybackKeyboardShortcuts();
    return () => {
      cleanupKeyboard();
      noteAudioProviderUnmount();
    };
  }, []);

  // ─── Effect 7: Gesture Unlock (synchronous — preserves iOS gesture token) ────
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    // Guard against concurrent resume attempts — iOS ctx.resume() is async, so rapid
    // touchstart/touchend events during scrolling all pass the needsUnlock check before
    // the first resume() resolves, causing 18+ redundant resume calls.
    let unlockPending = false;

    const unlockFromGesture = () => {
      const ctx = audioCtxRef.current;
      // If a resume() is already in flight, skip — the in-flight call will set
      // sessionUnlockedRef when it completes. Reset if ctx enters "interrupted"
      // (iOS backgrounding) so the next tap re-unlocks correctly.
      if (unlockPending && ctx?.state !== "interrupted") return;
      const needsUnlock =
        !refs.sessionUnlockedRef.current || ctx?.state === "suspended" || ctx?.state === "interrupted";
      if (!needsUnlock) return;

      if (isPlaybackTraceEnabled()) {
        logPlaybackEvent({
          type: "play-chain:gesture-unlock",
          source: "unlockFromGesture",
          extra: {
            ctxState: ctx?.state ?? "none",
            sessionUnlocked: refs.sessionUnlockedRef.current,
            audioSrc: audioRef.current?.src ? audioRef.current.src.slice(0, 60) : null,
          },
        });
      }

      const audio = audioRef.current;
      if (audio) {
        try {
          if (!audio.src || audio.networkState === 0) audio.load();
        } catch {}
      }

      initWebAudio();

      const newCtx = audioCtxRef.current;
      if (!newCtx || newCtx.state === "closed") return;

      const onRunning = () => {
        unlockPending = false;
        recordAudioContextState(newCtx, "gesture-unlock");
        if (isPlaybackTraceEnabled()) {
          logPlaybackEvent({
            type: "play-chain:gesture-unlock-resolved",
            source: "unlockFromGesture",
            extra: { ctxState: newCtx.state, sessionUnlocked: refs.sessionUnlockedRef.current },
          });
        }
        if (newCtx.state === "running") {
          refs.sessionUnlockedRef.current = true;
          // Keep gesture listeners permanently — iOS AudioContext enters "interrupted"
          // state after backgrounding (phone call, Siri, app switch). The onstatechange
          // resume attempt is non-gesture and iOS rejects it; the next user tap here
          // re-runs ctx.resume() in proper gesture context, unblocking audio.
        }
      };

      if (newCtx.state === "running") {
        onRunning();
      } else {
        unlockPending = true;
        void newCtx.resume().then(onRunning).catch(() => { unlockPending = false; });
      }
    };

    GESTURE_UNLOCK_EVENTS.forEach((evt) => {
      document.addEventListener(evt, unlockFromGesture, { capture: true, passive: true });
    });

    return () => {
      GESTURE_UNLOCK_EVENTS.forEach((evt) => {
        document.removeEventListener(evt, unlockFromGesture, true);
      });
    };
  }, [initWebAudio]);

  // ─── Effect 8: SM Context Subscriber — sync derived refs synchronously ────────
  useEffect(() => {
    return playbackStateMachine.subscribeContext((snapshot) => {
      queueRef.current      = snapshot.queue     ?? [];
      queueIndexRef.current = snapshot.queueIndex ?? -1;
      repeatModeRef.current = snapshot.repeatMode ?? "off";
      shuffleRef.current    = Boolean(snapshot.shuffle);
      csModeRef.current     = Boolean(snapshot.csMode);
      if (!continuityFrozenRef.current) notifyMediaEngineBridge();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Effect 9: Debounced Session Save on Queue Context Change ─────────────────
  useEffect(() => {
    const userId = listeningUserIdRef.current;
    if (!userId || !state.queue?.length) return;
    if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current);
    sessionSaveTimerRef.current = setTimeout(() => {
      savePlaybackSession(listeningUserIdRef.current, {
        queue: state.queue,
        queueIndex: state.queueIndex,
        shuffle: state.shuffle,
        repeatMode: state.repeatMode,
      });
    }, 400);
  }, [state.queue, state.queueIndex, state.shuffle, state.repeatMode]);

  // ─── Effect 10: registerMediaEngineBridge ────────────────────────────────────
  useEffect(() => {
    registerMediaEngineBridge({
      getState: () => {
        const s = stateRef.current;
        const el = audioRef.current;
        const volume = el && typeof el.volume === "number" ? el.volume : 1;
        const audiblyPlaying =
          el &&
          isAudioActuallyAudible({
            audio: el,
            webAudioContext: audioCtxRef.current,
            sampleRef: audibilitySampleRef,
          });
        return {
          currentTrack: mapContextTrackToMediaTrack(s.currentTrack),
          isPlaying: Boolean(audiblyPlaying),
          currentTime: s.currentTime ?? 0,
          duration: s.duration ?? 0,
          volume,
          queue: s.queue ?? [],
          playbackState: s.playbackState,
          playbackNetworkState: s.playbackNetworkState ?? "idle",
          csMode: s.csMode,
          spaceMode: s.spaceMode,
          bassMode: s.bassMode,
          atmosphereLevel: s.atmosphereLevel,
        };
      },
      getAnalyser: () => (webAudioAvailableRef.current ? analyserRef.current : null),
    });
    return () => registerMediaEngineBridge(null);
  }, []);

  // ─── Effect 11: Audio Element Event Handlers ─────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlers = createPlaybackEventHandlers({
      audio,
      // Refs
      stateRef, audioRef, audioCtxRef, mainGainRef: refs.mainGainRef,
      crossfadeGainRef: refs.crossfadeGainRef, trackGainRef: refs.trackGainRef,
      userGainRef: refs.userGainRef, crossfadeStateRef: refs.crossfadeStateRef,
      crossfadeEnabledRef: refs.crossfadeEnabledRef, activeCommandRef, activeStreamAbortRef,
      streamMetaRef, streamErrorRetriedRef, stallHardAttemptRef,
      previewFadeInitRef: refs.previewFadeInitRef, userPausedRef, userIntentPausedRef,
      skipPauseInterruptionRef,
      pendingResumeAfterInterruptRef: refs.pendingResumeAfterInterruptRef,
      viewportPauseRef: refs.viewportPauseRef, playbackIntentBeforeHideRef,
      listeningProgressRef: refs.listeningProgressRef, lifecycleAudioTruthStateRef: refs.lifecycleAudioTruthStateRef,
      lastMediaSessionPlaybackStateRef: refs.lastMediaSessionPlaybackStateRef,
      recentStallTimeRef: refs.recentStallTimeRef, bufferShowTimerRef, nextTrackPreloadRef,
      prevTrackPreloadRef: refs.prevTrackPreloadRef, pendingSessionUpgradeRef, broadcastChannelRef,
      tabIdRef, audibilitySampleRef, lastPersistRef: refs.lastPersistRef,
      playTrackRef, applyCSModeToTrackRef, dispatchPlaybackCommandRef,
      queueRef, queueIndexRef, repeatModeRef, shuffleRef, csModeRef,
      stopAfterEachTrackRef: refs.stopAfterEachTrackRef, onPreviewEndedRef: refs.onPreviewEndedRef,
      spuriousEndedGuardRef: refs.spuriousEndedGuardRef, sleepTimerRef: refs.sleepTimerRef,
      userVolumeRef: refs.userVolumeRef,
      // Callbacks
      patchState, syncProgressTime, syncPositionState,
      startProgressRaf, stopProgressRaf, startKeepAlivePing, stopKeepAlivePing,
      startPositionSaveTimer, stopPositionSaveTimer, startStallRecovery, stopStallRecovery,
      updateMediaSession, finalizeStreamSession, recordLocalListening,
      tracePlayback, emitPhase21AudibleSnapshot, emitBackgroundPlaybackDiagnostics,
      scheduleNextTrackPreload, cancelCrossfade, advanceShuffleOrder,
      // SM UI channel write path
      patchUI,
    });
    const { onPlay, onPause, onTime, onDuration, onEnded, onError, onEmptied,
            onWaiting, onStalled, onPlaying, onCanPlayThrough } = handlers;

    const detachPlaybackDevTelemetry = attachPlaybackElementDevTelemetry(audio);

    const audioEngine = getWebAudioEngine();
    audioEngine._attachAudioElementListeners(audio);
    const E = AUDIO_ENGINE_EVENTS;
    const engineUnsubs = [
      audioEngine.on(E.PLAY,           onPlay),
      audioEngine.on(E.PAUSE,          onPause),
      audioEngine.on(E.TIMEUPDATE,     onTime),
      audioEngine.on(E.DURATIONCHANGE, onDuration),
      audioEngine.on(E.LOADEDMETADATA, onDuration),
      audioEngine.on(E.ENDED,          onEnded),
      audioEngine.on(E.ERROR,          onError),
      audioEngine.on(E.EMPTIED,        onEmptied),
      audioEngine.on(E.BUFFERING,      onWaiting),
      audioEngine.on(E.STALLED,        onStalled),
      audioEngine.on(E.BUFFERED,       onPlaying),
      audioEngine.on(E.CANPLAYTHROUGH, onCanPlayThrough),
    ];

    const onOnline = () => {
      if (stateRef.current.isPlaying && stateRef.current.currentTrack) {
        logPlaybackResilience("network-restored", {
          source: "AudioContext",
          code: "ONLINE_RETRY",
          slug: stateRef.current.currentTrack?.slug ?? null,
        });
        void retryStreamPlaybackRef.current?.();
      }
    };
    window.addEventListener("online", onOnline);

    let onDeviceChange = null;
    if (navigator.mediaDevices?.addEventListener) {
      onDeviceChange = async () => {
        try {
          if (!navigator.mediaDevices?.enumerateDevices) return;
          await navigator.mediaDevices.enumerateDevices();
          logPlaybackResilience("audio-route-change", {
            source: "AudioContext",
            code: "DEVICE_CHANGE",
            slug: stateRef.current.currentTrack?.slug ?? null,
            isPlaying: stateRef.current.isPlaying,
          });
        } catch {}
      };
      navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    }

    return () => {
      detachPlaybackDevTelemetry();
      window.removeEventListener("online", onOnline);
      engineUnsubs.forEach((unsub) => unsub());
      audioEngine._detachAudioElementListeners();
      if (onDeviceChange && navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
      }
      if (bufferShowTimerRef.current) {
        clearTimeout(bufferShowTimerRef.current);
        bufferShowTimerRef.current = null;
      }
      stopProgressRaf();
      stopPositionSaveTimer();
      stopKeepAlivePing();
      stopStallRecovery();
      resetPlaybackTelemetry();
    };
  }, [
    patchState, updateMediaSession, syncPositionState, recordLocalListening,
    finalizeStreamSession, startPositionSaveTimer, stopPositionSaveTimer,
    startProgressRaf, stopProgressRaf, startKeepAlivePing, stopKeepAlivePing,
    startStallRecovery, stopStallRecovery, tracePlayback, readIsAudiblyPlaying,
    emitBackgroundPlaybackDiagnostics, emitPhase21AudibleSnapshot,
  ]);

  // ─── Effect 12–15: Stable Ref Syncs ─────────────────────────────────────────
  useEffect(() => {
    retryStreamPlaybackRef.current = retryStreamPlayback;
  }, [retryStreamPlayback]);

  useEffect(() => {
    recoverAudioHardRef.current = recoverAudioHard;
  }, [recoverAudioHard]);

  useEffect(() => {
    playbackStateMachine.setRecoverExecutor((reason, opts) => recoverAudioHard(reason, opts));
    return () => playbackStateMachine.setRecoverExecutor(null);
  }, [recoverAudioHard]);

  useEffect(() => {
    playbackStateMachine.setLifecycleRecoveryGuard(() =>
      blockRecoveryForLifecycleOsSuspended("PlaybackStateMachine", null)
    );
    return () => playbackStateMachine.setLifecycleRecoveryGuard(null);
  }, [blockRecoveryForLifecycleOsSuspended]);

  useEffect(() => {
    dispatchPlaybackCommandRef.current = dispatchPlaybackCommand;
  }, []);

  useEffect(() => {
    initWebAudioRef.current = initWebAudio;
  }, [initWebAudio]);

  useEffect(() => {
    stateGetterRef.current = () => stateRef.current;
  }, []);

  useEffect(() => {
    tracePlaybackRef.current = tracePlayback;
  }, [tracePlayback]);

  // ─── Effect 16: Audibility Watchdog ─────────────────────────────────────────
  useEffect(() => {
    if (!state.hasStarted) return undefined;
    const intervalId = setInterval(() => {
      if (!stateRef.current.hasStarted) return;
      if (!stateRef.current.isPlaying && !playbackIntentBeforeHideRef.current) return;
      if (isRecoveringRef.current) return;
      if (Date.now() < recoveryCooldownUntilRef.current) return;
      // Only fire recovery when audio is in the stable "playing" state but is actually
      // paused. Every other state (idle, loading, ready, recovering) represents a
      // transition — audio is expected to be paused. Checking only "loading" missed the
      // "idle" state (first play before playTrackInternal dispatches "loading") and any
      // tick whose 1250ms interval landed shortly after a state transition.
      if (stateRef.current.playbackState !== "playing") return;

      const lifecycleTruth = computeLifecycleAudioTruthState();
      if (lifecycleTruth === LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED) {
        logWatchdogSkippedOsSuspend({
          source: "audibility_watchdog",
          slug: stateRef.current.currentTrack?.slug ?? null,
        });
        // Arm a one-shot statechange listener so recovery fires automatically when
        // iOS lifts the AudioContext suspension — no user tap required.
        const osSuspCtx = audioCtxRef.current;
        if (osSuspCtx && osSuspCtx.state !== "running" && !_osSuspendedRearmContexts.has(osSuspCtx)) {
          _osSuspendedRearmContexts.add(osSuspCtx);
          const onCtxStateChange = () => {
            if (osSuspCtx.state === "running") {
              osSuspCtx.removeEventListener("statechange", onCtxStateChange);
              _osSuspendedRearmContexts.delete(osSuspCtx);
              if (
                stateRef.current.isPlaying &&
                !userPausedRef.current &&
                !userIntentPausedRef.current
              ) {
                void attemptLightweightPlaybackResume("os_suspended_recovery");
              }
            }
          };
          osSuspCtx.addEventListener("statechange", onCtxStateChange);
        }
        return;
      }

      const audibilityParams = getAudibilityParams();
      const { audio } = audibilityParams;
      if (!audio) return;
      if (audio.ended) return;

      updateAudibilitySample(audio, audibilitySampleRef);

      const truth = validatePlaybackTruthIntegrity({
        ...audibilityParams,
        uiPlaying: stateRef.current.isPlaying,
      });
      if (
        isDocumentPlaybackHidden() ||
        lifecycleInBackgroundRef.current ||
        (playbackIntentBeforeHideRef.current && !userPausedRef.current && !userIntentPausedRef.current)
      ) {
        return;
      }

      if (truth.violation === PLAYBACK_TRUTH_VIOLATION) {
        // Defer if the Recovery Coordinator is already handling a stall —
        // firing a second hard recovery on top of an in-flight one resets the
        // buffer twice and is the root cause of the continuous stop-start cycle.
        if (recoveryCoordinator.isActive()) return;
        logPlaybackResilience("truth-violation", {
          source: "AudioContext",
          code: PLAYBACK_TRUTH_VIOLATION,
          reason: truth.reason,
          slug: stateRef.current.currentTrack?.slug ?? null,
        });
        void requestPlaybackRecovery(
          PLAYBACK_ORCHESTRATION_EVENTS.AUDIO_DESYNC_DETECTED,
          {
            reason: "truth_violation",
            resumeAfter:
              stateRef.current.isPlaying &&
              !userPausedRef.current &&
              !userIntentPausedRef.current &&
              Boolean(stateRef.current.currentTrack),
          }
        );
        return;
      }

      if (!stateRef.current.isPlaying) return;

      if (
        isDocumentPlaybackHidden() ||
        lifecycleInBackgroundRef.current ||
        (playbackIntentBeforeHideRef.current && !userPausedRef.current && !userIntentPausedRef.current)
      ) {
        return;
      }

      if (isAudioActuallyAudible(audibilityParams)) return;

      // Recovery Coordinator is handling a buffer stall — defer hard recovery.
      // Silent audio during a coordinator-managed stall is expected and correct.
      if (recoveryCoordinator.isActive()) return;

      if (
        isLifecycleRecoverySuppressed("silent_desync_detected") &&
        getPlaybackTransportHealth().intact
      ) {
        logLifecycleRecoverySuppressed({
          source: "audibility_watchdog",
          reason: "silent_desync_detected",
          slug: stateRef.current.currentTrack?.slug ?? null,
        });
        logRecoveryPathClassification({
          path: "no_op",
          reason: "silent_desync_suppressed_lifecycle",
          transportIntact: getPlaybackTransportHealth().intact,
          lifecycleIntent: playbackIntentBeforeHideRef.current,
          userPaused: userPausedRef.current,
          resumeAfter: false,
          source: "audibility_watchdog",
          slug: stateRef.current.currentTrack?.slug ?? null,
        });
        return;
      }

      logPlaybackResilience("silent-desync", {
        source: "AudioContext",
        code: "AUDIO_SILENT_DESYNC",
        slug: stateRef.current.currentTrack?.slug ?? null,
        currentTime: audio.currentTime,
        readyState: audio.readyState,
        ctxState: audioCtxRef.current?.state ?? null,
      });
      logRecoveryPathClassification({
        path: "hard",
        reason: "silent_desync_detected",
        transportIntact: getPlaybackTransportHealth().intact,
        lifecycleIntent: playbackIntentBeforeHideRef.current,
        userPaused: userPausedRef.current,
        resumeAfter: !userPausedRef.current,
        source: "audibility_watchdog",
        slug: stateRef.current.currentTrack?.slug ?? null,
      });
      void requestPlaybackRecovery(
        PLAYBACK_ORCHESTRATION_EVENTS.AUDIO_DESYNC_DETECTED,
        {
          reason: "silent_desync_detected",
          resumeAfter: !userPausedRef.current && !userIntentPausedRef.current,
        }
      );
    }, AUDIBILITY_WATCHDOG_MS);
    return () => clearInterval(intervalId);
  }, [
    attemptLightweightPlaybackResume,
    computeLifecycleAudioTruthState,
    getAudibilityParams,
    getPlaybackTransportHealth,
    isLifecycleRecoverySuppressed,
    requestPlaybackRecovery,
    state.hasStarted,
  ]);

  // ─── Effect 17: commandHandlersRef Wiring ────────────────────────────────────
  useEffect(() => { commandHandlersRef.current.pause         = pauseInternal;         }, [pauseInternal]);
  useEffect(() => { commandHandlersRef.current.playTrack     = playTrackInternal;      }, [playTrackInternal]);
  useEffect(() => { commandHandlersRef.current.playQueue     = playQueueInternal;      }, [playQueueInternal]);
  useEffect(() => { commandHandlersRef.current.setQueue      = setQueueInternal;       }, [setQueueInternal]);
  useEffect(() => { commandHandlersRef.current.playNext      = playNextInternal;       }, [playNextInternal]);
  useEffect(() => { commandHandlersRef.current.playPrev      = playPreviousInternal;   }, [playPreviousInternal]);
  useEffect(() => { commandHandlersRef.current.seek          = seekInternal;           }, [seekInternal]);
  useEffect(() => { commandHandlersRef.current.resume        = resumeInternal;         }, [resumeInternal]);
  useEffect(() => { commandHandlersRef.current.stop          = stopInternal;           }, [stopInternal]);
  useEffect(() => { commandHandlersRef.current.recover       = requestPlaybackRecovery; }, [requestPlaybackRecovery]);
  useEffect(() => { commandHandlersRef.current.upgradeStream = upgradeToFullStream;    }, [upgradeToFullStream]);
  useEffect(() => { commandHandlersRef.current.retryStream   = retryStreamPlayback;    }, [retryStreamPlayback]);
  useEffect(() => { commandHandlersRef.current.resumeViewport    = resumeFromViewport;     }, [resumeFromViewport]);
  useEffect(() => { commandHandlersRef.current.setPlaybackRate   = setPlaybackRateInternal; }, [setPlaybackRateInternal]);

  // ─── Effect 18: entitlements:updated Event ───────────────────────────────────
  useEffect(() => {
    const onEntitlementsUpdated = (event) => {
      const detail = event?.detail || {};
      recordPlaybackTraceContext({ lastEntitlementUpdateAt: Date.now() });
      if (authLoadingRef.current) {
        logStateChurn("upgradeToFullStream", {
          source: "AudioContext",
          reason: "skipped-auth-loading",
          eventSource: detail.source,
        });
        setTimeout(() => {
          if (!authLoadingRef.current && stateRef.current.currentTrack?.metadata?.access?.previewOnly) {
            void dispatchPlaybackCommandRef.current?.(PLAYBACK_COMMANDS.UPGRADE_STREAM).catch(() => {});
          }
        }, 50);
        return;
      }
      const track = stateRef.current.currentTrack;
      const meta = track?.metadata?.access;
      if (meta?.previewOnly && stateRef.current.isPlaying) {
        logStateChurn("upgradeToFullStream", {
          source: "AudioContext",
          reason: "entitlements-updated",
          eventSource: detail.source,
          slug: track?.slug ?? null,
        });
        void dispatchPlaybackCommandRef.current?.(PLAYBACK_COMMANDS.UPGRADE_STREAM).catch(() => {});
      }
      const pendingUpgrade = pendingSessionUpgradeRef.current;
      if (pendingUpgrade && track?.slug === pendingUpgrade && !meta?.previewOnly) {
        pendingSessionUpgradeRef.current = null;
        void dispatchPlaybackCommandRef.current?.(PLAYBACK_COMMANDS.UPGRADE_STREAM).catch(() => {});
      }
    };
    window.addEventListener("entitlements:updated", onEntitlementsUpdated);
    return () => window.removeEventListener("entitlements:updated", onEntitlementsUpdated);
  }, []);

  // ─── Effect 19: Sync playTrackRef + applyCSModeToTrackRef ───────────────────
  useEffect(() => {
    playTrackRef.current = playTrack;
    applyCSModeToTrackRef.current = applyCSModeToTrack;
  }, [applyCSModeToTrack, playTrack]);

  // ─── Effect 20: Media Session Action Handlers ────────────────────────────────
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return undefined;
    const ms = navigator.mediaSession;
    const handlePlay = () => { void resume(); };
    const handlePause = () => { pause(); };
    const handleNext = () => { void playNext(); };
    const handlePrev = () => { void playPrevious(); };
    const handleSeek = (details) => {
      const seekTime = details?.seekTime;
      if (seekTime != null && Number.isFinite(seekTime)) {
        seek(seekTime);
        return;
      }
      logPlaybackResilience("media-session-seek-noop", {
        source: "AudioContext",
        code: "SEEKTO_MISSING_TIME",
        action: details?.action ?? null,
      });
    };
    try {
      ms.setActionHandler("play", handlePlay);
      ms.setActionHandler("pause", handlePause);
      ms.setActionHandler("previoustrack", handlePrev);
      ms.setActionHandler("nexttrack", handleNext);
      ms.setActionHandler("seekto", handleSeek);
      ms.setActionHandler("stop", () => { stop(); });
      ms.setActionHandler("seekbackward", (details) => {
        const skipTime = details?.seekOffset ?? 10;
        seek(Math.max(0, (audioRef.current?.currentTime || 0) - skipTime));
      });
      ms.setActionHandler("seekforward", (details) => {
        const skipTime = details?.seekOffset ?? 10;
        const dur = audioRef.current?.duration || 0;
        seek(Math.min(dur, (audioRef.current?.currentTime || 0) + skipTime));
      });
      try { ms.setActionHandler("togglemicrophone", () => { void toggleCSMode(); }); } catch {}
    } catch {}
    return () => {
      try {
        ms.setActionHandler("play", null); ms.setActionHandler("pause", null);
        ms.setActionHandler("previoustrack", null); ms.setActionHandler("nexttrack", null);
        ms.setActionHandler("seekto", null); ms.setActionHandler("stop", null);
        ms.setActionHandler("seekbackward", null); ms.setActionHandler("seekforward", null);
        ms.setActionHandler("togglemicrophone", null);
      } catch {}
    };
  }, [pause, resume, playNext, playPrevious, seek, stop, toggleCSMode]);

  // ─── Effect 21: Screen Wake Lock — acquire on play ───────────────────────────
  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    const acquire = async () => {
      if (wakeLockRef.current) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release", () => { wakeLockRef.current = null; });
      } catch {}
    };
    const release = () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
    if (state.isPlaying) { void acquire(); } else { release(); }
    return release;
  }, [state.isPlaying]);

  // ─── Effect 22: Re-acquire Wake Lock on Visibility Return ────────────────────
  useEffect(() => {
    if (typeof document === "undefined" || !("wakeLock" in navigator)) return;
    const onVisible = () => {
      if (!state.isPlaying || wakeLockRef.current) return;
      navigator.wakeLock.request("screen").then((lock) => {
        wakeLockRef.current = lock;
        lock.addEventListener("release", () => { wakeLockRef.current = null; });
      }).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [state.isPlaying]);

  // ─── Effect 23: Visibility / BFCache Lifecycle ───────────────────────────────
  useEffect(() => {
    const onVisibility = async () => {
      const audio = audioRef.current;
      const track = stateRef.current.currentTrack;
      recordPlaybackTraceContext({
        lastVisibilityChangeAt: Date.now(),
        lastVisibilityState: document.visibilityState,
      });
      tracePlayback("visibility", "visibilitychange", { state: document.visibilityState });

      if (document.visibilityState === "hidden") {
        if (!track || !stateRef.current.hasStarted || !audio) return;
        lifecycleInBackgroundRef.current = true;
        wasPlayingBeforeHideRef.current = Boolean(
          playbackIntentBeforeHideRef.current ||
            (!audio.paused && readIsAudiblyPlaying())
        );
        emitBackgroundPlaybackDiagnostics("visibility_hidden");
        emitPhase21AudibleSnapshot("visibility_hidden");
        void resumeWebAudioContextIfSuspended(audioCtxRef, "visibility_hidden");
        recordAudioContextState(audioCtxRef.current, "visibility_hidden");
        if (audio.paused || audioCtxRef.current?.state === "suspended") {
          const silenceReason = classifyAudioOutputSilence({
            audio,
            webAudioContext: audioCtxRef.current,
            userPaused: userPausedRef.current,
            playbackIntent: playbackIntentBeforeHideRef.current,
          });
          logOsSuspendDetected({
            source: "visibility_hidden",
            elementPaused: audio.paused,
            ctxState: audioCtxRef.current?.state ?? null,
            playbackIntent: playbackIntentBeforeHideRef.current,
            slug: track?.slug ?? null,
          });
          logAudioOutputSilenceReason({
            source: "visibility_hidden",
            reason: silenceReason,
            classification: userPausedRef.current ? "USER_PAUSED" : "OS_SUSPENDED",
            slug: track?.slug ?? null,
          });
          logLifecycleAudioStateTransition({
            source: "visibility_hidden",
            classification: userPausedRef.current ? "USER_PAUSED" : "OS_SUSPENDED",
            lifecycleBackground: true,
            slug: track?.slug ?? null,
          });
        }
        const position = audio.currentTime || 0;
        const userId = listeningUserIdRef.current;
        if (userId && track.slug) {
          const dur = isFinite(audio.duration) ? audio.duration : 0;
          if (!(dur > 0 && isNearEndRestorePosition(position, dur))) {
            savePlaybackPosition(userId, track.slug, position, dur);
          }
        }
        const meta = streamMetaRef.current;
        const slug = meta?.slug || parseStreamSlugFromSrc(track.src) || track.slug;
        if (slug && meta && streamUrlNeedsRefresh(meta) && !isLibraryStreamRedirectSrc(meta.url)) {
          void fetchLibraryStream(slug, { force: false })
            .then((data) => {
              if (streamMetaRef.current?.slug !== slug) return;
              streamMetaRef.current = {
                ...meta,
                url: data.url,
                fetchedAt: Date.now(),
                expiresIn: data.expiresIn || 3600,
                streamEventId: data.streamEventId || meta.streamEventId,
                sessionId: data.sessionId || meta.sessionId,
              };
            })
            .catch((error) => {
              reportPlaybackDiagnostic({
                level: "warn",
                code: "VISIBILITY_STREAM_REFRESH_FAILED",
                command: PLAYBACK_COMMANDS.INTERRUPT,
                requestId: activeCommandRef.current?.requestId || null,
                state: stateRef.current,
                error,
                context: { slug },
              });
            });
        }
        return;
      }

      if (document.visibilityState === "visible") {
        lifecycleInBackgroundRef.current = false;
        const wasPlayingBeforeHide =
          wasPlayingBeforeHideRef.current || playbackIntentBeforeHideRef.current;
        wasPlayingBeforeHideRef.current = false;

        if (stateRef.current.isBuffering && stateRef.current.isPlaying) {
          stopStallRecovery();
          startStallRecovery();
        }

        emitBackgroundPlaybackDiagnostics("visibility_visible");
        emitPhase21AudibleSnapshot("visibility_visible");
        logLifecycleAudioStateTransition({
          source: "visibility_visible",
          classification: wasPlayingBeforeHide ? "RECOVERING" : "USER_PAUSED",
          wasPlayingBeforeHide,
          userPaused: userPausedRef.current,
          slug: track?.slug ?? null,
        });

        if (track && stateRef.current.hasStarted) {
          const resumeAfter =
            wasPlayingBeforeHide &&
            !userPausedRef.current &&
            !userIntentPausedRef.current &&
            isEntitledFullPlaybackTrack(track);

          void (async () => {
            const transport = evaluatePlaybackTransportHealth(audio, track, {
              queueLength: queueRef.current.length,
              queueIndex: queueIndexRef.current,
            });

            if (resumeAfter && audioCtxRef.current?.state === "suspended") {
              await ensureWebAudioRunning(audioCtxRef);
            }

            if (transport.intact && !resumeAfter) {
              logLifecycleTransportHealthy({
                source: "visibility_return",
                reason: "transport_ok_paused",
                resumeAfter,
                slug: track.slug ?? null,
              });
              armLifecycleRecoverySuppression("visibility_return", "transport_ok_paused");
              playbackIntentBeforeHideRef.current = false;
              await syncMediaSessionAfterLifecycle(false);
              return;
            }

            if (transport.intact && resumeAfter) {
              const lightOk = await attemptLightweightPlaybackResume("visibility_return");
              if (lightOk) {
                logLifecycleTransportHealthy({
                  source: "visibility_return",
                  reason: "lightweight_resume",
                  resumeAfter,
                  slug: track.slug ?? null,
                });
                armLifecycleRecoverySuppression("visibility_return", "lightweight_resume");
                playbackIntentBeforeHideRef.current = false;
                await syncMediaSessionAfterLifecycle(true);
                return;
              }
              if (audioCtxRef.current?.state === "suspended") {
                playbackStateMachine.transition(
                  PLAYBACK_ORCHESTRATION_EVENTS.RECOVER_FAILED,
                  { reason: "gesture_unlock_required" }
                );
                if (isPlaybackTraceEnabled()) {
                  logPlaybackEvent({
                    type: "gesture-unlock-required",
                    source: "visibility_return",
                    extra: { ctxState: audioCtxRef.current?.state ?? null },
                  });
                }
                if (transport.intact) {
                  patchState({ error: "Tap play to continue.", isPlaying: false, playbackState: "paused" });
                }
                armLifecycleRecoverySuppression("visibility_return", "gesture_unlock_required");
                playbackIntentBeforeHideRef.current = false;
                await syncMediaSessionAfterLifecycle(true);
                return;
              }
            }

            const health = evaluateLifecyclePlaybackHealth({
              resumeAfter,
              lifecycleIntent: wasPlayingBeforeHide,
            });
            playbackIntentBeforeHideRef.current = false;
            if (health.healthy) {
              if (isPlaybackTraceEnabled()) {
                logPlaybackEvent({
                  type: "LIFECYCLE_HEALTHY_SKIP_RECOVERY",
                  source: "visibility_return",
                  extra: { reason: health.reason, resumeAfter },
                });
              }
              logPlayback("LIFECYCLE_HEALTHY_SKIP_RECOVERY", {
                trigger: "visibility_return",
                reason: health.reason,
                resumeAfter,
              });
              logLifecycleTransportHealthy({
                source: "visibility_return",
                reason: health.reason,
                resumeAfter,
                slug: track.slug ?? null,
              });
              armLifecycleRecoverySuppression("visibility_return", health.reason);
              await syncMediaSessionAfterLifecycle(resumeAfter);
              return;
            }

            if (transport.intact) {
              logLifecycleTransportHealthy({
                source: "visibility_return",
                reason: health.reason,
                resumeAfter,
                slug: track.slug ?? null,
              });
              logRecoveryPathClassification({
                path: "no_op",
                reason: "visibility_transport_intact_skip_hard",
                transportIntact: true,
                lifecycleIntent: wasPlayingBeforeHide,
                userPaused: userPausedRef.current,
                resumeAfter,
                source: "visibility_return",
                slug: track.slug ?? null,
              });
              armLifecycleRecoverySuppression("visibility_return", health.reason);
              await syncMediaSessionAfterLifecycle(resumeAfter);
              return;
            }

            await runCoalescedLifecycleRecovery({
              reason: "visibility_return",
              resumeAfter,
              trigger: "visibility_return",
            });
            await syncMediaSessionAfterLifecycle(resumeAfter);
          })();
        } else if (stateRef.current.currentTrack) {
          void updateMediaSession(stateRef.current.currentTrack, {
            playing: stateRef.current.isPlaying,
          });
          syncPositionState(true);
        } else {
          rehydrateMediaSession();
        }
      }
    };

    const onPageShow = (event) => {
      const s = stateRef.current;
      if (event.persisted) {
        const track = s.currentTrack;
        if (!track || !s.hasStarted) return;
        const wasPlaying =
          wasPlayingBeforeHideRef.current ||
          playbackIntentBeforeHideRef.current ||
          (s.isPlaying && !userPausedRef.current && !userIntentPausedRef.current);
        wasPlayingBeforeHideRef.current = false;
        const resumeAfter =
          wasPlaying && !userPausedRef.current && !userIntentPausedRef.current && isEntitledFullPlaybackTrack(track);
        const health = evaluateLifecyclePlaybackHealth({ resumeAfter, lifecycleIntent: wasPlaying });
        playbackIntentBeforeHideRef.current = false;
        if (health.healthy) {
          if (isPlaybackTraceEnabled()) {
            logPlaybackEvent({
              type: "BFCACHE_HEALTHY_SKIP_RECOVERY",
              source: "pageshow",
              extra: { reason: health.reason, resumeAfter },
            });
          }
          logPlayback("BFCACHE_HEALTHY_SKIP_RECOVERY", {
            trigger: "bfcache_restore",
            reason: health.reason,
            resumeAfter,
          });
          rehydrateMediaSession();
          syncPositionState(true);
          return;
        }
        void runCoalescedLifecycleRecovery({
          reason: "bfcache_restore",
          resumeAfter,
          trigger: "bfcache_restore",
        }).then(() => {
          rehydrateMediaSession();
          syncPositionState(true);
        });
        return;
      }
      if (document.visibilityState === "visible" && s.currentTrack && s.hasStarted) {
        rehydrateMediaSession();
      }
    };

    const onBeforeUnload = () => {
      const s = stateRef.current;
      if (!s.currentTrack) return;
      persistMediaSessionTrack(s.currentTrack, {
        playing: s.isPlaying,
        currentTime: audioRef.current?.currentTime ?? s.currentTime,
        duration: audioRef.current?.duration ?? s.duration,
      });
      if (isStandalonePwa()) return;
    };

    const onPageHide = () => {
      const audioEl = audioRef.current;
      const meta = streamMetaRef.current;
      if (meta) {
        finalizeStreamSession(meta, {
          completed: false,
          durationSeconds: audioEl?.currentTime || 0,
        });
      }
      if (audioEl && stateRef.current.isPlaying) {
        const t = stateRef.current.currentTrack;
        const userId = listeningUserIdRef.current;
        if (userId && t?.slug) {
          const dur = isFinite(audioEl.duration) ? audioEl.duration : 0;
          const pos = audioEl.currentTime || 0;
          if (!(dur > 0 && isNearEndRestorePosition(pos, dur))) {
            savePlaybackPosition(userId, t.slug, pos, dur);
          }
        }
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      if (lifecycleRecoveryLockTimerRef.current) {
        clearTimeout(lifecycleRecoveryLockTimerRef.current);
        lifecycleRecoveryLockTimerRef.current = null;
      }
      lifecycleRecoveryLockRef.current = false;
      if (bfcacheRecoveryTimeoutRef.current) {
        clearTimeout(bfcacheRecoveryTimeoutRef.current);
        bfcacheRecoveryTimeoutRef.current = null;
      }
      bfcacheRecoveryInProgressRef.current = false;
    };
  }, [
    armLifecycleRecoverySuppression,
    attemptLightweightPlaybackResume,
    emitBackgroundPlaybackDiagnostics,
    emitPhase21AudibleSnapshot,
    evaluateLifecyclePlaybackHealth,
    finalizeStreamSession,
    readIsAudiblyPlaying,
    rehydrateMediaSession,
    runCoalescedLifecycleRecovery,
    startStallRecovery,
    stopStallRecovery,
    syncMediaSessionAfterLifecycle,
    syncPositionState,
    tracePlayback,
    updateMediaSession,
  ]);

  // ─── Effect 24: Proactive Offline / Online Handling ─────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOffline = () => {
      const audio = audioRef.current;
      const isCurrentlyPlaying = stateRef.current.isPlaying && audio && !audio.paused;
      stopStallRecovery();
      patchState({
        isBuffering: isCurrentlyPlaying,
        playbackNetworkState: isCurrentlyPlaying ? "retrying_stream" : stateRef.current.playbackNetworkState,
        error: isCurrentlyPlaying ? "RECONNECTING" : stateRef.current.error,
      });
    };

    const handleOnline = () => {
      const audio = audioRef.current;
      const track = stateRef.current.currentTrack;
      if (
        !userPausedRef.current &&
        !userIntentPausedRef.current &&
        track &&
        audio &&
        (stateRef.current.isPlaying || stateRef.current.error === "RECONNECTING")
      ) {
        stallHardAttemptRef.current = 0;
        streamErrorRetriedRef.current = 0;
        patchState({ error: null, isBuffering: true });
        void playTrackRef.current?.(track, {
          resumeAt: audio.currentTime || 0,
          forceStream: true,
        });
      } else if (stateRef.current.error === "RECONNECTING") {
        patchState({ error: null, isBuffering: false });
      }
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [patchState, stopStallRecovery]);

  // ─── Effect 25: Cleanup on Unmount ───────────────────────────────────────────
  useEffect(() => () => {
    stopProgressRaf();
    stopKeepAlivePing();
    stopPositionSaveTimer();
    if (nextTrackPreloadRef.current) {
      nextTrackPreloadRef.current.src = "";
      nextTrackPreloadRef.current.load();
    }
    if (streamSwapPreloadRef.current) {
      streamSwapPreloadRef.current.src = "";
      streamSwapPreloadRef.current.load();
    }
    if (nextNextTrackPreloadRef.current) {
      nextNextTrackPreloadRef.current.src = "";
      nextNextTrackPreloadRef.current.load();
    }
    if (prevTrackPreloadRef.current) {
      prevTrackPreloadRef.current.src = "";
      prevTrackPreloadRef.current.load();
    }
    if (intentPrewarmRef.current) {
      intentPrewarmRef.current.src = "";
      intentPrewarmRef.current.load();
    }
    try { if (csAudioRef.current) { csAudioRef.current.src = ""; csAudioRef.current.load(); } } catch {}
    try { if (csVidRef.current) { csVidRef.current.src = ""; csVidRef.current.load(); } } catch {}
    if (queueWatchdogRef.current) {
      clearTimeout(queueWatchdogRef.current);
      queueWatchdogRef.current = null;
    }
    if (activeStreamAbortRef.current) {
      activeStreamAbortRef.current.abort();
      activeStreamAbortRef.current = null;
    }
  }, [stopProgressRaf, stopKeepAlivePing, stopPositionSaveTimer]);
}

// ─── Missing helper (referenced in watchdog but not imported above) ───────────
function isDocumentPlaybackHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}
