"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  memo,
} from "react";
import dynamic from "next/dynamic";
import { useAuth, useEntitlementAccountState } from "@/context/AuthContext";
import { playbackStateMachine } from "@/media/PlaybackStateMachine";
import { dispatchPlaybackCommand } from "@/lib/playback/command-dispatcher";
import { useBlackscreenMountTrace } from "@/lib/diagnostics/useBlackscreenMountTrace";
import {
  isPlaybackTraceEnabled,
  getPlaybackTraceContext,
  logAudioProviderRender,
  logPlaybackRenderNoImpact,
} from "@/lib/diagnostics/playback-trace";
import { usePlaybackRefs } from "@/lib/playback/usePlaybackRefs";
import { usePlaybackDelegates } from "@/lib/playback/usePlaybackDelegates";
import { usePlaybackPublicApi } from "@/lib/playback/usePlaybackPublicApi";
import { usePlaybackEffects } from "@/lib/playback/usePlaybackEffects";

// ─── Module Constants ─────────────────────────────────────────────────────────

const AudioContext = createContext(null);
const STORE_LINK_HREF = "/subscribe";

const AudioProviderSubtree = memo(function AudioProviderSubtree({ children }) {
  return children;
});

const AudioPhase10Bridge = dynamic(
  () => import("@/components/system/AudioPhase10Bridge"),
  { ssr: false }
);

// ─── AudioProvider ────────────────────────────────────────────────────────────

export function AudioProvider({ children }) {
  useBlackscreenMountTrace("AudioProvider");
  const { user, loading: authLoading } = useAuth();
  const entitlementAccountState = useEntitlementAccountState();

  // All refs + local state in one stable bag. State values trigger AudioProvider
  // re-renders via the normal React useState mechanism.
  const refs = usePlaybackRefs();
  const {
    commandServiceRef, helperServiceRef,
    stateRef, audioRef, webAudioAvailableRef, analyserRef, userVolumeRef,
    skipPauseInterruptionRef, renderCountRef, prevRenderDepsRef,
    uiState,
  } = refs;

  // SM context channel — drives full AudioProvider re-renders on queue/track changes.
  // Wrapper arrow preserves `this` on subscribeContext; getContextSnapshot returns frozen snapshot.
  const state = useSyncExternalStore(
    (cb) => playbackStateMachine.subscribeContext(cb),
    () => playbackStateMachine.getContextSnapshot(),
    () => playbackStateMachine.getContextSnapshot()
  );

  // All thin delegates — stable useMemo identity, [] deps throughout.
  const delegates = usePlaybackDelegates(helperServiceRef, commandServiceRef);

  // Commit live service dependencies before descendant passive effects or user
  // events can execute. Render stays pure and aborted renders cannot publish deps.
  useLayoutEffect(() => {
    helperServiceRef.current.updateDeps({ ...refs });
    commandServiceRef.current.updateDeps({ ...refs, ...delegates });
  });

  // Public-facing API callbacks (non-delegate; may do logging + gesture unlock).
  const publicApi = usePlaybackPublicApi({ refs, delegates });

  // All useEffects — void hook; no re-renders driven from here.
  usePlaybackEffects({ refs, delegates, publicApi, state, user, authLoading, entitlementAccountState });

  // SM orchestration channel — drives playbackOrchestrationState consumers only.
  const playbackOrchestrationState = useSyncExternalStore(
    (onStoreChange) => playbackStateMachine.subscribe(() => onStoreChange()),
    () => playbackStateMachine.getState(),
    () => playbackStateMachine.getState()
  );

  // ─── Context Value ───────────────────────────────────────────────────────────
  // publicApi and delegates are useMemo([], []) — identity never changes.
  // Only state, playbackOrchestrationState, and local React state values cause recomputes.
  const value = useMemo(() => {
    const { currentTime: _t, playbackNetworkState: _n, isBuffering: _b, ...playbackState } = state;
    const transport = playbackStateMachine.getTransportSnapshot();
    return {
      // SM context fields (excluding high-frequency channels — those come from transport)
      ...playbackState,
      playbackNetworkState: transport.playbackNetworkState,
      isBuffering: transport.isBuffering,
      // Orchestration
      playbackOrchestrationState,
      subscribePlaybackOrchestration: playbackStateMachine.subscribe,
      dispatchPlaybackCommand,
      // Stable refs exposed to consumers
      audioRef,
      suppressPauseInterruptionRef: skipPauseInterruptionRef,
      storeLinkHref: STORE_LINK_HREF,
      // SM UI channel state
      previewEnded:          uiState.previewEnded,
      sleepTimerEndsAt:      uiState.sleepTimerEndsAt,
      sleepAfterCurrentTrack: uiState.sleepAfterCurrentTrack,
      continuityFrozen:      uiState.continuityFrozen,
      // Inline live-ref readers (stable per useMemo recompute, never stale)
      getAnalyser: () => (webAudioAvailableRef.current ? analyserRef.current : null),
      getCurrentTime: () => stateRef.current.currentTime ?? 0,
      getUserVolume: () => userVolumeRef.current,
      getIsAudiblyPlaying: delegates.readIsAudiblyPlaying,
      // Public API (all stable — useMemo([], []))
      ...publicApi,
      // Delegates exposed on context (those not included in publicApi spread)
      toggleCSMode:            delegates.toggleCSMode,
      pauseForViewport:        delegates.pauseForViewport,
      resumeTrackAtPosition:   delegates.resumeTrackAtPosition,
      seekBack:                delegates.seekBack,
      seekForward:             delegates.seekForward,
      overrideConcurrentStream: delegates.overrideConcurrentStream,
      dismissStreamConflict:   delegates.dismissStreamConflict,
      retryStreamPlayback:     delegates.retryStreamPlayback,
      resumePlaybackTransport: delegates.resumePlaybackTransport,
      upgradeToFullStream:     delegates.upgradeToFullStream,
      setOnPreviewEnded:       delegates.setOnPreviewEnded,
      setUserVolume:           delegates.setUserVolume,
      getContinuitySnapshot:   delegates.getContinuitySnapshot,
      clearContinuityFreeze:   delegates.clearContinuityFreeze,
      subscribeProgress:       delegates.subscribeProgress,
      getProgressSnapshot:     delegates.getProgressSnapshot,
      subscribeTransport:      delegates.subscribeTransport,
      getTransportSnapshot:    delegates.getTransportSnapshot,
      subscribeIdentity:       delegates.subscribeIdentity,
      getIdentitySnapshot:     delegates.getIdentitySnapshot,
      hintUpcomingPlay:        delegates.hintUpcomingPlay,
    };
  }, [
    state, playbackOrchestrationState, publicApi, delegates, uiState,
  ]);

  // ─── Debug Render Trace (dev/trace only) ─────────────────────────────────────
  useEffect(() => {
    if (!isPlaybackTraceEnabled()) return;
    renderCountRef.current += 1;
    if (state.isPlaying && audioRef.current?.paused) {
      console.warn("[PLAYBACK-DESYNC] render: state.isPlaying but audio.paused", {
        playbackState: state.playbackState,
        slug: state.currentTrack?.slug ?? null,
      });
    }
    const deps = {
      userId: user?.id ?? null,
      authLoading,
      entitlementUserId: entitlementAccountState?.user?.id ?? null,
      isPlaying: state.isPlaying,
      playbackState: state.playbackState,
      currentTrackId: state.currentTrackId,
      queueLen: state.queue?.length ?? 0,
    };
    const prev = prevRenderDepsRef.current;
    const changed = Object.keys(deps).filter((k) => prev[k] !== deps[k]);
    prevRenderDepsRef.current = deps;
    let reasonGuess = "unknown";
    const ctx = getPlaybackTraceContext();
    if (ctx.lastScrollAt && Date.now() - ctx.lastScrollAt < 600) {
      reasonGuess = "scroll";
    } else if (changed.some((k) => k === "authLoading" || k === "userId" || k === "entitlementUserId")) {
      reasonGuess = changed.includes("entitlementUserId") ? "entitlement" : "auth";
    } else if (
      changed.length > 0 &&
      changed.every((k) => ["isPlaying", "playbackState", "currentTrackId", "queueLen"].includes(k))
    ) {
      reasonGuess = "playback";
    }
    const authOnlyChurn =
      changed.length > 0 &&
      changed.every((k) => ["authLoading", "userId", "entitlementUserId"].includes(k));
    if (authOnlyChurn) {
      logPlaybackRenderNoImpact({ renderCount: renderCountRef.current, reasonGuess, changed, deps });
    } else if (changed.length > 0 || renderCountRef.current <= 2) {
      logAudioProviderRender({ renderCount: renderCountRef.current, reasonGuess, changed, deps });
    }
  });

  return (
    <AudioContext.Provider value={value}>
      <AudioPhase10Bridge />
      <AudioProviderSubtree>{children}</AudioProviderSubtree>
    </AudioContext.Provider>
  );
}

// ─── Hook Exports ─────────────────────────────────────────────────────────────

export function useAudioPlayer() {
  const value = useContext(AudioContext);
  if (!value) throw new Error("useAudioPlayer must be used within AudioProvider");
  return value;
}

const SERVER_PLAYBACK_PROGRESS_SNAPSHOT = Object.freeze({ currentTime: 0, duration: 0 });

/** Subscribe to high-frequency playback progress without re-rendering the full AudioContext tree. */
export function usePlaybackProgress() {
  const { subscribeProgress, getProgressSnapshot } = useAudioPlayer();
  return useSyncExternalStore(subscribeProgress, getProgressSnapshot, () => SERVER_PLAYBACK_PROGRESS_SNAPSHOT);
}

const SERVER_PLAYBACK_TRANSPORT_SNAPSHOT = Object.freeze({ playbackNetworkState: "idle", isBuffering: false });

/** Transport/network fields without AudioProvider reconcile (Phase P1). */
export function usePlaybackTransport() {
  const { subscribeTransport, getTransportSnapshot } = useAudioPlayer();
  return useSyncExternalStore(subscribeTransport, getTransportSnapshot, () => SERVER_PLAYBACK_TRANSPORT_SNAPSHOT);
}

const SERVER_PLAYBACK_IDENTITY_SNAPSHOT = Object.freeze({
  currentTrackId: null,
  currentTrackSlug: null,
  isPlaying: false,
});

/**
 * Narrow track-identity subscription for storefront card buttons.
 * Only fires when the currently-playing track identity or isPlaying changes —
 * NOT on playbackState, queue, metadata, or any other audio state change.
 */
export function usePlaybackIdentity() {
  const { subscribeIdentity, getIdentitySnapshot } = useAudioPlayer();
  return useSyncExternalStore(subscribeIdentity, getIdentitySnapshot, () => SERVER_PLAYBACK_IDENTITY_SNAPSHOT);
}
