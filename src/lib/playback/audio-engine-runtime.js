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

function createRuntimeState() {
  return {
    providerMountCount: 0,
    audioElement: null,
    refs: {
      audioRef: { current: null },
      commandQueueRef: { current: Promise.resolve() },
      commandRequestIdRef: { current: 0 },
      commandExecutionDepthRef: { current: 0 },
      activeCommandRef: { current: null },
      queueCircuitOpenRef: { current: false },
      queueWatchdogRef: { current: null },
      activeStreamAbortRef: { current: null },
    },
  };
}

/** @type {ReturnType<typeof createRuntimeState> | null} */
let ssrRuntime = null;

/**
 * @returns {ReturnType<typeof createRuntimeState>}
 */
export function getAudioEngineRuntime() {
  if (typeof window === "undefined") {
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
  if (typeof document === "undefined") return null;
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
