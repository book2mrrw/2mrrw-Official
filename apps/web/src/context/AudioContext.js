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
import {
  useProductionTransportStatus,
  useProductionTransportTimeline,
} from "@/lib/playback-core/production/useProductionTransport";
import { useProductionSelection } from "@/lib/playback-core/production/useProductionSelection";

// ─── Module Constants ─────────────────────────────────────────────────────────

const AudioContext = createContext(null);
const STORE_LINK_HREF = "/subscribe";

function legacyPlaybackStateFromCore(status) {
  if (status.status === "ENDED" && status.endReason === "preview") return "ended_preview";
  switch (status.status) {
    case "IDLE": return "idle";
    case "LOADING": return "loading";
    case "BUFFERING":
    case "PLAYING": return "playing";
    case "PAUSED": return "paused";
    case "SEEKING": return "seeking";
    case "ENDED": return "ending";
    case "ERROR": return "paused";
    case "RECOVERING": return "recovering";
    case "DEGRADED": return "paused";
    default: return null;
  }
}

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
  const canonicalTransport = useProductionTransportStatus();
  const canonicalSelection = useProductionSelection();

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
  const legacyState = useSyncExternalStore(
    (cb) => playbackStateMachine.subscribeContext(cb),
    () => playbackStateMachine.getContextSnapshot(),
    () => playbackStateMachine.getContextSnapshot()
  );
  const state = useMemo(() => ({
    ...legacyState,
    isPlaying: canonicalTransport.playing,
    playbackState: legacyPlaybackStateFromCore(canonicalTransport),
    playbackNetworkState: canonicalTransport.networkState,
    isBuffering:
      canonicalTransport.buffering ||
      canonicalTransport.loading ||
      canonicalTransport.recovering,
    error: canonicalTransport.error,
    // Slice 3 — direct Core Selection subscription (NowPlaying + Queue +
    // QueueIndex + traversal policy commit atomically; this is one snapshot,
    // never a torn read across the three).
    currentTrack: canonicalSelection.nowPlaying,
    currentTrackId:
      canonicalSelection.nowPlaying?.id ??
      canonicalSelection.nowPlaying?.trackId ??
      canonicalSelection.nowPlaying?.slug ??
      null,
    queue: canonicalSelection.queue,
    queueIndex: canonicalSelection.queueIndex,
    repeatMode: canonicalSelection.repeatMode,
    shuffle: canonicalSelection.shuffle,
  }), [legacyState, canonicalTransport, canonicalSelection]);

  // All thin delegates — stable useMemo identity, [] deps throughout.
  const delegates = usePlaybackDelegates(helperServiceRef, commandServiceRef);

  // Public-facing API callbacks (non-delegate; may do logging + gesture unlock).
  const publicApi = usePlaybackPublicApi({ refs, delegates });

  // Commit live service dependencies before descendant passive effects or user
  // events can execute. Render stays pure and aborted renders cannot publish deps.
  useLayoutEffect(() => {
    helperServiceRef.current.updateDeps({ ...refs });
    commandServiceRef.current.updateDeps({
      ...refs,
      ...delegates,
      requestAuthoritativePlay: publicApi.requestAuthoritativePlay,
      requestAuthoritativeSeek: publicApi.seek,
    });
  });

  // All useEffects — void hook; no re-renders driven from here.
  usePlaybackEffects({ refs, delegates, publicApi, state, user, authLoading, entitlementAccountState });

  // SM orchestration channel — drives playbackOrchestrationState consumers only.

  // ─── Context Value ───────────────────────────────────────────────────────────
  // publicApi and delegates are useMemo([], []) — identity never changes.
  // Full orchestration is intentionally excluded. Embedding it here would make
  // every useAudioPlayer consumer subscribe to unrelated engine transitions.
  const value = useMemo(() => {
    const {
      currentTime: _t,
      duration: _d,
      isPlaying: _playing,
      playbackState: _playbackState,
      playbackNetworkState: _network,
      isBuffering: _buffering,
      ...selectionAndPresentation
    } = state;
    return {
      // SM context fields (excluding high-frequency channels — those come from transport)
      ...selectionAndPresentation,
      isPlaying: canonicalTransport.playing,
      playbackState: legacyPlaybackStateFromCore(canonicalTransport),
      playbackNetworkState: canonicalTransport.networkState,
      isBuffering:
        canonicalTransport.buffering ||
        canonicalTransport.loading ||
        canonicalTransport.recovering,
      // Orchestration
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
    state, publicApi, delegates, uiState, canonicalTransport,
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

/** Subscribe to high-frequency playback progress without re-rendering the full AudioContext tree. */
export function usePlaybackProgress() {
  const timeline = useProductionTransportTimeline();
  return useMemo(() => ({
    currentTime: timeline.position,
    duration: timeline.duration,
  }), [timeline.position, timeline.duration]);
}

/** Transport/network fields without AudioProvider reconcile (Phase P1). */
export function usePlaybackTransport() {
  const status = useProductionTransportStatus();
  return useMemo(() => ({
    playbackNetworkState: status.networkState,
    isBuffering: status.buffering || status.loading || status.recovering,
    status: status.status,
    error: status.error,
  }), [status.networkState, status.buffering, status.loading, status.recovering, status.status, status.error]);
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
  const selection = useSyncExternalStore(subscribeIdentity, getIdentitySnapshot, () => SERVER_PLAYBACK_IDENTITY_SNAPSHOT);
  const status = useProductionTransportStatus();
  return useMemo(() => ({
    currentTrackId: selection.currentTrackId,
    currentTrackSlug: selection.currentTrackSlug,
    isPlaying: status.playing,
  }), [selection.currentTrackId, selection.currentTrackSlug, status.playing]);
}
