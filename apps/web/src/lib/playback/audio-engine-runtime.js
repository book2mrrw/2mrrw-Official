/**
 * Phase 10 — module-level playback engine runtime (survives AudioProvider re-renders).
 * Owns the singleton <audio> element shell and serial command-queue refs.
 * Playback logic remains in AudioContext; this layer isolates lifecycle from React.
 */

import {
  isPlaybackTraceEnabled,
  logPlaybackEngineLifecycle,
} from "@/lib/diagnostics/playback-trace";

const GLOBAL_KEY = "__2MRRW_AUDIO_ENGINE_RUNTIME__";

/** True only when DOM APIs needed for detached `<audio>` are available. */
export function isBrowserPlaybackEnvironment() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function createRuntimeState() {
  return {
    providerMountCount: 0,
    audioElement: null,
    refs: {
      // Command pipeline — stable across HMR and route changes.
      audioRef: { current: null },
      queueRef: { current: [] },
      queueIndexRef: { current: -1 },
      commandQueueRef: { current: Promise.resolve() },
      commandRequestIdRef: { current: 0 },
      commandExecutionDepthRef: { current: 0 },
      activeCommandRef: { current: null },
      queueCircuitOpenRef: { current: false },
      queueWatchdogRef: { current: null },
      activeStreamAbortRef: { current: null },
      // Stable dispatch handle — module-accessible without going through React context.
      dispatchPlaybackCommandRef: { current: null },
      // One-shot Web Audio init — called synchronously inside user gesture commands.
      initWebAudioRef: { current: null },
      // Stable state reader — returns current playback state at call time (diagnostics).
      stateGetterRef: { current: null },
      // Stable trace handle — populated by AudioContext; executor uses it without React.
      tracePlaybackRef: { current: null },
      // Command handler bag — keyed by short name, populated by AudioContext effects.
      // Lives in the runtime so handlers from the previous mount remain valid during
      // the remount window (all handlers close over runtime refs, not React state).
      commandHandlersRef: { current: {} },
      // Web Audio graph — must outlive React mounts so the MediaElementSourceNode
      // (one-time-per-element) is never lost when AudioProvider unmounts/remounts.
      audioCtxRef: { current: null },
      sourceRef: { current: null },
      analyserRef: { current: null },
      stereoPannerRef: { current: null },
      bassFilterRef: { current: null },
      mainGainRef: { current: null },
      userGainRef: { current: null },
      limiterRef: { current: null },
      crossfadeGainRef: { current: null },
      crossfadeSourceRef: { current: null },
      mediaElementSourceElementRef: { current: null },
      webAudioInitializedRef: { current: false },
      webAudioAvailableRef: { current: true },
      // HLS engine — holds the active hls.js instance (or null for progressive playback).
      // Null means the current track is being served via progressive download (pre-transcode fallback).
      hlsEngineRef: { current: null },
    },
  };
}

/** @type {ReturnType<typeof createRuntimeState> | null} */
let ssrRuntime = null;

/**
 * @returns {ReturnType<typeof createRuntimeState>}
 */
export function getAudioEngineRuntime() {
  if (!isBrowserPlaybackEnvironment()) {
    if (!ssrRuntime) ssrRuntime = createRuntimeState();
    return ssrRuntime;
  }
  if (!window[GLOBAL_KEY]) {
    window[GLOBAL_KEY] = createRuntimeState();
    if (isPlaybackTraceEnabled()) {
      logPlaybackEngineLifecycle({ phase: "runtime-created" });
    }
  }
  return window[GLOBAL_KEY];
}

/**
 * Stable ref bag shared by every AudioProvider render (and HMR).
 * @returns {ReturnType<typeof createRuntimeState>['refs']}
 */
export function getAudioEngineRefs() {
  return getAudioEngineRuntime().refs;
}

/**
 * Create or reattach the detached playback element (once per tab).
 * @returns {HTMLAudioElement | null}
 */
export function ensureDetachedAudioElement() {
  if (!isBrowserPlaybackEnvironment() || !document.body) return null;
  const runtime = getAudioEngineRuntime();
  const { audioRef } = runtime.refs;

  let audio = runtime.audioElement;
  if (!audio) {
    audio = document.createElement("audio");
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audio.setAttribute("x-webkit-airplay", "allow");
    audio.crossOrigin = "anonymous";
    audio.style.display = "none";
    runtime.audioElement = audio;
    if (isPlaybackTraceEnabled()) {
      logPlaybackEngineLifecycle({ phase: "element-created" });
    }
  }

  if (!audio.isConnected) {
    document.body.appendChild(audio);
    if (isPlaybackTraceEnabled()) {
      logPlaybackEngineLifecycle({ phase: "element-mounted", parent: "document.body" });
    }
  }

  audioRef.current = audio;
  return audio;
}

export function noteAudioProviderMount() {
  const runtime = getAudioEngineRuntime();
  runtime.providerMountCount += 1;
  if (isPlaybackTraceEnabled()) {
    logPlaybackEngineLifecycle({
      phase: "provider-mount",
      mountCount: runtime.providerMountCount,
    });
  }
}

export function noteAudioProviderUnmount() {
  const runtime = getAudioEngineRuntime();
  runtime.providerMountCount = Math.max(0, runtime.providerMountCount - 1);
  if (isPlaybackTraceEnabled()) {
    logPlaybackEngineLifecycle({
      phase: "provider-unmount",
      mountCount: runtime.providerMountCount,
      audioRetained: Boolean(runtime.audioElement?.isConnected),
    });
  }
}

/**
 * Imperative dispatch — callable from any module without React context.
 * Returns null if the AudioProvider has not mounted yet.
 *
 * @param {string} type  PLAYBACK_COMMANDS constant or legacy alias.
 * @param {Record<string, any>} [payload]
 * @param {{ serial?: boolean, cancelActiveStream?: boolean }} [opts]
 * @returns {Promise<any> | null}
 */
