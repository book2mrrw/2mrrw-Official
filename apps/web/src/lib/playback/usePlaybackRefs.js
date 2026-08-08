"use client";

import { useRef, useMemo, useSyncExternalStore } from "react";
import { getAudioEngineRefs, isBrowserPlaybackEnvironment } from "@/lib/playback/audio-engine-runtime";
import { getWebAudioEngine } from "@/lib/audio/WebAudioEngine";
import { createPlaybackCommands } from "@/lib/playback/PlaybackCommandService";
import { createPlaybackHelpers } from "@/lib/playback/PlaybackHelperService";
import { createAudibilitySample } from "@/lib/playback/audibility";
import { redirectResolveCache } from "@/lib/playback/redirect-resolve-cache";
import { LIFECYCLE_AUDIO_TRUTH_STATES } from "@/lib/playback/PlaybackEventHandlers";
import { playbackStateMachine } from "@/media/PlaybackStateMachine";

/**
 * Owns all React refs and local state for AudioProvider.
 * Returns a flat bag of every ref, service ref, state value, and state setter
 * so callers can spread into service updateDeps() calls and pass to sub-hooks.
 */
export function usePlaybackRefs() {
  // ─── Audio Engine Refs (singleton, sourced from WebAudioEngine) ──────────────
  const engineRefsRef = useRef(null);
  if (!engineRefsRef.current || isBrowserPlaybackEnvironment()) {
    engineRefsRef.current = getAudioEngineRefs();
  }
  const {
    audioRef,
    queueRef,
    queueIndexRef,
    commandExecutionDepthRef,
    activeCommandRef,
    queueWatchdogRef,
    activeStreamAbortRef,
    audioCtxRef,
    sourceRef,
    analyserRef,
    stereoPannerRef,
    bassFilterRef,
    mainGainRef,
    userGainRef,
    limiterRef,
    crossfadeGainRef,
    crossfadeSourceRef,
    mediaElementSourceElementRef,
    webAudioInitializedRef,
    webAudioAvailableRef,
    dispatchPlaybackCommandRef,
    initWebAudioRef,
    stateGetterRef,
    tracePlaybackRef,
    commandHandlersRef,
    hlsEngineRef,
  } = engineRefsRef.current;

  // ─── SM Context Getter Proxy ─────────────────────────────────────────────────
  // Always-live, never stale — replaces useRef(EMPTY_STATE) + sync useEffect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stateRef = useMemo(() => ({ get current() { return playbackStateMachine.getContext(); } }), []);

  // ─── Playback Services ───────────────────────────────────────────────────────
  const commandServiceRef = useRef(null);
  if (!commandServiceRef.current) commandServiceRef.current = createPlaybackCommands({});

  const helperServiceRef = useRef(null);
  if (!helperServiceRef.current) helperServiceRef.current = createPlaybackHelpers({});

  // ─── CS (Cinematic Session) Refs ─────────────────────────────────────────────
  const csImgRef = useRef(null);
  const csVidRef = useRef(null);
  const csAudioRef = useRef(null);
  const csHoldSavedRef = useRef(null);
  const csHoldActiveRef = useRef(false);
  const csUsingAlternateSrcRef = useRef(false);

  // ─── Stream / Session Refs ───────────────────────────────────────────────────
  const lastPersistRef = useRef({ key: null, at: 0 });
  const pendingSeekRef = useRef(null);
  const streamMetaRef = useRef(null);
  const streamSwapPreloadRef = useRef(null);
  const streamErrorRetriedRef = useRef(0);
  const stallHardAttemptRef = useRef(0);
  const previewFadeInitRef = useRef(false);
  const lastPlayedSlugRef = useRef(null);
  const pendingSessionUpgradeRef = useRef(null);
  const nextTrackSignedUrlCacheRef = useRef({});
  const sessionRestoredRef = useRef(false);
  const sessionSaveTimerRef = useRef(null);
  const sessionUnlockedRef = useRef(false);
  const listeningUserIdRef = useRef(null);
  const listeningProgressRef = useRef({ slug: null, recorded30s: false });

  // ─── Queue / Shuffle Refs ────────────────────────────────────────────────────
  const repeatModeRef = useRef("off");
  const shuffleRef = useRef(false);
  const csModeRef = useRef(false);
  const shuffledOrderRef = useRef(null);
  const shufflePositionRef = useRef(0);
  const stopAfterEachTrackRef = useRef(false);

  // ─── User Intent / Pause Refs ────────────────────────────────────────────────
  const userPausedRef = useRef(false);
  const userIntentPausedRef = useRef(false);
  const pausedDuringCurrentLoadRef = useRef(false);
  const skipPauseInterruptionRef = useRef(false);
  // Suppresses all audio element event handlers during the silent play/pause
  // gesture-unlock cycle in unlockAudioFromGesture. Prevents spurious onPlay
  // state mutations (isPlaying:true, RAF start, keep-alive pings) from firing
  // during the unlock trick — those events belong to the real play, not the unlock.
  const isGestureUnlockCycleRef = useRef(false);
  const pendingResumeAfterInterruptRef = useRef(null);
  const onPreviewEndedRef = useRef(null);
  const spuriousEndedGuardRef = useRef(0);
  const playRequestIdRef = useRef(0);
  const internalPlaybackAuthorityRef = useRef(false);
  const userVolumeRef = useRef(getWebAudioEngine().getUserVolume());

  // ─── Viewport / Audio-Visual Refs ────────────────────────────────────────────
  const isInAudioVisualViewportRef = useRef(false);
  const wasPlayingBeforeViewportPauseRef = useRef(false);
  const viewportPauseRef = useRef(false);
  const resumeEligibleRef = useRef(false);
  const lastTrackIdRef = useRef(null);
  const lastUserActionRef = useRef(null);
  const viewportResumeInFlightRef = useRef(false);

  // ─── Lifecycle / Recovery Refs ───────────────────────────────────────────────
  const wasPlayingBeforeHideRef = useRef(false);
  const playbackIntentBeforeHideRef = useRef(false);
  const lifecycleInBackgroundRef = useRef(false);
  const lifecycleRecoverySuppressedUntilRef = useRef(0);
  const lifecycleAudioTruthStateRef = useRef(LIFECYCLE_AUDIO_TRUTH_STATES.USER_PAUSED);
  const lifecycleRecoveryLockRef = useRef(false);
  const lifecycleRecoveryLockIdRef = useRef(0);
  const lifecycleRecoveryLockTimerRef = useRef(null);
  const lastMediaSessionPlaybackStateRef = useRef(null);
  const isRecoveringRef = useRef(false);
  const recoveryInFlightRef = useRef(false);
  const bfcacheRecoveryInProgressRef = useRef(false);
  const bfcacheRecoveryTimeoutRef = useRef(null);
  const recoveryCooldownUntilRef = useRef(0);
  const recoverAudioHardRef = useRef(null);
  const retryStreamPlaybackRef = useRef(null);

  // ─── Phase 21C Continuity Refs ───────────────────────────────────────────────
  const continuitySnapshotRef = useRef(null);
  const continuityFrozenRef = useRef(false);
  const forceProgressNotifyRef = useRef(false);

  // ─── Timer / Interval Refs ───────────────────────────────────────────────────
  const keepAliveIntervalRef = useRef(null);
  const positionSaveTimerRef = useRef(null);
  const progressRafRef = useRef(null);
  const stallSoftTimerRef = useRef(null);
  const stallRecoveryTimerRef = useRef(null);
  const sleepTimerRef = useRef({ endsAt: null, afterCurrentTrack: false });
  const bufferShowTimerRef = useRef(null);
  const recentStallTimeRef = useRef(0);
  const lastPositionStateAtRef = useRef(0);
  const wakeLockRef = useRef(null);

  // ─── Preload Element Refs ────────────────────────────────────────────────────
  const nextTrackPreloadRef = useRef(null);
  const nextNextTrackPreloadRef = useRef(null);
  const prevTrackPreloadRef = useRef(null);
  const intentPrewarmRef = useRef(null);

  // ─── Web Audio / Engine Refs ─────────────────────────────────────────────────
  const trackGainRef = useRef(1);
  const crossfadeStateRef = useRef("idle");
  const crossfadeEnabledRef = useRef(
    typeof window !== "undefined" && window.localStorage.getItem("2mrrw_crossfade") === "1"
  );

  // ─── Other Refs ──────────────────────────────────────────────────────────────
  const playTrackRef = useRef(null);
  const applyCSModeToTrackRef = useRef(null);
  const entitlementAccountStateRef = useRef(null);
  const authLoadingRef = useRef(null);
  const streamHlsEngineRef = useRef(null); // alias for hlsEngineRef access in helpers
  const streamSwapPreloadEngineRef = useRef(null);
  const intentPrewarmEngineRef = useRef(null);
  const tabIdRef = useRef(null);
  const broadcastChannelRef = useRef(null);
  const audibilitySampleRef = useRef(createAudibilitySample());
  const redirectResolveCacheRef = useRef(redirectResolveCache);
  const lastPersistPositionRef = useRef({ key: null, at: 0 });
  const renderCountRef = useRef(0);
  const prevRenderDepsRef = useRef({});

  // ─── UI State — SM UI channel ────────────────────────────────────────────────
  // Single useSyncExternalStore subscription replaces 5 separate useState calls.
  // Fires only when sleep timer, crossfade, previewEnded, or continuityFrozen changes —
  // never on track changes, queue changes, or transport updates.
  const uiState = useSyncExternalStore(
    (cb) => playbackStateMachine.subscribeUI(cb),
    () => playbackStateMachine.getUISnapshot(),
    () => playbackStateMachine.getUISnapshot()
  );

  return {
    // Engine refs
    audioRef, queueRef, queueIndexRef, commandExecutionDepthRef, activeCommandRef,
    queueWatchdogRef, activeStreamAbortRef, audioCtxRef, sourceRef, analyserRef,
    stereoPannerRef, bassFilterRef, mainGainRef, userGainRef, limiterRef,
    crossfadeGainRef, crossfadeSourceRef, mediaElementSourceElementRef,
    webAudioInitializedRef, webAudioAvailableRef, dispatchPlaybackCommandRef,
    initWebAudioRef, stateGetterRef, tracePlaybackRef, commandHandlersRef, hlsEngineRef,
    // SM proxy
    stateRef,
    // Services
    commandServiceRef, helperServiceRef,
    // CS refs
    csImgRef, csVidRef, csAudioRef, csHoldSavedRef, csHoldActiveRef, csUsingAlternateSrcRef,
    // Stream/session refs
    lastPersistRef, pendingSeekRef, streamMetaRef, streamSwapPreloadRef,
    streamErrorRetriedRef, stallHardAttemptRef, previewFadeInitRef,
    lastPlayedSlugRef, pendingSessionUpgradeRef, nextTrackSignedUrlCacheRef,
    sessionRestoredRef, sessionSaveTimerRef, sessionUnlockedRef,
    listeningUserIdRef, listeningProgressRef,
    // Queue/shuffle refs
    repeatModeRef, shuffleRef, csModeRef, shuffledOrderRef, shufflePositionRef,
    stopAfterEachTrackRef,
    // User intent/pause refs
    userPausedRef, userIntentPausedRef, pausedDuringCurrentLoadRef,
    skipPauseInterruptionRef, isGestureUnlockCycleRef, pendingResumeAfterInterruptRef, onPreviewEndedRef,
    spuriousEndedGuardRef, playRequestIdRef, internalPlaybackAuthorityRef, userVolumeRef,
    // Viewport refs
    isInAudioVisualViewportRef, wasPlayingBeforeViewportPauseRef, viewportPauseRef,
    resumeEligibleRef, lastTrackIdRef, lastUserActionRef, viewportResumeInFlightRef,
    // Lifecycle/recovery refs
    wasPlayingBeforeHideRef, playbackIntentBeforeHideRef, lifecycleInBackgroundRef,
    lifecycleRecoverySuppressedUntilRef, lifecycleAudioTruthStateRef,
    lifecycleRecoveryLockRef, lifecycleRecoveryLockIdRef, lifecycleRecoveryLockTimerRef,
    lastMediaSessionPlaybackStateRef, isRecoveringRef, recoveryInFlightRef,
    bfcacheRecoveryInProgressRef, bfcacheRecoveryTimeoutRef, recoveryCooldownUntilRef,
    recoverAudioHardRef, retryStreamPlaybackRef,
    // Continuity refs
    continuitySnapshotRef, continuityFrozenRef, forceProgressNotifyRef,
    // Timer refs
    keepAliveIntervalRef, positionSaveTimerRef, progressRafRef,
    stallSoftTimerRef, stallRecoveryTimerRef, sleepTimerRef,
    bufferShowTimerRef, recentStallTimeRef, lastPositionStateAtRef, wakeLockRef,
    // Preload refs
    nextTrackPreloadRef, nextNextTrackPreloadRef, prevTrackPreloadRef, intentPrewarmRef,
    // Web audio refs
    trackGainRef, crossfadeStateRef, crossfadeEnabledRef,
    // Other refs
    playTrackRef, applyCSModeToTrackRef, entitlementAccountStateRef, authLoadingRef,
    tabIdRef, broadcastChannelRef, audibilitySampleRef, redirectResolveCacheRef,
    renderCountRef, prevRenderDepsRef,
    // UI state — SM UI channel snapshot (individual fields for backwards-compat spread)
    uiState,
    sleepTimerEndsAt:      uiState.sleepTimerEndsAt,
    sleepAfterCurrentTrack: uiState.sleepAfterCurrentTrack,
    crossfadeEnabled:      uiState.crossfadeEnabled,
    previewEnded:          uiState.previewEnded,
    continuityFrozen:      uiState.continuityFrozen,
  };
}
