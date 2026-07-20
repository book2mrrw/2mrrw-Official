"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  startTransition,
  memo,
} from "react";
import { useAuth, useEntitlementAccountState } from "@/context/AuthContext";
import { resetPlaybackTelemetry, sendControlSystemPlaybackEvent } from "@/lib/control-system/playback";
import { recordListeningEvent } from "@/lib/listening-history";
import {
  clearPlaybackPosition,
  getSavedPlaybackPosition,
  savePlaybackPosition,
} from "@/lib/playback/position-memory";
import {
  loadPlaybackSession,
  savePlaybackSession,
} from "@/lib/playback/session-memory";
import {
  clearLibraryStreamSession,
  endStreamAnalytics,
  fetchLibraryStream,
  isLibraryStreamRedirectSrc,
  isLibraryStreamSrc,
  parseStreamSlugFromSrc,
  parseStreamTrackSlugFromSrc,
  streamUrlNeedsRefresh,
} from "@/lib/playback/stream-client";
import { writeAvailabilityCache } from "@/lib/media/availability-cache";
import { catalogPreviewAudioUrl } from "@/lib/media-urls";
import { isSiteApiMediaPath } from "@/lib/media/site-api-url";
import {
  clearPersistedMediaSessionTrack,
  getArtworkEntriesForTrack,
  persistMediaSessionTrack,
  readPersistedMediaSessionTrack,
} from "@/lib/media-session-artwork";
import { resolveCoverMediaType } from "@/components/ui/CoverArt";
import { mapContextTrackToMediaTrack } from "@/media/useMediaEngine";
import {
  notifyMediaEngineBridge,
  registerMediaEngineBridge,
} from "@/media/mediaEngineBridge";
import { preloadCoverImage } from "@/lib/media/preload";
import { logPlayback } from "@/lib/observability/client-log";
import { logStateChurn, logPlaybackResilience } from "@/lib/diagnostics/state-churn-log";
import {
  isPlaybackTraceEnabled,
  logPlaybackEvent,
  logPlaybackAuthViolation,
  parsePlaybackCallerFromStack,
  capturePlaybackSnapshotOnPause,
  classifyPlaybackInterruption,
  logAudioProviderRender,
  logPlaybackRenderNoImpact,
  logStreamLifecycle,
  recordPlaybackTraceContext,
  getPlaybackTraceContext,
  correlateBlackscreenPlayback,
  logPlaybackIntentCaptured,
  logPlaybackIntentRetry,
  logBackgroundPlaybackStopped,
  logBackgroundAudioContextState,
  logBackgroundMediaSessionState,
  logBackgroundAudioElementState,
  logBackgroundRecoveryTrigger,
  logBackgroundRecoverySkipped,
  logLockscreenMediaSessionActive,
  logPlaybackContinuityLost,
  logPlaybackIntentState,
  logLifecycleTransportHealthy,
  logLifecycleTransportFailed,
  logLifecycleRecoverySuppressed,
  logLifecycleRecoveryAllowed,
  logTrackSwitchDuringRecovery,
  logTrackSwitchAfterUnlock,
  captureAudibleOutputSnapshot,
  logLifecycleAudioStateTransition,
  logAudioContextStateChange,
  logOsSuspendDetected,
  logAudioOutputSilenceReason,
  classifyAudioOutputSilence,
  logRecoveryPathClassification,
  logLifecycleTruthStateComputed,
  logLifecycleStateCSuppressed,
  logWatchdogSkippedOsSuspend,
  logRecoveryBlockedLifecycleC,
  logPlaybackContinuitySnapshotCaptured,
  logPlaybackContinuityRestored,
  logUiContinuityFreezeEntered,
  logUiContinuityReconciled,
} from "@/lib/diagnostics/playback-trace";
import { useBlackscreenMountTrace } from "@/lib/diagnostics/useBlackscreenMountTrace";
import {
  isUiHydrationTraceEnabled,
  logUiHydrationTrace,
} from "@/lib/diagnostics/ui-hydration-trace";
import {
  ensureDetachedAudioElement,
  getAudioEngineRefs,
  isBrowserPlaybackEnvironment,
  noteAudioProviderMount,
  noteAudioProviderUnmount,
} from "@/lib/playback/audio-engine-runtime";
import {
  MARKS,
  perfMark,
  perfMeasure,
  dumpPlaybackTiming,
  attachPlaybackElementDevTelemetry,
  recordAudioContextState,
  resetPlaybackTimingCapture,
  setPlaybackScenario,
  PLAYBACK_SCENARIOS,
} from "@/lib/dev/performanceMarks";
import AudioPhase10Bridge from "@/components/system/AudioPhase10Bridge";
import { isFirstListen, markListened } from "@/lib/first-listen";
import { isSamePlaybackTrack } from "@/lib/music-playback";
import { resolveTrackAccess } from "@/lib/music-access";
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";
import {
  AUDIBILITY_RECOVERY_MAX_ATTEMPTS,
  AUDIBILITY_RECOVERY_RETRY_DELAY_MS,
  createAudibilitySample,
  isAudioActuallyAudible,
  PLAYBACK_TRUTH_VIOLATION,
  resetAudibilitySample,
  teardownWebAudioGraph,
  updateAudibilitySample,
  validatePlaybackTruthIntegrity,
  waitForPlaybackAudibility,
} from "@/lib/playback/audibility";
import {
  playbackStateMachine,
  PLAYBACK_ORCHESTRATION_EVENTS,
  PLAYBACK_ORCHESTRATION_STATES,
} from "@/media/PlaybackStateMachine";
import {
  SOURCE_KIND,
  classifySourceUrl,
  isDirectlyBufferable,
  requiresSignedUrlFetch,
} from "@/lib/playback/audio-source-resolver";

const AudioContext = createContext(null);

const REPEAT_MODES = ["off", "one", "all"];
const POSITION_STATE_THROTTLE_MS = 1000;
const SLOWED_SUFFIX = " · Slowed";
const CS_PLAYBACK_RATE = 0.75;
const POSITION_SAVE_INTERVAL_MS = 15000;
const STORE_LINK_HREF = "/subscribe";
const PREVIEW_HARD_CAP_SEC = 15;
const RESTORE_MIN_POSITION_SEC = 5;
const RESTORE_NEAR_END_BUFFER_SEC = 3;
const SPURIOUS_ENDED_GUARD_MS = 1200;
const KEEP_ALIVE_INTERVAL_MS = 20000;
const GESTURE_UNLOCK_EVENTS = ["touchstart", "touchend", "click", "keydown"];
const AUDIO_CONTENT_TYPE_RE = /^(audio\/|application\/octet-stream)/i;
const AUDIO_SRC_READY_TIMEOUT_MS = 12000;
// Two-stage stall recovery: soft (seek nudge) then hard (full retry).
const STALL_SOFT_RECOVERY_MS = 2500;
const STALL_HARD_RECOVERY_MS = 7000;
const PLAYBACK_COMMAND_TIMEOUT_MS = 15000;
/** Stream resolve / signed swap can exceed 15s without being stalled (Phase P1). */
const PLAYBACK_STREAM_COMMAND_TIMEOUT_MS = 120000;
const TRANSPORT_ONLY_STATE_KEYS = new Set([
  "playbackNetworkState",
  "isBuffering",
  "currentTime",
  "duration",
]);

/** Phase P12 — skip AudioProvider setState when storefront-visible playback fields are unchanged. */
function playbackTrackPresentationEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    (a.id ?? null) === (b.id ?? null) &&
    (a.slug ?? null) === (b.slug ?? null) &&
    (a.title ?? null) === (b.title ?? null) &&
    (a.cover ?? null) === (b.cover ?? null) &&
    (a.src ?? null) === (b.src ?? null) &&
    (a.source ?? null) === (b.source ?? null)
  );
}

function playbackUiStateEqual(prev, next) {
  if (prev === next) return true;
  const uiKeys = [
    "currentTrackId",
    "currentTrack",
    "source",
    "isPlaying",
    "error",
    "hasStarted",
    "accessDenied",
    "streamRetryable",
    "streamConflict",
    "queue",
    "queueIndex",
    "repeatMode",
    "shuffle",
    "csMode",
    "csTrack",
    "playbackState",
    "spaceMode",
    "bassMode",
    "atmosphereLevel",
  ];
  for (const key of uiKeys) {
    if (key === "currentTrack") {
      if (!playbackTrackPresentationEqual(prev.currentTrack, next.currentTrack)) return false;
      continue;
    }
    if (key === "queue") {
      const pq = prev.queue;
      const nq = next.queue;
      if (pq === nq) continue;
      if (!Array.isArray(pq) || !Array.isArray(nq) || pq.length !== nq.length) return false;
      for (let i = 0; i < pq.length; i += 1) {
        if (!playbackTrackPresentationEqual(pq[i], nq[i])) return false;
      }
      continue;
    }
    if (prev[key] !== next[key]) return false;
  }
  return true;
}

const AudioProviderSubtree = memo(function AudioProviderSubtree({ children }) {
  return children;
});
const AUDIBILITY_WATCHDOG_MS = 1250;
const RECOVERY_COOLDOWN_MS = 6000;
/** Coalesce visibility_return + bfcache_restore (Phase 15D). */
const LIFECYCLE_RECOVERY_LOCK_MS = 4000;
/** Grace after visible return when transport is intact — blocks false hard recovery (Phase 20C). */
const LIFECYCLE_RECOVERY_SUPPRESSION_MS = 2500;
const BFCACHE_RECOVERY_TIMEOUT_MS = 5000;
const MRRW_MEDIA_SOURCE_BOUND = Symbol.for("2mrrw.mediaElementSourceBound");
const ACTIVE_COMMAND_STALE_MS = 20000;
/** Phase 21B — lifecycle audio truth model (A–D). */
const LIFECYCLE_AUDIO_TRUTH_STATES = Object.freeze({
  USER_PLAYING: "USER_PLAYING",
  USER_PAUSED: "USER_PAUSED",
  OS_SUSPENDED: "OS_SUSPENDED",
  RECOVERING: "RECOVERING",
});

const PLAYBACK_COMMANDS = {
  PLAY_TRACK: "PLAY_TRACK",
  PLAY_QUEUE: "PLAY_QUEUE",
  PAUSE: "PAUSE",
  RESUME: "RESUME",
  SEEK: "SEEK",
  NEXT_TRACK: "NEXT_TRACK",
  PREV_TRACK: "PREV_TRACK",
  INTERRUPT: "INTERRUPT",
  RECOVER: "RECOVER",
  STOP: "STOP",
  COMPLETE: "COMPLETE",
  SET_QUEUE: "SET_QUEUE",
  REPLACE_TRACK: "REPLACE_TRACK",
  UPGRADE_STREAM: "UPGRADE_STREAM",
  RECOVER_PLAYBACK: "RECOVER_PLAYBACK",
  VIEWPORT_PAUSE: "VIEWPORT_PAUSE",
  VIEWPORT_RESUME: "VIEWPORT_RESUME",
};

/** Lowercase / legacy aliases accepted by dispatchPlaybackCommand (Phase 8 authority lock). */
const PLAYBACK_COMMAND_ALIASES = {
  play: PLAYBACK_COMMANDS.PLAY_TRACK,
  pause: PLAYBACK_COMMANDS.PAUSE,
  resume: PLAYBACK_COMMANDS.RESUME,
  stop: PLAYBACK_COMMANDS.STOP,
  seek: PLAYBACK_COMMANDS.SEEK,
  setQueue: PLAYBACK_COMMANDS.SET_QUEUE,
  playQueue: PLAYBACK_COMMANDS.PLAY_QUEUE,
  playTrack: PLAYBACK_COMMANDS.PLAY_TRACK,
  replaceTrack: PLAYBACK_COMMANDS.REPLACE_TRACK,
  upgradeStream: PLAYBACK_COMMANDS.UPGRADE_STREAM,
  recoverPlayback: PLAYBACK_COMMANDS.RECOVER_PLAYBACK,
  viewportPause: PLAYBACK_COMMANDS.VIEWPORT_PAUSE,
  viewportResume: PLAYBACK_COMMANDS.VIEWPORT_RESUME,
};

function createPlaybackError(code, message, context = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, context);
  return error;
}

function normalizePlaybackSrc(src) {
  if (!src || typeof src !== "string") return "";
  try {
    return new URL(src, typeof window !== "undefined" ? window.location.href : "http://localhost").href;
  } catch {
    return String(src);
  }
}

function isNearEndRestorePosition(positionSeconds, durationSeconds) {
  if (!Number.isFinite(positionSeconds) || positionSeconds < RESTORE_MIN_POSITION_SEC) return true;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  return positionSeconds >= durationSeconds - RESTORE_NEAR_END_BUFFER_SEC;
}

/** Reject invalid or near-end restores that would immediately fire `ended`. */
function clampRestorePosition(positionSeconds, durationSeconds) {
  if (!Number.isFinite(positionSeconds) || positionSeconds < RESTORE_MIN_POSITION_SEC) return null;
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    if (isNearEndRestorePosition(positionSeconds, durationSeconds)) return null;
    return Math.min(positionSeconds, durationSeconds - RESTORE_NEAR_END_BUFFER_SEC);
  }
  return positionSeconds;
}

/**
 * Fisher-Yates shuffle — returns a new array in random order.
 * The original `arr` is never mutated.
 */
function fisherYatesShuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** Set dev scenario label before tap marks (Phase 5.2.8). */
function inferPlaybackScenario(audio, track, options = {}, commandContext = {}) {
  if (options.playbackScenario) {
    return { label: options.playbackScenario, meta: { source: "explicit-option" } };
  }

  const { commandType, queueLength = 0 } = commandContext;
  const hasStarted = Boolean(options._hasStarted);
  const isPlaying = Boolean(options._isPlaying);
  const currentTrack = options._currentTrack ?? null;
  const trackSrc = track?.src || "";

  if (commandType === PLAYBACK_COMMANDS.COMPLETE) {
    return { label: PLAYBACK_SCENARIOS.QUEUE_AUTO_ADVANCE, meta: { commandType } };
  }
  if (commandType === PLAYBACK_COMMANDS.NEXT_TRACK) {
    return { label: PLAYBACK_SCENARIOS.TRACK_SKIP, meta: { commandType, manualSkip: true } };
  }
  if (commandType === PLAYBACK_COMMANDS.PLAY_QUEUE && queueLength > 1) {
    return { label: PLAYBACK_SCENARIOS.ALBUM_TRACKLIST, meta: { queueLength } };
  }

  const normalizedSrc = trackSrc ? normalizePlaybackSrc(trackSrc) : "";
  const currentSrc = audio ? normalizePlaybackSrc(audio.src) : "";
  const sameSrc = normalizedSrc && normalizedSrc === currentSrc;

  if (sameSrc && audio?.readyState >= 2) {
    return { label: PLAYBACK_SCENARIOS.CACHED_PLAYBACK, meta: { sameSrc: true, readyState: audio.readyState } };
  }
  if (!hasStarted) {
    return { label: PLAYBACK_SCENARIOS.COLD_START, meta: {} };
  }

  if (currentTrack && track && isPlaying) {
    if (!isSamePlaybackTrack(currentTrack, track)) {
      return { label: PLAYBACK_SCENARIOS.TRACK_SKIP, meta: { sameSrc, manualSkip: false } };
    }
  }

  if (hasStarted && sameSrc) {
    return { label: PLAYBACK_SCENARIOS.WARM_START, meta: { sameSrc: true } };
  }

  return { label: PLAYBACK_SCENARIOS.WARM_START, meta: { sameSrc: false } };
}

/** Set src, wait for loadeddata/canplay/error/timeout with abort support, then load(). */
async function waitAudioSrcReady(audio, src, { signal, timeoutMs = AUDIO_SRC_READY_TIMEOUT_MS } = {}) {
  perfMark(MARKS.PLAYBACK_WAIT_SRC_START);
  if (!audio || typeof audio.load !== "function") {
    perfMark(MARKS.PLAYBACK_WAIT_SRC_END);
    throw createPlaybackError("AUDIO_SRC_INVALID", "Audio element is unavailable");
  }
  if (!src || typeof src !== "string") {
    perfMark(MARKS.PLAYBACK_WAIT_SRC_END);
    throw createPlaybackError("AUDIO_SRC_INVALID", "Playback source is invalid", { src });
  }
  if (signal?.aborted) {
    perfMark(MARKS.PLAYBACK_WAIT_SRC_END);
    throw createPlaybackError("AUDIO_SRC_ABORTED", "Playback source readiness was aborted");
  }

  const normalizedSrc = normalizePlaybackSrc(src);
  const currentSrc = normalizePlaybackSrc(audio.src);
  const sameSrc = normalizedSrc === currentSrc;

  if (sameSrc && audio.readyState >= 2) {
    perfMark(MARKS.PLAYBACK_WAIT_SRC_GUARD_SAME_SRC);
    perfMark(MARKS.PLAYBACK_SRC_ASSIGN);
    perfMark(MARKS.PLAYBACK_CANPLAY);
    perfMark(MARKS.PLAYBACK_WAIT_SRC_END);
    return;
  }

  perfMark(MARKS.PLAYBACK_SRC_ASSIGN);
  if (!sameSrc) {
    logStreamLifecycle("src-swap", {
      source: "waitAudioSrcReady",
      slug: parseStreamSlugFromSrc(src),
      from: currentSrc ? currentSrc.slice(0, 96) : null,
      to: normalizedSrc.slice(0, 96),
    });
    audio.src = src;
  }

  return waitForAudioElementReady(audio, { signal, timeoutMs, src });
}

async function waitForAudioElementReady(audio, { signal, timeoutMs = AUDIO_SRC_READY_TIMEOUT_MS, src } = {}) {
  await new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    const settle = (resolver, value) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("loadedmetadata", onMetadataReady);
      audio.removeEventListener("loadeddata", onDataReady);
      audio.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      perfMark(MARKS.PLAYBACK_WAIT_SRC_END);
      resolver(value);
    };
    const onReady = () => {
      perfMark(MARKS.PLAYBACK_CANPLAY);
      settle(resolve);
    };
    const onDataReady = () => {
      perfMark(MARKS.PLAYBACK_LOADEDDATA);
      perfMark(MARKS.PLAYBACK_FIRST_BYTE);
      if (audio.readyState >= 2) onReady();
    };
    const onMetadataReady = () => {
      perfMark(MARKS.PLAYBACK_LOADEDMETADATA);
      if (audio.readyState >= 2) onReady();
    };
    const onError = (event) => {
      settle(
        reject,
        createPlaybackError("AUDIO_SRC_INVALID", "Audio source failed to load", {
          src,
          cause: event,
        })
      );
    };
    const onAbort = () => {
      logStreamLifecycle("abort", {
        source: "waitAudioSrcReady",
        slug: parseStreamSlugFromSrc(src),
      });
      settle(reject, createPlaybackError("AUDIO_SRC_ABORTED", "Playback source readiness was aborted"));
    };
    if (audio.readyState >= 2) {
      perfMark(MARKS.PLAYBACK_WAIT_SRC_GUARD_EARLY_READY);
      settle(resolve);
      return;
    }
    timeoutId = setTimeout(() => {
      settle(
        reject,
        createPlaybackError("AUDIO_SRC_READY_TIMEOUT", "Timed out waiting for audio source readiness", {
          src,
          timeoutMs,
        })
      );
    }, timeoutMs);
    audio.addEventListener("canplay", onReady);
    audio.addEventListener("loadedmetadata", onMetadataReady);
    audio.addEventListener("loadeddata", onDataReady);
    audio.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (audio.readyState < 2) {
      // Skip load() if the browser is already fetching this src (e.g. from early assignment).
      // Re-calling load() would abort the in-flight request and reset buffering.
      if (audio.networkState !== 2 /* NETWORK_LOADING */) {
        perfMark(MARKS.PLAYBACK_WAIT_SRC_LOAD_CALL);
        audio.load();
      }
    }
  });
}

/** Warm signed URL on a hidden element so the main transport swap hits cache (Phase P3). */
async function warmupSignedStreamPreload(preloadAudio, src, { signal, timeoutMs } = {}) {
  if (!preloadAudio || !src) return false;
  try {
    await waitAudioSrcReady(preloadAudio, src, { signal, timeoutMs });
    return true;
  } catch {
    return false;
  }
}

function isAudioElementPlaying(audio) {
  return Boolean(audio && !audio.paused && !audio.ended);
}

async function loadAudioSrcAndPlay(audio, src, { signal, command, requestId, state, context } = {}) {
  await waitAudioSrcReady(audio, src, { signal });
  try {
    perfMark(MARKS.PLAYBACK_AUDIO_PLAY_CALL);
    await audio.play();
    perfMark(MARKS.PLAYBACK_PLAY_PROMISE_RESOLVED);
    return isAudioElementPlaying(audio);
  } catch (e) {
    reportPlaybackDiagnostic({
      level: e?.name === "AbortError" ? "warn" : "error",
      code: "AUDIO_PLAY_FAILED",
      command: command || "PLAY",
      requestId: requestId ?? null,
      state,
      error: e,
      context: { src, ...(context || {}) },
    });
    return false;
  }
}

async function playAudioIfNotPaused(audio, isPlaying, { command, requestId, state, context } = {}) {
  if (!isPlaying) return true;
  if (!audio.paused) return true;
  try {
    perfMark(MARKS.PLAYBACK_AUDIO_PLAY_CALL);
    await audio.play();
    perfMark(MARKS.PLAYBACK_PLAY_PROMISE_RESOLVED);
    return isAudioElementPlaying(audio);
  } catch (e) {
    reportPlaybackDiagnostic({
      level: e?.name === "AbortError" ? "warn" : "error",
      code: "AUDIO_RESUME_FAILED",
      command: command || "PLAY",
      requestId: requestId ?? null,
      state,
      error: e,
      context,
    });
    return false;
  }
}

function isDocumentPlaybackHidden() {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

/** Transport still bound — no hard recovery for lifecycle-only pause. */
function hasIntactPlaybackTransport(audio, track) {
  if (!audio || !track?.src) return false;
  if (audio.ended) return false;
  const elSrc = audio.currentSrc || audio.src || "";
  return Boolean(elSrc && elSrc !== "about:blank");
}

/**
 * Phase 20C — transport health from element + queue, not audibility / visibility / ctx suspend.
 * @param {HTMLMediaElement | null | undefined} audio
 * @param {object | null | undefined} track
 * @param {{ queueLength?: number; queueIndex?: number }} [opts]
 */
function evaluatePlaybackTransportHealth(audio, track, opts = {}) {
  const { queueLength = 0, queueIndex = -1 } = opts;
  if (!track) return { intact: false, reason: "no_track" };
  if (!audio) return { intact: false, reason: "no_audio_element" };
  if (audio.ended) return { intact: false, reason: "ended" };
  if (!hasIntactPlaybackTransport(audio, track)) {
    return { intact: false, reason: "src_detached" };
  }
  if (audio.error?.code) {
    return { intact: false, reason: `media_error_${audio.error.code}` };
  }
  if (queueLength > 0 && queueIndex >= queueLength) {
    return { intact: false, reason: "queue_index_invalid" };
  }
  return { intact: true, reason: "transport_intact" };
}

/** Hard recovery still allowed through lifecycle suppression grace. */
function isGenuineTransportFailureReason(reason) {
  if (!reason) return false;
  const r = String(reason);
  return (
    r === "truth_violation" ||
    r === "fatal_audio_desync_invariant" ||
    r.startsWith("media_error_") ||
    r === "src_detached" ||
    r === "ended" ||
    r === "no_track" ||
    r === "no_audio_element" ||
    r === "queue_index_invalid" ||
    r === "stream_invalid" ||
    r === "network_error"
  );
}

/** OS/tab interrupt — not a broken stream. */
function isLifecycleInterruptReason(reason) {
  if (!reason) return false;
  const r = String(reason);
  return (
    r === "visibility_return" ||
    r === "bfcache_restore" ||
    r === "gesture_unlock_required" ||
    r === "paused_after_lifecycle_interrupt" ||
    r === "paused_expected_playing" ||
    r === "context_suspended_resume_needed" ||
    r === "audio_context_suspended" ||
    r === "silent_desync_detected"
  );
}

/** Commands that must resume Web Audio synchronously inside the activating gesture (before queue microtask). */
const USER_GESTURE_PLAYBACK_COMMANDS = new Set([
  PLAYBACK_COMMANDS.PLAY_TRACK,
  PLAYBACK_COMMANDS.RESUME,
  PLAYBACK_COMMANDS.PLAY_QUEUE,
  PLAYBACK_COMMANDS.NEXT_TRACK,
  PLAYBACK_COMMANDS.PREV_TRACK,
  PLAYBACK_COMMANDS.REPLACE_TRACK,
]);

/**
 * Invoke AudioContext.resume() synchronously inside a user gesture (no await before call).
 * iOS rejects or defers resume when resume() is first reached after queue/stream awaits.
 */
function resumeWebAudioContextFromUserGesture(ctxRef, source = "resumeWebAudioContextFromUserGesture") {
  const ctx = ctxRef?.current;
  if (!ctx || ctx.state !== "suspended") return false;
  const prevState = ctx.state;
  try {
    void ctx.resume();
    if (isPlaybackTraceEnabled()) {
      logAudioContextStateChange({
        source,
        prevState,
        nextState: ctx.state,
        resumed: ctx.state === "running",
        syncGesture: true,
      });
    }
    return true;
  } catch (e) {
    if (isPlaybackTraceEnabled()) {
      logAudioContextStateChange({
        source,
        prevState,
        nextState: ctx.state,
        resumed: false,
        syncGesture: true,
        error: e?.message ?? String(e),
      });
    }
    console.warn("[WebAudio] sync gesture resume failed:", e);
    return false;
  }
}

/** Safari keeps AudioContext suspended until resumed inside a user gesture. */
async function resumeWebAudioContextIfSuspended(ctxRef, source = "resumeWebAudioContextIfSuspended") {
  const ctx = ctxRef?.current;
  if (!ctx || ctx.state !== "suspended") return;
  const prevState = ctx.state;
  try {
    await ctx.resume();
    if (isPlaybackTraceEnabled()) {
      logAudioContextStateChange({
        source,
        prevState,
        nextState: ctx.state,
        resumed: ctx.state === "running",
      });
    }
  } catch (e) {
    if (isPlaybackTraceEnabled()) {
      logAudioContextStateChange({
        source,
        prevState,
        nextState: ctx.state,
        resumed: false,
        error: e?.message ?? String(e),
      });
    }
    console.warn("[WebAudio] resume failed:", e);
  }
}

/** Phase 14F — Web Audio must be running before element play is treated as audible. */
async function ensureWebAudioRunning(ctxRef) {
  await resumeWebAudioContextIfSuspended(ctxRef);
  const ctx = ctxRef?.current;
  if (!ctx) return true;
  return ctx.state === "running";
}

function isFlatPreviewCdnSrc(src) {
  if (!src || isSiteApiMediaPath(src) || isLibraryStreamSrc(src)) return false;
  return /\/previews\/[^/]+-preview\.(wav|mp3|m4a|flac)(\?|$)/i.test(String(src));
}

function getTrackPreviewSrc(track) {
  const previewPath =
    track?.preview_path ||
    track?.previewPath ||
    track?.metadata?.previewPath ||
    track?.preview;
  if (previewPath) {
    const resolved = catalogPreviewAudioUrl(previewPath);
    if (resolved && !isFlatPreviewCdnSrc(resolved)) return resolved;
  }
  const metadataPreview = track?.metadata?.previewSrc;
  if (metadataPreview && !isFlatPreviewCdnSrc(metadataPreview)) return metadataPreview;
  if (track?.src && !isLibraryStreamSrc(track.src) && !isFlatPreviewCdnSrc(track.src)) {
    return track.src;
  }
  return null;
}

function isLikelyIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  const hasTouchDocument = typeof document !== "undefined" && "ontouchend" in document;
  return /iP(hone|ad|od)/i.test(ua) || (/Macintosh/i.test(ua) && hasTouchDocument);
}

/** Entitled library stream (not guest/preview-only cap path). */
function isEntitledFullPlaybackTrack(track) {
  if (!track) return false;
  const access = track.metadata?.access;
  if (access?.previewOnly) return false;
  return Boolean(access?.canStream);
}

/** Whether a stream resolution/playback error should fall back to catalog preview. */
function canFallbackStreamToPreview(err, track) {
  return (
    err?.status === 401 ||
    err?.status === 403 ||
    err?.status === 404 ||
    err?.status === 415 ||
    err?.status === 422 ||
    err?.code === "MEDIA_UNAVAILABLE" ||
    err?.code === "INVALID_STREAM_CONTENT_TYPE" ||
    err?.code === "SIGNED_STREAM_INVALID_CONTENT_TYPE" ||
    err?.code === "SIGNED_STREAM_UNREACHABLE"
  );
}

function dispatchPreviewEnded(slug) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("preview:ended", { detail: { slug } }));
}

function isTransportOnlyPatch(patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return false;
  return keys.every((k) => TRANSPORT_ONLY_STATE_KEYS.has(k));
}

function playbackQueuesMatch(normalized, current) {
  return (
    normalized.length > 0 &&
    normalized.length === current.length &&
    normalized.every((t, i) => isSamePlaybackTrack(t, current[i]))
  );
}

const EMPTY_STATE = {
  currentTrackId: null,
  currentTrack: null,
  source: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  error: null,
  hasStarted: false,
  isBuffering: false,
  accessDenied: false,
  streamRetryable: false,
  streamConflict: null,
  queue: [],
  queueIndex: -1,
  repeatMode: "off",
  shuffle: false,
  csMode: false,
  csTrack: null,
  playbackState: null,
  spaceMode: false,
  bassMode: false,
  atmosphereLevel: 3,
  playbackNetworkState: "idle",
};

function stripSlowedSuffix(title) {
  if (!title) return "Untitled";
  return title.endsWith(SLOWED_SUFFIX) ? title.slice(0, -SLOWED_SUFFIX.length) : title;
}

function withSlowedSuffix(title) {
  const base = stripSlowedSuffix(title);
  return `${base}${SLOWED_SUFFIX}`;
}

const normalizeTrack = (track = {}) => {
  const src = track.src || track.preview || track.audio || track.url || "";
  const slug =
    track.slug ||
    track.trackSlug ||
    track.metadata?.trackSlug ||
    null;
  const id = track.id || track.trackId || slug || null;
  const baseTitle = stripSlowedSuffix(track.title || "Untitled");
  const baseCover = track.baseCover || track.cover || track.coverArt || track.image || null;
  const csAudio = track.csAudio || track.cs_audio || null;
  const csCover = track.csCover || track.cs_cover || track.csCoverArt || null;
  const coverArtType = track.coverArtType || track.cover_art_type || (track.video ? "video" : "image");
  const csCoverType = track.csCoverType || track.cs_cover_type || "image";
  return {
    id: id || slug || src,
    slug: slug || id,
    title: baseTitle,
    artist: track.artist || "2MRRW",
    cover: baseCover,
    baseSrc: track.baseSrc || src,
    baseCover,
    src,
    coverArtType,
    csAudio: csAudio || null,
    csCover: csCover || null,
    csCoverType,
    hasCs: Boolean(csAudio || csCover),
    source: track.source || "unknown",
    metadata: track.metadata || {},
    preview: track.preview || track.preview_path || track.previewPath || null,
    preview_path: track.preview_path || track.previewPath || track.preview || null,
  };
};

function resolvePlaybackPresentation(track, csOn, usingCsSrc) {
  if (!track) return track;
  const baseTitle = stripSlowedSuffix(track.title);
  const baseSrc = track.baseSrc || track.src;
  const baseCover = track.baseCover || track.cover;
  if (!csOn) {
    return {
      ...track,
      title: baseTitle,
      src: baseSrc,
      cover: baseCover,
      playbackRate: 1,
      useCsSrc: false,
    };
  }
  if (track.csAudio) {
    return {
      ...track,
      title: withSlowedSuffix(baseTitle),
      src: track.csAudio,
      cover: track.csCover || baseCover,
      playbackRate: 1,
      useCsSrc: true,
    };
  }
  return {
    ...track,
    title: withSlowedSuffix(baseTitle),
    src: baseSrc,
    cover: baseCover,
    playbackRate: CS_PLAYBACK_RATE,
    useCsSrc: false,
  };
}

function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true
  );
}

function preloadCsAssets(track, refs) {
  refs.csImgRef.current = null;
  refs.csVidRef.current = null;
  refs.csAudioRef.current = null;
  if (!track) return;
  if (track.csCover) {
    const mediaType = resolveCoverMediaType(track.csCover, track.csCoverType);
    if (mediaType === "video") {
      const vid = document.createElement("video");
      vid.preload = "auto";
      vid.src = track.csCover;
      vid.load();
      refs.csVidRef.current = vid;
    } else {
      const img = new Image();
      img.src = track.csCover;
      refs.csImgRef.current = img;
    }
  }
  if (track.csAudio) {
    const preload = new Audio();
    preload.preload = "auto";
    preload.src = track.csAudio;
    preload.load();
    refs.csAudioRef.current = preload;
  }
}

export function AudioProvider({ children }) {
  useBlackscreenMountTrace("AudioProvider");
  const { user, loading: authLoading } = useAuth();
  const entitlementAccountState = useEntitlementAccountState();
  const authLoadingRef = useRef(authLoading);
  const entitlementAccountStateRef = useRef(entitlementAccountState);
  const engineRefsRef = useRef(null);
  if (!engineRefsRef.current || isBrowserPlaybackEnvironment()) {
    engineRefsRef.current = getAudioEngineRefs();
  }
  const {
    audioRef,
    commandQueueRef,
    commandRequestIdRef,
    commandExecutionDepthRef,
    activeCommandRef,
    queueCircuitOpenRef,
    queueWatchdogRef,
    activeStreamAbortRef,
  } = engineRefsRef.current;
  const csImgRef = useRef(null);
  const csVidRef = useRef(null);
  const csAudioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const stereoPannerRef = useRef(null);
  const bassFilterRef = useRef(null);
  const lastPersistRef = useRef({ key: null, at: 0 });
  const pendingSeekRef = useRef(null);
  const stateRef = useRef(EMPTY_STATE);
  const queueRef = useRef([]);
  const queueIndexRef = useRef(-1);
  const repeatModeRef = useRef("off");
  const stopAfterEachTrackRef = useRef(false);
  const sleepTimerRef = useRef({ endsAt: null, afterCurrentTrack: false });
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState(null);
  const [sleepAfterCurrentTrack, setSleepAfterCurrentTrack] = useState(false);
  const shuffleRef = useRef(false);
  const csModeRef = useRef(false);
  const csUsingAlternateSrcRef = useRef(false);
  const playTrackRef = useRef(null);
  const applyCSModeToTrackRef = useRef(null);
  const userPausedRef = useRef(false);
  const isInAudioVisualViewportRef = useRef(false);
  const wasPlayingBeforeViewportPauseRef = useRef(false);
  const viewportPauseRef = useRef(false);
  const resumeEligibleRef = useRef(false);
  const lastTrackIdRef = useRef(null);
  const lastUserActionRef = useRef(null);
  const viewportResumeInFlightRef = useRef(false);
  const skipPauseInterruptionRef = useRef(false);
  const pendingResumeAfterInterruptRef = useRef(null);
  const lastPositionStateAtRef = useRef(0);
  const progressRafRef = useRef(null);
  const listeningUserIdRef = useRef(null);
  const listeningProgressRef = useRef({ slug: null, recorded30s: false });
  const streamMetaRef = useRef(null);
  const streamSwapPreloadRef = useRef(null);
  const streamErrorRetriedRef = useRef(false);
  const onPreviewEndedRef = useRef(null);
  const [previewEnded, setPreviewEnded] = useState(false);
  const wasPlayingBeforeHideRef = useRef(false);
  const wakeLockRef = useRef(null);
  /** OS/lifecycle pause before React isPlaying clears — drives hide/resume intent (Phase 18A). */
  const playbackIntentBeforeHideRef = useRef(false);
  /** Tab hidden while playback intent active — suppress hard recovery (Phase 19). */
  const lifecycleInBackgroundRef = useRef(false);
  /** After healthy lifecycle return — block false hard recovery (Phase 20C). */
  const lifecycleRecoverySuppressedUntilRef = useRef(0);
  /** Phase 21B — last computed lifecycle truth class (A–D). */
  const lifecycleAudioTruthStateRef = useRef(LIFECYCLE_AUDIO_TRUTH_STATES.USER_PAUSED);

  /** Phase 21C — continuity UI freeze snapshot across OS_SUSPENDED (class C). */
  const continuitySnapshotRef = useRef(null);
  const continuityFrozenRef = useRef(false);
  const [continuityFrozen, setContinuityFrozen] = useState(false);
  /** Phase 21B — preserve MS playbackState during OS_SUSPENDED (class C). */
  const lastMediaSessionPlaybackStateRef = useRef(null);
  const keepAliveIntervalRef = useRef(null);
  const swellIntervalRef = useRef(null);
  // Next-track preload: buffers the upcoming queue item while current track plays.
  const nextTrackPreloadRef = useRef(null);
  const nextTrackSignedUrlCacheRef = useRef({});
  // Shuffle order: Fisher-Yates permutation of queue indices (null = not yet generated).
  const shuffledOrderRef = useRef(null);
  const shufflePositionRef = useRef(0);
  const sessionUnlockedRef = useRef(false);
  const webAudioInitializedRef = useRef(false);
  const webAudioAvailableRef = useRef(true);
  const audibilitySampleRef = useRef(createAudibilitySample());
  const recoverAudioHardRef = useRef(null);
  const isRecoveringRef = useRef(false);
  const recoveryInFlightRef = useRef(false);
  const lifecycleRecoveryLockRef = useRef(false);
  const lifecycleRecoveryLockIdRef = useRef(0);
  const lifecycleRecoveryLockTimerRef = useRef(null);
  const bfcacheRecoveryInProgressRef = useRef(false);
  const bfcacheRecoveryTimeoutRef = useRef(null);
  const recoveryCooldownUntilRef = useRef(0);
  const mediaElementSourceElementRef = useRef(null);
  const retryStreamPlaybackRef = useRef(null);
  const positionSaveTimerRef = useRef(null);
  const bufferShowTimerRef = useRef(null);
  const mainGainRef = useRef(null);
  const limiterRef = useRef(null);
  const trackGainRef = useRef(1); // target linear gain for the current track (from gainDb)
  const crossfadeGainRef = useRef(null);
  const crossfadeSourceRef = useRef(null);
  const crossfadeStateRef = useRef("idle"); // "idle" | "fading" | "bridging"
  const lastPlayedSlugRef = useRef(null);
  const csHoldSavedRef = useRef(null);
  const csHoldActiveRef = useRef(false);
  const spuriousEndedGuardRef = useRef(0);
  const playRequestIdRef = useRef(0);
  const internalPlaybackAuthorityRef = useRef(false);
  const dispatchPlaybackCommandRef = useRef(null);
  const nextNextTrackPreloadRef = useRef(null);
  const prevTrackPreloadRef = useRef(null);
  const tabIdRef = useRef(null);
  const broadcastChannelRef = useRef(null);
  const sessionRestoredRef = useRef(false);
  const sessionSaveTimerRef = useRef(null);
  const pendingSessionUpgradeRef = useRef(null);
  const stallSoftTimerRef = useRef(null);
  const stallRecoveryTimerRef = useRef(null);
  const progressListenersRef = useRef(new Set());
  const progressSnapshotRef = useRef({ currentTime: 0, duration: 0 });
  const transportListenersRef = useRef(new Set());
  const transportSnapshotRef = useRef({
    playbackNetworkState: EMPTY_STATE.playbackNetworkState,
    isBuffering: EMPTY_STATE.isBuffering,
  });
  const identityListenersRef = useRef(new Set());
  const identitySnapshotRef = useRef({
    currentTrackId: null,
    currentTrackSlug: null,
    isPlaying: false,
  });
  const renderCountRef = useRef(0);
  const prevRenderDepsRef = useRef({});
  const [state, setState] = useState(EMPTY_STATE);

  const getAudibilityParams = useCallback(() => {
    const audio = audioRef.current;
    return {
      audio,
      webAudioContext: audioCtxRef.current,
      sampleRef: audibilitySampleRef,
    };
  }, []);

  const readIsAudiblyPlaying = useCallback(() => {
    const params = getAudibilityParams();
    if (!params.audio) return false;
    return isAudioActuallyAudible(params);
  }, [getAudibilityParams]);

  const getPlaybackTransportHealth = useCallback(() => {
    const s = stateRef.current;
    return evaluatePlaybackTransportHealth(audioRef.current, s.currentTrack, {
      queueLength: queueRef.current.length,
      queueIndex: queueIndexRef.current,
    });
  }, []);

  const armLifecycleRecoverySuppression = useCallback((source, reason) => {
    lifecycleRecoverySuppressedUntilRef.current =
      Date.now() + LIFECYCLE_RECOVERY_SUPPRESSION_MS;
    logLifecycleRecoverySuppressed({
      source,
      reason,
      slug: stateRef.current.currentTrack?.slug ?? null,
      untilMs: LIFECYCLE_RECOVERY_SUPPRESSION_MS,
    });
  }, []);

  const isLifecycleRecoverySuppressed = useCallback(
    (reason) => {
      if (Date.now() >= lifecycleRecoverySuppressedUntilRef.current) {
        return false;
      }
      const transport = getPlaybackTransportHealth();
      if (!transport.intact) return false;
      if (isGenuineTransportFailureReason(reason)) return false;
      return true;
    },
    [getPlaybackTransportHealth]
  );

  /**
   * Phase 21B — derive lifecycle truth class before recovery/watchdog/MS decisions.
   * C = expected OS lock/background silence with transport intact.
   */
  const computeLifecycleAudioTruthState = useCallback(() => {
    const audio = audioRef.current;
    const track = stateRef.current.currentTrack;
    const transport = evaluatePlaybackTransportHealth(audio, track, {
      queueLength: queueRef.current.length,
      queueIndex: queueIndexRef.current,
    });
    const ctx = audioCtxRef.current;
    const documentHidden = isDocumentPlaybackHidden();
    const lifecycleBackground =
      lifecycleInBackgroundRef.current || documentHidden;
    const playbackIntent = playbackIntentBeforeHideRef.current;
    const userPaused = userPausedRef.current;
    const machineRecovering =
      playbackStateMachine.getState() === PLAYBACK_ORCHESTRATION_STATES.RECOVERING;

    let next = LIFECYCLE_AUDIO_TRUTH_STATES.USER_PAUSED;

    if (userPaused) {
      next = LIFECYCLE_AUDIO_TRUTH_STATES.USER_PAUSED;
    } else if (!transport.intact) {
      next = LIFECYCLE_AUDIO_TRUTH_STATES.RECOVERING;
    } else if (
      isRecoveringRef.current ||
      recoveryInFlightRef.current ||
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
    } else if (stateRef.current.isPlaying && !lifecycleBackground && transport.intact) {
      const params = getAudibilityParams();
      if (params.audio && isAudioActuallyAudible(params)) {
        next = LIFECYCLE_AUDIO_TRUTH_STATES.USER_PLAYING;
      } else if (playbackIntent) {
        next = LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED;
      }
    } else if (playbackIntent && transport.intact) {
      next = LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED;
    }

    const prev = lifecycleAudioTruthStateRef.current;
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
    const snap = continuitySnapshotRef.current;

    // Capture snapshot once on entering class C.
    if (!prevWasC && nextIsC && !snap && stateRef.current.currentTrack) {
      const t = stateRef.current.currentTrack;
      const el = audioRef.current;
      const playbackPosition = el && Number.isFinite(el.currentTime) ? el.currentTime : (stateRef.current.currentTime ?? 0);
      const duration = el && Number.isFinite(el.duration) ? el.duration : (stateRef.current.duration ?? 0);

      const cover = {
        base:
          t?.cover ||
          t?.coverArt ||
          t?.coverUrl ||
          t?.baseCover ||
          "",
        baseArtType: t?.coverArtType ?? null,
        cs: t?.csCover || t?.cs_cover || null,
        csArtType: t?.csCoverType ?? null,
      };

      const snapshot = {
        trackId: t?.id ?? t?.trackId ?? t?.slug ?? null,
        slug: t?.slug ?? null,
        playbackPosition,
        queueIndex: queueIndexRef.current,
        isPlaying: Boolean(playbackIntentBeforeHideRef.current),
        duration,
        cover,
        title: t?.title ?? null,
        artist: t?.artist ?? null,
        album: t?.album ?? null,
        timestamp: Date.now(),
      };

      continuitySnapshotRef.current = snapshot;
      setContinuityFrozenUi(true);

      // Freeze progress display immediately.
      progressSnapshotRef.current = {
        currentTime: snapshot.playbackPosition,
        duration: snapshot.duration,
      };
      notifyProgressListeners({ force: true });

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

    // Release freeze when audio + UI intent match snapshot.
    if (continuityFrozenRef.current && continuitySnapshotRef.current) {
      const currentSnap = continuitySnapshotRef.current;
      const el = audioRef.current;
      const stateIntentIsPlaying = stateRef.current.isPlaying;
      const shouldRelease =
        Boolean(el) &&
        transport.intact &&
        !el.paused &&
        !el.ended &&
        stateIntentIsPlaying === currentSnap.isPlaying;

      if (shouldRelease) {
        setContinuityFrozenUi(false);
        continuitySnapshotRef.current = null;

        progressSnapshotRef.current = {
          currentTime: stateRef.current.currentTime ?? el.currentTime ?? 0,
          duration:
            stateRef.current.duration ??
            (Number.isFinite(el.duration) ? el.duration : 0) ??
            0,
        };
        notifyProgressListeners({ force: true });

        logPlaybackContinuityRestored({
          source: "computeLifecycleAudioTruthState",
          trackId: currentSnap.trackId,
          slug: currentSnap.slug,
          playbackPosition: progressSnapshotRef.current.currentTime,
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

    lifecycleAudioTruthStateRef.current = next;
    return next;
  }, [getAudibilityParams]);

  const isLifecycleOsSuspended = useCallback(() => {
    return (
      computeLifecycleAudioTruthState() === LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED
    );
  }, [computeLifecycleAudioTruthState]);

  const blockRecoveryForLifecycleOsSuspended = useCallback(
    (source, reason) => {
      if (!isLifecycleOsSuspended()) return false;
      if (isGenuineTransportFailureReason(reason)) return false;
      logRecoveryBlockedLifecycleC({
        source,
        reason: reason ?? null,
        slug: stateRef.current.currentTrack?.slug ?? null,
      });
      logLifecycleStateCSuppressed({
        source,
        gate: "recovery",
        reason: reason ?? null,
        slug: stateRef.current.currentTrack?.slug ?? null,
      });
      return true;
    },
    [isLifecycleOsSuspended]
  );

  /** Phase 15F / 20C — lifecycle health; transport failures trump OS pause/suspend. */
  const evaluateLifecyclePlaybackHealth = useCallback(
    ({ resumeAfter = false, lifecycleIntent = false } = {}) => {
    if (isLifecycleOsSuspended()) {
      return { healthy: false, reason: "os_suspended_ignored", osSuspended: true };
    }

    const s = stateRef.current;
    const track = s.currentTrack;
    if (!track) return { healthy: false, reason: "no_track" };
    if (!s.hasStarted) return { healthy: false, reason: "not_started" };

    const audio = audioRef.current;
    if (!audio) return { healthy: false, reason: "no_audio_element" };

    const transport = evaluatePlaybackTransportHealth(audio, track, {
      queueLength: queueRef.current.length,
      queueIndex: queueIndexRef.current,
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

    const ctx = audioCtxRef.current;
    const ctxSuspended = ctx?.state === "suspended";
    const hasInterruptIntent =
      playbackIntentBeforeHideRef.current || Boolean(lifecycleIntent);

    if (!resumeAfter) {
      if (hasInterruptIntent && audio.paused && !userPausedRef.current) {
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

    updateAudibilitySample(audio, audibilitySampleRef);
    const params = getAudibilityParams();
    if (isAudioActuallyAudible(params)) {
      logLifecycleTransportHealthy({
        source: "evaluateLifecyclePlaybackHealth",
        reason: "audible",
        resumeAfter,
        slug: track.slug ?? null,
      });
      return { healthy: true, reason: "audible" };
    }

    if (audio.paused) {
      return { healthy: false, reason: "paused_expected_playing" };
    }
    if (audio.readyState < 2) {
      return { healthy: false, reason: "not_ready" };
    }

    return { healthy: false, reason: "not_audible" };
  },
    [getAudibilityParams, isLifecycleOsSuspended]
  );

  const tracePlayback = useCallback((type, source, extra = {}) => {
    const t = stateRef.current.currentTrack;
    logPlaybackEvent({
      type,
      source,
      trackId: t?.id ?? t?.trackId ?? t?.slug ?? null,
      extra,
    });
  }, []);

  const emitBackgroundPlaybackDiagnostics = useCallback((source) => {
    const audio = audioRef.current;
    const track = stateRef.current.currentTrack;
    const ctx = audioCtxRef.current;
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
      intent: playbackIntentBeforeHideRef.current,
      lifecycleBackground: lifecycleInBackgroundRef.current,
      userPaused: userPausedRef.current,
      slug: track?.slug ?? null,
    });
  }, []);

  /** Phase 21 — observation-only audible vs transport divergence snapshots. */
  const emitPhase21AudibleSnapshot = useCallback(
    (source) => {
      const audio = audioRef.current;
      const track = stateRef.current.currentTrack;
      const ctx = audioCtxRef.current;
      const msPlaybackState =
        typeof navigator !== "undefined" && "mediaSession" in navigator
          ? navigator.mediaSession.playbackState ?? null
          : null;
      const params = getAudibilityParams();
      const isAudible = params.audio ? isAudioActuallyAudible(params) : false;
      captureAudibleOutputSnapshot({
        source,
        audio,
        webAudioContext: ctx,
        track,
        hasIntactTransport: hasIntactPlaybackTransport(audio, track),
        mediaSessionPlaybackState: msPlaybackState,
        playbackIntent: playbackIntentBeforeHideRef.current,
        lifecycleBackground:
          lifecycleInBackgroundRef.current || isDocumentPlaybackHidden(),
        isAudible,
        slug: track?.slug ?? null,
      });
    },
    [getAudibilityParams]
  );

  const logDirectInternalCallViolation = useCallback((fnName) => {
    if (commandExecutionDepthRef.current > 0) return;
    if (internalPlaybackAuthorityRef.current) return;
    const stack =
      typeof Error !== "undefined" ? new Error().stack?.split("\n").slice(1).join("\n") : null;
    const { module, action } = parsePlaybackCallerFromStack(stack);
    logPlaybackAuthViolation(fnName, {
      module,
      action,
      reason: "command_execution_depth_zero",
      source: "AudioContext",
      stack,
    });
  }, []);

  const getCurrentTrackId = useCallback(() => {
    const track = stateRef.current.currentTrack;
    if (!track) return null;
    return track.id ?? track.trackId ?? track.slug ?? null;
  }, []);

  const clearViewportResume = useCallback(() => {
    wasPlayingBeforeViewportPauseRef.current = false;
    resumeEligibleRef.current = false;
    lastTrackIdRef.current = null;
  }, []);

  const getProgressSnapshot = useCallback(() => progressSnapshotRef.current, []);
  const getContinuitySnapshot = useCallback(() => continuitySnapshotRef.current, []);

  const setContinuityFrozenUi = useCallback((next) => {
    if (continuityFrozenRef.current === next) return;
    continuityFrozenRef.current = next;
    setContinuityFrozen(next);
  }, []);

  const subscribeProgress = useCallback((listener) => {
    progressListenersRef.current.add(listener);
    return () => progressListenersRef.current.delete(listener);
  }, []);

  const notifyProgressListeners = useCallback(({ force = false } = {}) => {
    if (!force && continuityFrozenRef.current) return;
    const s = stateRef.current;
    const next = { currentTime: s.currentTime ?? 0, duration: s.duration ?? 0 };
    const prev = progressSnapshotRef.current;
    if (prev.currentTime === next.currentTime && prev.duration === next.duration) return;
    progressSnapshotRef.current = next;
    progressListenersRef.current.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore listener errors */
      }
    });
    notifyMediaEngineBridge();
  }, []);

  /** Phase P4 — user-initiated track change must not leave 21C UI frozen on stale snapshot. */
  const clearContinuityFreeze = useCallback((source = "track_change") => {
    if (!continuityFrozenRef.current && !continuitySnapshotRef.current) return;
    const snap = continuitySnapshotRef.current;
    continuitySnapshotRef.current = null;
    setContinuityFrozenUi(false);
    progressSnapshotRef.current = {
      currentTime: stateRef.current.currentTime ?? audioRef.current?.currentTime ?? 0,
      duration:
        stateRef.current.duration ??
        (Number.isFinite(audioRef.current?.duration) ? audioRef.current.duration : 0) ??
        0,
    };
    notifyProgressListeners({ force: true });
    if (snap) {
      logPlaybackContinuityRestored({
        source,
        trackId: snap.trackId,
        slug: snap.slug,
        playbackPosition: progressSnapshotRef.current.currentTime,
        isPlaying: snap.isPlaying,
      });
      logUiContinuityReconciled({
        source,
        trackId: snap.trackId,
        slug: snap.slug,
        isPlaying: snap.isPlaying,
      });
    }
  }, [notifyProgressListeners, setContinuityFrozenUi]);

  const getTransportSnapshot = useCallback(() => transportSnapshotRef.current, []);

  const subscribeTransport = useCallback((listener) => {
    transportListenersRef.current.add(listener);
    return () => transportListenersRef.current.delete(listener);
  }, []);

  const notifyTransportListeners = useCallback(() => {
    transportListenersRef.current.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore listener errors */
      }
    });
    notifyMediaEngineBridge();
  }, []);

  const subscribeIdentity = useCallback((listener) => {
    identityListenersRef.current.add(listener);
    return () => identityListenersRef.current.delete(listener);
  }, []);

  const getIdentitySnapshot = useCallback(() => identitySnapshotRef.current, []);

  const notifyIdentityListeners = useCallback(() => {
    identityListenersRef.current.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore listener errors */
      }
    });
  }, []);

  const syncProgressTime = useCallback((time) => {
    if (!Number.isFinite(time)) return;
    stateRef.current = { ...stateRef.current, currentTime: time };
    notifyProgressListeners();
  }, [notifyProgressListeners]);

  useEffect(() => {
    authLoadingRef.current = authLoading;
  }, [authLoading]);

  useEffect(() => {
    listeningUserIdRef.current = user?.id || null;
  }, [user?.id]);

  // Session restore: hydrate queue/shuffle/repeat from last session when user is known.
  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      sessionRestoredRef.current = false;
      return;
    }
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    const session = loadPlaybackSession(userId);
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
    // Prime upgrade on next play if track has stream access.
    if (
      restoredTrack?.metadata?.access?.canStream &&
      !restoredTrack?.metadata?.access?.previewOnly
    ) {
      pendingSessionUpgradeRef.current = restoredTrack.slug;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // BroadcastChannel: pause this tab when another tab starts playing.
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
      audio.pause();
    };
    return () => {
      bc.close();
      broadcastChannelRef.current = null;
    };
  }, []);

  useEffect(() => {
    entitlementAccountStateRef.current = entitlementAccountState;

    // Sync live queue access flags when entitlements change (user adds/removes from library,
    // subscription activates/expires). Keeps queue accurate without rebuilding it.
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
      return {
        ...track,
        metadata: {
          ...(track.metadata || {}),
          access: { ...(prev || {}), ...fresh },
        },
      };
    });

    if (!changed) return;
    queueRef.current = updated;
    patchState({ queue: updated });

    // If the currently-playing track just gained stream access, upgrade it immediately.
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

  useEffect(() => {
    if (!isBrowserPlaybackEnvironment()) return undefined;
    engineRefsRef.current = getAudioEngineRefs();
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
    return () => {
      noteAudioProviderUnmount();
    };
  }, []);

  const stopPositionSaveTimer = useCallback(() => {
    if (positionSaveTimerRef.current) {
      clearInterval(positionSaveTimerRef.current);
      positionSaveTimerRef.current = null;
    }
  }, []);

  const stopStallRecovery = useCallback(() => {
    if (stallSoftTimerRef.current) {
      clearTimeout(stallSoftTimerRef.current);
      stallSoftTimerRef.current = null;
    }
    if (stallRecoveryTimerRef.current) {
      clearTimeout(stallRecoveryTimerRef.current);
      stallRecoveryTimerRef.current = null;
    }
  }, []);

  const startStallRecovery = useCallback(() => {
    stopStallRecovery();
    const track = stateRef.current.currentTrack;
    if (!track || !stateRef.current.isPlaying) return;

    // Stage 1 — soft recovery (2.5s): a tiny backward seek forces the browser to
    // abort the stalled Range request and issue a fresh one from the same position.
    // Resolves ~80% of mobile stalls (dropped packet, iOS network throttle) without
    // re-fetching a signed URL or restarting the audio element.
    stallSoftTimerRef.current = setTimeout(() => {
      stallSoftTimerRef.current = null;
      const audio = audioRef.current;
      if (!audio || audio.paused || !stateRef.current.isPlaying) return;
      if (!stateRef.current.isBuffering) return;
      tracePlayback("recovery", "stallSoftRecovery", {
        slug: track.slug,
        currentTime: audio.currentTime,
      });
      try {
        // Step back 0.1 s so the browser re-issues the Range request from a clean byte boundary.
        audio.currentTime = Math.max(0, audio.currentTime - 0.1);
        // Guard: only call play() if the element is actually paused — a concurrent play()
        // promise may already be in flight (e.g. from waitAudioSrcReady), and a second
        // play() call while one is pending triggers an AbortError on most browsers.
        if (audio.paused) audio.play().catch(() => {});
      } catch {
        /* soft recovery is best-effort */
      }
    }, STALL_SOFT_RECOVERY_MS);

    // Stage 2 — hard recovery (7s): full signed-URL refresh + replay from position.
    // Only for entitled full-playback tracks (preview URLs never expire and don't need it).
    if (!isEntitledFullPlaybackTrack(track)) return;
    stallRecoveryTimerRef.current = setTimeout(() => {
      stallRecoveryTimerRef.current = null;
      const audio = audioRef.current;
      if (!audio || audio.paused || !stateRef.current.isPlaying) return;
      if (!stateRef.current.isBuffering) return;
      logPlaybackResilience("stall-recovery", {
        source: "AudioContext",
        code: "STALL_RECOVERY_RETRY",
        slug: track.slug,
        currentTime: audio.currentTime,
      });
      tracePlayback("recovery", "stallHardRecovery", {
        slug: track.slug,
        currentTime: audio.currentTime,
      });
      streamErrorRetriedRef.current = false;
      void retryStreamPlaybackRef.current?.();
    }, STALL_HARD_RECOVERY_MS);
  }, [stopStallRecovery]);

  const startPositionSaveTimer = useCallback(() => {
    stopPositionSaveTimer();
    positionSaveTimerRef.current = setInterval(() => {
      const audio = audioRef.current;
      const track = stateRef.current.currentTrack;
      const userId = listeningUserIdRef.current;
      if (!audio || !track?.slug || !userId || audio.paused) return;
      const dur = isFinite(audio.duration) ? audio.duration : 0;
      const pos = audio.currentTime || 0;
      if (dur > 0 && isNearEndRestorePosition(pos, dur)) return;
      savePlaybackPosition(userId, track.slug, pos, dur);
    }, POSITION_SAVE_INTERVAL_MS);
  }, [stopPositionSaveTimer]);

  const finalizeStreamSession = useCallback((meta, { completed = false, durationSeconds = 0 } = {}) => {
    if (!meta?.streamEventId && !meta?.sessionId && !meta?.slug) return;
    void endStreamAnalytics({
      streamEventId: meta.streamEventId || null,
      sessionId: meta.sessionId || null,
      slug: meta.slug || null,
      durationSeconds,
      completed,
    });
    streamMetaRef.current = null;
  }, []);

  const recordLocalListening = useCallback((track, meta = {}) => {
    const userId = listeningUserIdRef.current;
    if (!userId || !track?.slug) return;
    if (meta.completed) {
      clearPlaybackPosition(userId, track.slug);
    }
    recordListeningEvent(
      track.slug,
      {
        title: track.title,
        cover: track.cover,
        positionSeconds: meta.positionSeconds ?? 0,
        durationSeconds: meta.durationSeconds ?? 0,
        completed: Boolean(meta.completed),
      },
      userId
    );
  }, []);

  const logPlaybackDesyncIfNeeded = useCallback((prev, next) => {
    const el = audioRef.current;
    if (!el?.paused || !next.isPlaying) return;
    if (isPlaybackTraceEnabled()) {
      console.warn("[PLAYBACK-DESYNC] state.isPlaying but audio.paused", {
        playbackState: next.playbackState,
        slug: next.currentTrack?.slug ?? null,
        command: activeCommandRef.current?.type ?? null,
        wasPlayingInPrev: Boolean(prev.isPlaying),
      });
    }
  }, []);

  const reconcileIsPlayingWithElement = useCallback((prev, next) => {
    const el = audioRef.current;
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
    const refNetworkState = stateRef.current?.playbackNetworkState;
    if (networkState === "loading_stream" || refNetworkState === "loading_stream") return next;
    logPlaybackDesyncIfNeeded(prev, next);
    return {
      ...next,
      isPlaying: false,
      playbackState:
        next.playbackState === "playing" ? "paused" : next.playbackState,
    };
  }, [logPlaybackDesyncIfNeeded]);

  const patchTransport = useCallback(
    (patch) => {
      const prev = stateRef.current;
      let next = { ...prev, ...patch };
      next = reconcileIsPlayingWithElement(prev, next);
      stateRef.current = next;
      const transportNext = {
        playbackNetworkState: next.playbackNetworkState ?? "idle",
        isBuffering: Boolean(next.isBuffering),
      };
      const snap = transportSnapshotRef.current;
      if (
        snap.playbackNetworkState === transportNext.playbackNetworkState &&
        snap.isBuffering === transportNext.isBuffering &&
        !("duration" in patch)
      ) {
        return;
      }
      transportSnapshotRef.current = transportNext;
      if ("duration" in patch && patch.duration !== progressSnapshotRef.current.duration) {
        progressSnapshotRef.current = {
          currentTime: progressSnapshotRef.current.currentTime,
          duration: patch.duration ?? 0,
        };
        notifyProgressListeners();
      }
      notifyTransportListeners();
      const prevIsPlaying = identitySnapshotRef.current.isPlaying;
      const nextIsPlaying = Boolean(next.isPlaying);
      if (prevIsPlaying !== nextIsPlaying) {
        identitySnapshotRef.current = { ...identitySnapshotRef.current, isPlaying: nextIsPlaying };
        notifyIdentityListeners();
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("2mrrw:playback-active-changed", { detail: { isPlaying: nextIsPlaying } })
          );
        }
      }
    },
    [reconcileIsPlayingWithElement, notifyProgressListeners, notifyTransportListeners, notifyIdentityListeners]
  );

  const patchState = useCallback((patch) => {
    if (isTransportOnlyPatch(patch)) {
      patchTransport(patch);
      return;
    }
    const uiPatch = { ...patch };
    const transportFields = {};
    for (const key of TRANSPORT_ONLY_STATE_KEYS) {
      if (key in uiPatch) {
        transportFields[key] = uiPatch[key];
        delete uiPatch[key];
      }
    }
    if (Object.keys(transportFields).length) {
      patchTransport(transportFields);
    }
    if (!Object.keys(uiPatch).length) return;
    setState((prev) => {
      let next = { ...prev, ...uiPatch };
      const shouldHaveStarted =
        next.hasStarted === false &&
        (next.isPlaying === true || next.playbackState === "ready" || next.playbackState === "playing");
      if (shouldHaveStarted) {
        if (next.playbackState === "playing") {
          reportPlaybackDiagnostic({
            level: "warn",
            code: "PLAYBACK_VISIBILITY_INVARIANT_RECOVERED",
            command: activeCommandRef.current?.type || "STATE_PATCH",
            requestId: activeCommandRef.current?.requestId || null,
            state: next,
            context: { reason: "playing_with_hasStarted_false" },
          });
        }
        next = { ...next, hasStarted: true };
      }
      if (
        next.isPlaying &&
        next.playbackState === "playing" &&
        !isRecoveringRef.current
      ) {
        const audio = audioRef.current;
        const ctx = audioCtxRef.current;
        if (
          isLifecycleRecoverySuppressed("fatal_audio_desync_invariant") &&
          evaluatePlaybackTransportHealth(audio, next.currentTrack, {
            queueLength: queueRef.current.length,
            queueIndex: queueIndexRef.current,
          }).intact
        ) {
          return reconcileIsPlayingWithElement(prev, next);
        }
        if (isLifecycleOsSuspended()) {
          logLifecycleStateCSuppressed({
            source: "patchState",
            gate: "fatal_audio_desync_invariant",
            slug: next.currentTrack?.slug ?? null,
          });
          return reconcileIsPlayingWithElement(prev, next);
        }
        if (
          audio &&
          !isAudioActuallyAudible({
            audio,
            webAudioContext: ctx,
            sampleRef: audibilitySampleRef,
          })
        ) {
          reportPlaybackDiagnostic({
            level: "warn",
            code: "FATAL_AUDIO_DESYNC",
            command: activeCommandRef.current?.type || "STATE_PATCH",
            requestId: activeCommandRef.current?.requestId || null,
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
                  !userPausedRef.current && Boolean(next.currentTrack),
              }
            );
          });
        }
      }
      const reconciled = reconcileIsPlayingWithElement(prev, next);
      stateRef.current = reconciled;
      transportSnapshotRef.current = {
        playbackNetworkState: reconciled.playbackNetworkState ?? "idle",
        isBuffering: Boolean(reconciled.isBuffering),
      };
      const prevIdentity = identitySnapshotRef.current;
      const nextTrackId = reconciled.currentTrackId ?? null;
      const nextTrackSlug = reconciled.currentTrack?.slug ?? null;
      const nextIsPlaying = Boolean(reconciled.isPlaying);
      if (
        prevIdentity.currentTrackId !== nextTrackId ||
        prevIdentity.currentTrackSlug !== nextTrackSlug ||
        prevIdentity.isPlaying !== nextIsPlaying
      ) {
        identitySnapshotRef.current = {
          currentTrackId: nextTrackId,
          currentTrackSlug: nextTrackSlug,
          isPlaying: nextIsPlaying,
        };
        notifyIdentityListeners();
        if (prevIdentity.isPlaying !== nextIsPlaying && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("2mrrw:playback-active-changed", { detail: { isPlaying: nextIsPlaying } })
          );
        }
      }
      if (playbackUiStateEqual(prev, reconciled)) {
        if (isUiHydrationTraceEnabled()) {
          logUiHydrationTrace("PLAYBACK_UI_PATCH_SKIPPED", {
            slug: reconciled.currentTrack?.slug ?? null,
            playbackState: reconciled.playbackState ?? null,
            phase: "p12-ui-equal",
          });
        }
        return prev;
      }
      return reconciled;
    });
  }, [
    isLifecycleOsSuspended,
    isLifecycleRecoverySuppressed,
    reconcileIsPlayingWithElement,
    patchTransport,
  ]);

  const stopProgressRaf = useCallback(() => {
    if (progressRafRef.current != null) {
      cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
    }
  }, []);

  const startProgressRaf = useCallback(() => {
    stopProgressRaf();
    const tick = () => {
      const audio = audioRef.current;
      if (!audio || audio.paused || audio.ended) {
        stopProgressRaf();
        return;
      }
      updateAudibilitySample(audio, audibilitySampleRef);
      const t = audio.currentTime || 0;
      const prev = stateRef.current;
      if (Math.abs(t - prev.currentTime) >= 0.001) {
        syncProgressTime(t);
      }
      progressRafRef.current = requestAnimationFrame(tick);
    };
    progressRafRef.current = requestAnimationFrame(tick);
  }, [stopProgressRaf, syncProgressTime]);

  const postKeepAliveToServiceWorker = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
    try {
      navigator.serviceWorker.controller.postMessage({ type: "KEEP_ALIVE" });
    } catch {
      /* SW ping best-effort */
    }
  }, []);

  const stopKeepAlivePing = useCallback(() => {
    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = null;
    }
  }, []);

  const startKeepAlivePing = useCallback(() => {
    stopKeepAlivePing();
    postKeepAliveToServiceWorker();
    keepAliveIntervalRef.current = setInterval(
      postKeepAliveToServiceWorker,
      KEEP_ALIVE_INTERVAL_MS
    );
  }, [postKeepAliveToServiceWorker, stopKeepAlivePing]);

  const syncPositionState = useCallback((force = false) => {
    const audio = audioRef.current;
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
    if (!force && now - lastPositionStateAtRef.current < POSITION_STATE_THROTTLE_MS) {
      return;
    }
    lastPositionStateAtRef.current = now;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(Math.max(0, audio.currentTime), audio.duration),
      });
    } catch {
      /* unsupported duration/position combo */
    }
  }, []);

  const updateMediaSession = useCallback(async (track, { playing } = {}) => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (!track) return;

    const coverForSession =
      csModeRef.current && (track.csCover || track.cs_cover)
        ? track.csCover || track.cs_cover
        : track.cover || track.coverArt || track.coverUrl || track.baseCover || "";
    const artwork = await getArtworkEntriesForTrack(coverForSession, track.slug);
    try {
      ms.metadata = new MediaMetadata({
        title: csModeRef.current ? `${track.title || "Untitled"} ◈` : (track.title || "Untitled"),
        artist: track.artist || "2MRRW",
        album: track.album || "2MRRW",
        artwork,
      });
      const truthState = computeLifecycleAudioTruthState();
      if (truthState === LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED) {
        const preserved =
          lastMediaSessionPlaybackStateRef.current ?? ms.playbackState ?? "playing";
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
        lastMediaSessionPlaybackStateRef.current = ms.playbackState;
      }
    } catch {
      /* MediaMetadata unsupported */
    }

    const audio = audioRef.current;
    persistMediaSessionTrack(track, {
      playing,
      currentTime: audio?.currentTime ?? stateRef.current.currentTime,
      duration: isFinite(audio?.duration) ? audio.duration : stateRef.current.duration,
    });
    syncPositionState(true);
  }, [computeLifecycleAudioTruthState, syncPositionState]);

  const rehydrateMediaSession = useCallback(() => {
    const s = stateRef.current;
    if (!s.currentTrack || !s.hasStarted) return;
    void updateMediaSession(s.currentTrack, { playing: s.isPlaying });
    syncPositionState(true);
  }, [updateMediaSession, syncPositionState]);

  /** Phase 20C — Media Session parity after lifecycle return without hard recovery. */
  const syncMediaSessionAfterLifecycle = useCallback(
    async (resumeAfter) => {
      const s = stateRef.current;
      const track = s.currentTrack;
      const audio = audioRef.current;
      if (!track) return;
      const shouldShowPlaying =
        resumeAfter &&
        !userPausedRef.current &&
        Boolean(audio && !audio.paused && !audio.ended);
      await updateMediaSession(track, { playing: shouldShowPlaying });
    },
    [updateMediaSession]
  );

  const connectWebAudioDownstream = useCallback((ctx, source) => {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    const stereoPanner = ctx.createStereoPanner();
    stereoPanner.pan.value = 0;
    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = "lowshelf";
    bassFilter.frequency.value = 200;
    bassFilter.gain.value = 0;
    const mainGain = ctx.createGain();
    mainGain.gain.value = 1;
    // Transparent limiter: only activates above -1 dBFS, preserves the artist's master.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    try { mainGainRef.current?.disconnect(); } catch {}
    try { analyserRef.current?.disconnect(); } catch {}
    try { stereoPannerRef.current?.disconnect(); } catch {}
    try { bassFilterRef.current?.disconnect(); } catch {}
    try { limiterRef.current?.disconnect(); } catch {}
    source.connect(mainGain);
    mainGain.connect(analyser);
    analyser.connect(stereoPanner);
    stereoPanner.connect(bassFilter);
    bassFilter.connect(limiter);
    limiter.connect(ctx.destination);
    mainGainRef.current = mainGain;
    analyserRef.current = analyser;
    stereoPannerRef.current = stereoPanner;
    bassFilterRef.current = bassFilter;
    limiterRef.current = limiter;
    webAudioInitializedRef.current = true;
    webAudioAvailableRef.current = true;
  }, []);

  const initWebAudio = useCallback(() => {
    if (webAudioInitializedRef.current || typeof window === "undefined") return;
    const audio = audioRef.current;
    if (!audio) return;
    mediaElementSourceElementRef.current = audio;

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;

      let ctx = audioCtxRef.current;
      let source = sourceRef.current;

      if (ctx && ctx.state !== "closed" && source && mediaElementSourceElementRef.current === audio) {
        connectWebAudioDownstream(ctx, source);
        recordAudioContextState(ctx, "initWebAudio:reconnect");
        return;
      }

      if (!ctx || ctx.state === "closed") {
        ctx = new Ctx();
        audioCtxRef.current = ctx;
      }

      if (!source || mediaElementSourceElementRef.current !== audio) {
        if (!audio[MRRW_MEDIA_SOURCE_BOUND]) {
          source = ctx.createMediaElementSource(audio);
          audio[MRRW_MEDIA_SOURCE_BOUND] = true;
          sourceRef.current = source;
          mediaElementSourceElementRef.current = audio;
        } else if (!sourceRef.current) {
          webAudioAvailableRef.current = false;
          webAudioInitializedRef.current = false;
          return;
        }
      }

      connectWebAudioDownstream(ctx, source);
      // Wire the next-track pre-buffer into a crossfade gain channel (one-time per AudioContext).
      if (!crossfadeSourceRef.current) {
        const nextEl = nextTrackPreloadRef.current;
        if (nextEl && !nextEl[MRRW_MEDIA_SOURCE_BOUND]) {
          try {
            const cfSrc = ctx.createMediaElementSource(nextEl);
            nextEl[MRRW_MEDIA_SOURCE_BOUND] = true;
            const cfGain = ctx.createGain();
            cfGain.gain.value = 0;
            cfSrc.connect(cfGain);
            cfGain.connect(ctx.destination);
            crossfadeSourceRef.current = cfSrc;
            crossfadeGainRef.current = cfGain;
          } catch {
            /* crossfade channel unavailable — graceful no-op */
          }
        }
      }
      recordAudioContextState(ctx, "initWebAudio");
    } catch (err) {
      console.warn("[AUDIO] Web Audio graph init failed, routing direct:", err?.message || err);
      try {
        analyserRef.current?.disconnect();
      } catch {
        /* partial graph */
      }
      try {
        stereoPannerRef.current?.disconnect();
      } catch {
        /* partial graph */
      }
      try {
        bassFilterRef.current?.disconnect();
      } catch {
        /* partial graph */
      }
      mainGainRef.current = null;
      limiterRef.current = null;
      analyserRef.current = null;
      stereoPannerRef.current = null;
      bassFilterRef.current = null;
      webAudioInitializedRef.current = false;
      webAudioAvailableRef.current = false;
    }
  }, [connectWebAudioDownstream]);

  const attemptLightweightPlaybackResume = useCallback(
    async (source) => {
      const audio = audioRef.current;
      const track = stateRef.current.currentTrack;
      if (!audio || !track || userPausedRef.current) return false;
      if (!hasIntactPlaybackTransport(audio, track)) return false;

      internalPlaybackAuthorityRef.current = true;
      try {
        initWebAudio();
        await resumeWebAudioContextIfSuspended(audioCtxRef);
        recordAudioContextState(audioCtxRef.current, `lightweightResume:${source}`);
        if (!(await ensureWebAudioRunning(audioCtxRef))) {
          return false;
        }

        if (audio.paused) {
          skipPauseInterruptionRef.current = true;
          await playAudioIfNotPaused(audio, true, {
            command: PLAYBACK_COMMANDS.RECOVER,
            requestId: activeCommandRef.current?.requestId || null,
            state: stateRef.current,
            context: { source, lightweight: true },
          });
        }

        updateAudibilitySample(audio, audibilitySampleRef);
        const params = getAudibilityParams();
        if (isAudioActuallyAudible(params)) return true;
        return !audio.paused && !audio.ended && audio.readyState >= 2;
      } catch {
        return false;
      } finally {
        internalPlaybackAuthorityRef.current = false;
      }
    },
    [getAudibilityParams, initWebAudio]
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const unlockFromGesture = async () => {
      const ctx = audioCtxRef.current;
      const needsUnlock =
        !sessionUnlockedRef.current || ctx?.state === "suspended" || ctx?.state === "interrupted";
      if (!needsUnlock) return;

      const audio = audioRef.current;
      if (audio) {
        try {
          // Only call audio.load() when the element has no src or hasn't started loading yet.
          // Calling load() on an element with readyState >= HAVE_METADATA aborts the in-flight
          // byte-range request, doubling buffering latency on gesture during active playback.
          if (!audio.src || audio.networkState === /* NETWORK_EMPTY */ 0) {
            audio.load();
          }
        } catch {
          /* Android session priming */
        }
      }

      initWebAudio();
      await resumeWebAudioContextIfSuspended(audioCtxRef);
      recordAudioContextState(audioCtxRef.current, "gesture-unlock");

      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx && !audioCtxRef.current) {
          const ephemeral = new Ctx();
          if (ephemeral.state === "suspended") {
            await ephemeral.resume();
          }
          recordAudioContextState(ephemeral, "ephemeral-unlock");
          await ephemeral.close();
        }
      } catch {
        /* iOS unlock best-effort */
      }

      if (audioCtxRef.current?.state === "running") {
        sessionUnlockedRef.current = true;
        GESTURE_UNLOCK_EVENTS.forEach((evt) => {
          document.removeEventListener(evt, unlockFromGesture, true);
        });
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

  const toggleSpaceMode = useCallback(() => {
    const next = !stateRef.current.spaceMode;
    patchState({ spaceMode: next });
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

  useEffect(() => {
    const liveTime = stateRef.current.currentTime;
    stateRef.current = { ...state, currentTime: liveTime };
    queueRef.current = state.queue || [];
    queueIndexRef.current = state.queueIndex ?? -1;
    repeatModeRef.current = state.repeatMode || "off";
    shuffleRef.current = Boolean(state.shuffle);
    csModeRef.current = Boolean(state.csMode);
    if (continuityFrozenRef.current) {
      // Keep progress display frozen across OS_SUSPENDED; audio can reconcile silently.
      notifyMediaEngineBridge();
    } else if (state.duration !== progressSnapshotRef.current.duration) {
      progressSnapshotRef.current = {
        currentTime: progressSnapshotRef.current.currentTime,
        duration: state.duration ?? 0,
      };
      notifyProgressListeners();
    } else {
      notifyMediaEngineBridge();
    }
  }, [state, notifyProgressListeners]);

  // Debounced session save when queue context changes (queue, index, shuffle, repeat).
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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

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

    const onWaiting = () => {
      startStallRecovery();
      if (bufferShowTimerRef.current) clearTimeout(bufferShowTimerRef.current);
      bufferShowTimerRef.current = setTimeout(() => {
        bufferShowTimerRef.current = null;
        const el = audioRef.current;
        const networkState = el && !el.played?.length ? "loading_stream" : "buffering";
        patchState({ isBuffering: true, playbackNetworkState: networkState });
      }, 500);
    };
    const onStalled = () => {
      startStallRecovery();
      if (bufferShowTimerRef.current) clearTimeout(bufferShowTimerRef.current);
      bufferShowTimerRef.current = setTimeout(() => {
        bufferShowTimerRef.current = null;
        const el = audioRef.current;
        const networkState = el && !el.played?.length ? "loading_stream" : "buffering";
        patchState({ isBuffering: true, playbackNetworkState: networkState });
      }, 500);
    };
    const onPlaying = () => {
      if (bufferShowTimerRef.current) {
        clearTimeout(bufferShowTimerRef.current);
        bufferShowTimerRef.current = null;
      }
      stopStallRecovery();
      patchState({ isBuffering: false, playbackNetworkState: "playing" });
      perfMark(MARKS.PLAYBACK_AUDIBLE);
      perfMark(MARKS.AUDIO_START_LATENCY_END);
      perfMeasure("audio-start-latency", MARKS.AUDIO_START_LATENCY_START, MARKS.AUDIO_START_LATENCY_END);
      dumpPlaybackTiming();
    };
    const onCanPlayThrough = () => {
      if (bufferShowTimerRef.current) {
        clearTimeout(bufferShowTimerRef.current);
        bufferShowTimerRef.current = null;
      }
      stopStallRecovery();
      perfMark(MARKS.PLAYBACK_CANPLAYTHROUGH);
      patchState({ isBuffering: false, playbackNetworkState: "playing" });
    };

    const onPlay = () => {
      userPausedRef.current = false;

      // Loudness normalization: compute linear gain for this track.
      // gainDb is the dB offset needed to reach –14 LUFS (stored server-side per track).
      // null/undefined falls through to 0 dB = unity gain (no change).
      const newTrack = stateRef.current.currentTrack;
      const gainLinear = Math.pow(10, ((newTrack?.gainDb) || 0) / 20);
      trackGainRef.current = gainLinear;

      // Crossfade handoff: main audio has started; swap gain from bridge to main.
      const wasBridging = crossfadeStateRef.current === "bridging";
      if (wasBridging) {
        crossfadeStateRef.current = "idle";
        const ctx = audioCtxRef.current;
        const mGain = mainGainRef.current;
        const cfGain = crossfadeGainRef.current;
        const nextEl = nextTrackPreloadRef.current;
        if (ctx && mGain && cfGain && ctx.state === "running") {
          const now = ctx.currentTime;
          const HANDOFF = 0.35;
          mGain.gain.cancelScheduledValues(now);
          mGain.gain.setValueAtTime(0, now);
          mGain.gain.linearRampToValueAtTime(gainLinear, now + HANDOFF);
          cfGain.gain.cancelScheduledValues(now);
          cfGain.gain.setValueAtTime(cfGain.gain.value, now);
          cfGain.gain.linearRampToValueAtTime(0, now + HANDOFF);
          if (nextEl) setTimeout(() => { try { if (!nextEl.paused) nextEl.pause(); nextEl.currentTime = 0; } catch {} }, (HANDOFF + 0.1) * 1000);
        } else {
          try { mainGainRef.current?.gain.setValueAtTime(gainLinear, audioCtxRef.current?.currentTime ?? 0); } catch {}
          try { if (nextEl && !nextEl.paused) nextEl.pause(); if (nextEl) nextEl.currentTime = 0; } catch {}
        }
      }

      // Non-crossfade start: apply normalized gain immediately at track boundary.
      if (!wasBridging) {
        const ctx = audioCtxRef.current;
        if (ctx && ctx.state === "running" && mainGainRef.current) {
          try { mainGainRef.current.gain.setValueAtTime(gainLinear, ctx.currentTime); } catch {}
        }
      }

      patchState({
        isPlaying: true,
        error: null,
        hasStarted: true,
        isBuffering: false,
        playbackNetworkState: "playing",
      });
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
      // Begin buffering the next queue item in background.
      void scheduleNextTrackPreload();

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
      stopStallRecovery();
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
            if (!userPausedRef.current) {
              void playAudioIfNotPaused(audio, true, {
                command: PLAYBACK_COMMANDS.RECOVER,
                requestId: activeCommandRef.current?.requestId || null,
                state: stateRef.current,
                context: { source: "onPause_os_suspend" },
              });
            }
          }, 0);
        }
      }
      if (userInitiated) {
        playbackIntentBeforeHideRef.current = false;
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
          authLoading: authLoadingRef.current,
          playbackState: s.playbackState,
          lastEvents: snap?.lastEvents,
        });
      }

      stopKeepAlivePing();
      stopProgressRaf();
      stopPositionSaveTimer();
      patchState({ isPlaying: false, playbackNetworkState: "idle" });
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

      if (viewportPauseRef.current || isInAudioVisualViewportRef.current) {
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
              audio.paused
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
              });
            }
          };
          pendingResumeAfterInterruptRef.current = resumeAfterInterrupt;
          audio.addEventListener("canplay", resumeAfterInterrupt, { once: true });
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
        const fadeStart = PREVIEW_HARD_CAP_SEC - 2;
        const elapsed = audio.currentTime - fadeStart;
        const fadeProgress = Math.min(1, elapsed / 2);
        audio.volume = Math.max(0, 1 - fadeProgress);

        if (audio.currentTime >= PREVIEW_HARD_CAP_SEC) {
          skipPauseInterruptionRef.current = true;
          audio.pause();
          // Do NOT restore audio.volume here — the next playTrackInternal call will set it
          // correctly before play(). Restoring while audio is fading out causes a pop.
          audio.currentTime = PREVIEW_HARD_CAP_SEC;
          syncProgressTime(PREVIEW_HARD_CAP_SEC);
          patchState({
            isPlaying: false,
            playbackState: "ended_preview",
          });
          setPreviewEnded(true);
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
        setSleepTimerEndsAt(null);
        setSleepAfterCurrentTrack(false);
        audio.pause();
        userPausedRef.current = true;
        patchState({ isPlaying: false, playbackState: "paused" });
      }

      // Crossfade trigger: begin fading out current track and fading in pre-buffer.
      const CROSSFADE_SEC = 5;
      if (
        crossfadeStateRef.current === "idle" &&
        !previewOnly &&
        mainGainRef.current &&
        crossfadeGainRef.current &&
        audioCtxRef.current?.state === "running"
      ) {
        const dur = isFinite(audio.duration) ? audio.duration : 0;
        const rem = dur > 0 ? dur - audio.currentTime : 0;
        if (rem > 0 && rem <= CROSSFADE_SEC) {
          const q = queueRef.current;
          const qi = queueIndexRef.current;
          if (q.length > qi + 1 && q[qi + 1]?.src) {
            const nextEl = nextTrackPreloadRef.current;
            if (nextEl && nextEl.src && nextEl.readyState >= 3) {
              crossfadeStateRef.current = "fading";
              const ctx = audioCtxRef.current;
              const now = ctx.currentTime;
              const mGain = mainGainRef.current;
              const cfGain = crossfadeGainRef.current;
              // Loudness-normalize the pre-buffered next track — same formula as onPlay.
              const nextTrackGainLinear = Math.pow(10, (q[qi + 1].gainDb || 0) / 20);
              mGain.gain.cancelScheduledValues(now);
              mGain.gain.setValueAtTime(mGain.gain.value, now);
              mGain.gain.linearRampToValueAtTime(0, now + rem);
              cfGain.gain.cancelScheduledValues(now);
              cfGain.gain.setValueAtTime(0, now);
              cfGain.gain.linearRampToValueAtTime(nextTrackGainLinear, now + rem);
              nextEl.currentTime = 0;
              nextEl.play().catch(() => {
                // Pre-buffer play blocked — restore main gain and abort crossfade silently.
                const t = audioCtxRef.current?.currentTime ?? 0;
                try { mGain.gain.cancelScheduledValues(t); mGain.gain.setValueAtTime(trackGainRef.current, t); } catch {}
                try { cfGain.gain.cancelScheduledValues(t); cfGain.gain.setValueAtTime(0, t); } catch {}
                crossfadeStateRef.current = "idle";
              });
            }
          }
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
        stopProgressRaf();
        stopPositionSaveTimer();
        patchState({ isPlaying: false, playbackState: "ended_preview" });
        syncProgressTime(PREVIEW_HARD_CAP_SEC);
        setPreviewEnded(true);
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
          });
          return;
        }

        // Singles/features mode: stop after this track unless repeat-all is on
        if (stopAfterEachTrackRef.current && repeatMode !== "all") {
          patchState({ isPlaying: false, playbackState: "idle" });
          syncProgressTime(0);
          setPreviewEnded(false);
          if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "none";
          }
          if (track) void updateMediaSession(track, { playing: false });
          return;
        }

        // Sleep after current track
        if (sleepTimerRef.current.afterCurrentTrack) {
          sleepTimerRef.current = { endsAt: null, afterCurrentTrack: false };
          setSleepTimerEndsAt(null);
          setSleepAfterCurrentTrack(false);
          patchState({ isPlaying: false, playbackState: "idle" });
          syncProgressTime(0);
          setPreviewEnded(false);
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
              patchState({ isPlaying: false, playbackState: "idle" });
              syncProgressTime(0);
              setPreviewEnded(false);
              if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
                navigator.mediaSession.playbackState = "none";
              }
              if (track) void updateMediaSession(track, { playing: false });
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
                  patchState({ isPlaying: false, playbackState: "idle" });
                  syncProgressTime(0);
                  setPreviewEnded(false);
                  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
                    navigator.mediaSession.playbackState = "none";
                  }
                  if (track) void updateMediaSession(track, { playing: false });
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
            perfMark(MARKS.PLAYBACK_TAP);
            if (crossfadeStateRef.current === "fading") {
              crossfadeStateRef.current = "bridging";
            } else {
              // Crossfade window missed — hard-cut from preload element to eliminate silence.
              // If the preload element has any buffered data, route its audio to the output
              // immediately so the gap is imperceptible while the main element loads.
              // Skip on iOS: play() on a non-user-gesture element is blocked there, and the
              // async rejection after main-gain=0 causes an audible gap worse than a hard cut.
              const nextEl = nextTrackPreloadRef.current;
              const ctx = audioCtxRef.current;
              const mGain = mainGainRef.current;
              const cfGain = crossfadeGainRef.current;
              if (
                !isLikelyIOS() &&
                nextEl && nextEl.src && nextEl.readyState >= 2 &&
                mGain && cfGain && ctx?.state === "running"
              ) {
                crossfadeStateRef.current = "bridging"; // must be set before playTrackInternal runs
                const t = ctx.currentTime;
                mGain.gain.cancelScheduledValues(t);
                mGain.gain.setValueAtTime(0, t);
                cfGain.gain.cancelScheduledValues(t);
                cfGain.gain.setValueAtTime(1, t);
                nextEl.currentTime = 0;
                nextEl.play().catch(() => {
                  // Preload element blocked — roll back so main element plays normally.
                  crossfadeStateRef.current = "idle";
                  const now = audioCtxRef.current?.currentTime ?? 0;
                  try { mGain.gain.cancelScheduledValues(now); mGain.gain.setValueAtTime(trackGainRef.current, now); } catch {}
                  try { cfGain.gain.cancelScheduledValues(now); cfGain.gain.setValueAtTime(0, now); } catch {}
                });
              }
            }
            void playTrackRef.current?.(nextTrack, { resumeAt: 0, playbackScenario: PLAYBACK_SCENARIOS.QUEUE_AUTO_ADVANCE }).then((ok) => {
              if (ok && csModeRef.current) void applyCSModeToTrackRef.current?.(nextTrack);
            });
            return;
          }
        }

        patchState({ isPlaying: false, playbackState: "idle" });
        syncProgressTime(0);
        setPreviewEnded(false);
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
        }
        if (track) void updateMediaSession(track, { playing: false });
      };

      queueMicrotask(finishEnded);
    };
    const onError = async () => {
      stopStallRecovery();
      if (crossfadeStateRef.current !== "idle") cancelCrossfade();
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
            streamErrorRetriedRef.current = false;
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
      if (slug && (streamMetaRef.current || onLibraryStreamSrc) && !streamErrorRetriedRef.current) {
        streamErrorRetriedRef.current = true;
        patchState({ playbackNetworkState: "retrying_stream", isBuffering: true });
        const retryRequestId = activeCommandRef.current?.requestId;
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
          const canFallbackToPreview = canFallbackStreamToPreview(retryErr, track);
          if (canFallbackToPreview) {
            console.warn("[AudioContext] stream retry denied; falling back to preview", {
              slug: track?.slug || slug,
              trackId: track?.id || slug,
              status: retryErr?.status,
            });
            const previewFallbackSrc =
              getTrackPreviewSrc(track) ||
              track?.metadata?.previewSrc ||
              track?.previewUrl ||
              null;
            if (previewFallbackSrc) {
              skipPauseInterruptionRef.current = true;
              const played = await loadAudioSrcAndPlay(audio, previewFallbackSrc);
              patchState({
                isPlaying: false,
                error: played ? null : "Preview unavailable",
                source: "preview",
                playbackState: played ? "preview_fallback" : "idle",
                playbackNetworkState: played ? "playing" : "error_stream",
                hasStarted: played,
                currentTrack: {
                  ...track,
                  src: previewFallbackSrc,
                  metadata: {
                    ...(track.metadata || {}),
                    access: {
                      ...(track.metadata?.access || {}),
                      previewOnly: true,
                    },
                  },
                },
              });
              return;
            }
          }
          if (retryErr?.code === "ACCESS_DENIED") {
            finalizeStreamSession(meta, { durationSeconds: resumeAt, completed: false });
            streamErrorRetriedRef.current = false;
            skipPauseInterruptionRef.current = true;
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

      const previewFallbackSrc =
        getTrackPreviewSrc(track) ||
        track?.metadata?.previewSrc ||
        track?.previewUrl ||
        null;
      const onPreviewPlayback =
        Boolean(previewFallbackSrc) &&
        (!track?.metadata?.access?.canStream ||
          stateRef.current.source === "preview" ||
          stateRef.current.playbackState === "preview_fallback" ||
          (audio.currentSrc || audio.src || "").includes("/api/media/preview"));

      if (onPreviewPlayback) {
        if (track?.slug) {
          writeAvailabilityCache(
            { slug: track.slug, trackSlug: track.metadata?.trackSlug, albumSlug: track.metadata?.albumSlug },
            { status: "unavailable", reasons: ["missing_preview"], audioKey: null, previewKey: null }
          );
        }
        patchState({
          isPlaying: false,
          error: "Preview unavailable",
          streamRetryable: false,
          isBuffering: false,
          playbackState: "idle",
          playbackNetworkState: "error_stream",
        });
        return;
      }

      if (meta) {
        finalizeStreamSession(meta, {
          completed: false,
          durationSeconds: resumeAt,
        });
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

    const detachPlaybackDevTelemetry = attachPlaybackElementDevTelemetry(audio);

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("emptied", onEmptied);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("canplaythrough", onCanPlayThrough);

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
        } catch {
          /* enumerateDevices unavailable */
        }
      };
      navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    }

    return () => {
      detachPlaybackDevTelemetry();
      window.removeEventListener("online", onOnline);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("emptied", onEmptied);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("canplaythrough", onCanPlayThrough);
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
    patchState,
    updateMediaSession,
    syncPositionState,
    recordLocalListening,
    finalizeStreamSession,
    startPositionSaveTimer,
    stopPositionSaveTimer,
    startProgressRaf,
    stopProgressRaf,
    startKeepAlivePing,
    stopKeepAlivePing,
    startStallRecovery,
    stopStallRecovery,
    tracePlayback,
    readIsAudiblyPlaying,
    emitBackgroundPlaybackDiagnostics,
    emitPhase21AudibleSnapshot,
  ]);

  const applyCsToElement = useCallback((audio, presentation, resumeAt = null) => {
    if (!audio || !presentation) return;
    audio.playbackRate = presentation.playbackRate ?? 1;
    if (typeof audio.preservesPitch !== "undefined") {
      audio.preservesPitch = true;
    }
    csUsingAlternateSrcRef.current = Boolean(presentation.useCsSrc);
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
  }, []);

  const resolveLibraryStreamForTrack = useCallback(async (track, { force = false, signal } = {}) => {
    const slug = parseStreamSlugFromSrc(track.src) || track.slug;
    const trackSlug =
      track.trackSlug ||
      track.metadata?.trackSlug ||
      track.metadata?.track_slug ||
      parseStreamTrackSlugFromSrc(track.src) ||
      null;
    if (!slug || !isLibraryStreamSrc(track.src)) return { track, meta: null };

    patchState({ playbackNetworkState: "loading_stream" });
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
    streamMetaRef.current = meta;
    return {
      track: { ...track, src: data.url },
      meta,
    };
  }, [patchState]);

  // Pre-buffer the next queue item while the current track is playing.
  // CDN tracks: load bytes directly into a hidden Audio element.
  // Library streams: pre-fetch the signed URL so the swap is instant.
  const scheduleNextTrackPreload = useCallback(async () => {
    // Adaptive preload: skip on slow connections (2G/slow-2G) — bandwidth is too scarce
    // to buffer the next track without starving the current one. Also skip while the
    // current track is still buffering for the same reason.
    if (typeof navigator !== "undefined") {
      const effectiveType = navigator.connection?.effectiveType;
      if (effectiveType === "slow-2g" || effectiveType === "2g") return;
    }
    if (stateRef.current.isBuffering) return;

    const queue = queueRef.current;
    const idx = queueIndexRef.current;
    const nextIdx = idx + 1;
    if (nextIdx >= queue.length) return;
    const next = queue[nextIdx];
    if (!next?.src) return;
    const preloadEl = nextTrackPreloadRef.current;
    if (!preloadEl) return;

    const kind = classifySourceUrl(next.src);

    if (isDirectlyBufferable(kind)) {
      // REDIRECT-kind hits /api/library/stream?redirect=1 which fires after() session
      // bookkeeping for a track the user hasn't played — skip to avoid spurious events.
      // The redirect endpoint serves from Cloudflare CDN so the first bytes are instant anyway.
      if (kind === SOURCE_KIND.REDIRECT) return;
      const normalized = normalizePlaybackSrc(next.src);
      if (normalized && preloadEl.src !== normalized) {
        preloadEl.src = normalized;
        preloadEl.load();
      }
    } else if (requiresSignedUrlFetch(kind)) {
      const slug = parseStreamSlugFromSrc(next.src) || next.slug;
      if (!slug) return;
      // Album/EP tracks carry both slug (release) and trackSlug (individual track).
      // Must pass trackSlug to the stream endpoint and use it as part of the cache key,
      // otherwise all tracks in a release share one cache entry and the wrong audio loads.
      const trackSlug = parseStreamTrackSlugFromSrc(next.src) || next.metadata?.trackSlug || null;
      const cacheKey = trackSlug ? `${slug}:${trackSlug}` : slug;
      const cached = nextTrackSignedUrlCacheRef.current[cacheKey];
      if (cached && Date.now() - cached.fetchedAt < 3_000_000) return;
      try {
        const data = await fetchLibraryStream(slug, { force: false, trackSlug });
        if (data?.url) {
          nextTrackSignedUrlCacheRef.current[cacheKey] = {
            url: data.url,
            fetchedAt: Date.now(),
          };
          // Evict oldest when cache exceeds 20 entries to prevent unbounded growth.
          const cacheEntries = Object.entries(nextTrackSignedUrlCacheRef.current);
          if (cacheEntries.length > 20) {
            let oldestKey = cacheEntries[0][0];
            let oldestAt = cacheEntries[0][1].fetchedAt;
            for (let i = 1; i < cacheEntries.length; i++) {
              if (cacheEntries[i][1].fetchedAt < oldestAt) {
                oldestAt = cacheEntries[i][1].fetchedAt;
                oldestKey = cacheEntries[i][0];
              }
            }
            delete nextTrackSignedUrlCacheRef.current[oldestKey];
          }
          const normalized = normalizePlaybackSrc(data.url);
          if (normalized && preloadEl.src !== normalized) {
            preloadEl.src = normalized;
            preloadEl.load();
          }
        }
      } catch {
        // Non-fatal — next track fetches fresh on demand
      }
    }

    // 2nd-ahead passive preload: buffer index+2 CDN preview for deeper gapless coverage.
    const nnIdx = nextIdx + 1;
    if (nnIdx < queue.length && nextNextTrackPreloadRef.current) {
      const nn = queue[nnIdx];
      const nnSrc = nn?.src;
      if (nnSrc) {
        const nnKind = classifySourceUrl(nnSrc);
        if (isDirectlyBufferable(nnKind)) {
          const nnNorm = normalizePlaybackSrc(nnSrc);
          const nnEl = nextNextTrackPreloadRef.current;
          if (nnNorm && nnEl.src !== nnNorm) {
            nnEl.src = nnNorm;
            nnEl.load();
          }
        }
      }
    }
  }, []);

  const unlockAudioFromGesture = useCallback(async (audioEl) => {
    if (!audioEl || !audioEl.paused) return;
    try {
      const vol = audioEl.volume;
      audioEl.volume = 0;
      await audioEl.play();
      audioEl.pause();
      audioEl.volume = vol;
    } catch {
      /* unlock failure is non-fatal */
    }
  }, []);

  const cancelCrossfade = useCallback(() => {
    if (crossfadeStateRef.current === "idle") return;
    crossfadeStateRef.current = "idle";
    const nextEl = nextTrackPreloadRef.current;
    try { if (nextEl && !nextEl.paused) nextEl.pause(); } catch {}
    try { if (nextEl) nextEl.currentTime = 0; } catch {}
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== "closed") {
      const now = ctx.currentTime;
      try { mainGainRef.current?.gain.cancelScheduledValues(now); mainGainRef.current?.gain.setValueAtTime(trackGainRef.current, now); } catch {}
      try { crossfadeGainRef.current?.gain.cancelScheduledValues(now); crossfadeGainRef.current?.gain.setValueAtTime(0, now); } catch {}
    }
  }, []);

  const playTrackInternal = useCallback(async (track, options = {}) => {
    logDirectInternalCallViolation("playTrackInternal");
    perfMark(MARKS.PLAYBACK_REQUEST);
    const requestId = playRequestIdRef.current + 1;
    playRequestIdRef.current = requestId;
    if (crossfadeStateRef.current !== "bridging") cancelCrossfade();
    if (!options.preserveActiveStream && activeStreamAbortRef.current) {
      logStreamLifecycle("abort", { source: "playTrackInternal", slug: track?.slug });
      activeStreamAbortRef.current.abort();
    }
    const streamAbortController = new AbortController();
    activeStreamAbortRef.current = streamAbortController;
    const audioEl = audioRef.current;
    // For redirect fast-path (same-origin proxy → S3), start the browser fetch
    // immediately so network time overlaps with Web Audio setup.
    // Also pauses the current track, which eliminates the 300ms fade-out below.
    if (isLibraryStreamRedirectSrc(track?.src) && audioEl) {
      const earlyNorm = normalizePlaybackSrc(track.src);
      if (earlyNorm && normalizePlaybackSrc(audioEl.src || "") !== earlyNorm) {
        skipPauseInterruptionRef.current = true;
        audioEl.pause();
        audioEl.src = track.src;
        audioEl.load();
      }
    } else if (track?.src && audioEl) {
      // CDN/Preview fast-path: early src assignment so the browser fetch overlaps
      // with Web Audio setup, mirroring the redirect fast-path above.
      const srcKind = classifySourceUrl(track.src);
      if (isDirectlyBufferable(srcKind)) {
        const earlyNorm = normalizePlaybackSrc(track.src);
        if (earlyNorm && normalizePlaybackSrc(audioEl.src || "") !== earlyNorm) {
          if (!audioEl.paused) {
            skipPauseInterruptionRef.current = true;
            audioEl.pause();
          }
          audioEl.src = track.src;
          audioEl.load();
        }
      }
    }
    if (audioEl?.paused && !sessionUnlockedRef.current) {
      await unlockAudioFromGesture(audioEl);
      // Unlock the crossfade pre-buffer element at the same time so iOS allows
      // play() on it when the crossfade triggers (no second user gesture available).
      const nextEl = nextTrackPreloadRef.current;
      if (nextEl) await unlockAudioFromGesture(nextEl);
    }

    initWebAudio();
    await resumeWebAudioContextIfSuspended(audioCtxRef, "playTrack-entry");
    recordAudioContextState(audioCtxRef.current, "playTrack-resume");
    if (!(await ensureWebAudioRunning(audioCtxRef))) {
      const lightOk = await attemptLightweightPlaybackResume("playTrack_ctx_suspended");
      await resumeWebAudioContextIfSuspended(audioCtxRef, "playTrack-after-light");
      if (!(await ensureWebAudioRunning(audioCtxRef))) {
        const transportIntact = getPlaybackTransportHealth().intact;
        if (!transportIntact) {
          await playbackStateMachine.transition(
            PLAYBACK_ORCHESTRATION_EVENTS.RECOVERY_REQUESTED,
            { reason: "audio_context_suspended", resumeAfter: true }
          );
        }
        reportPlaybackDiagnostic({
          level: "warn",
          code: "WEB_AUDIO_SUSPENDED_BLOCKED_PLAY",
          command: PLAYBACK_COMMANDS.PLAY_TRACK,
          requestId,
          state: stateRef.current,
          context: {
            lifecycleRecoveryLock: lifecycleRecoveryLockRef.current,
            lifecycleSuppressed: isLifecycleRecoverySuppressed("audio_context_suspended"),
            lightResumeOk: lightOk,
            transportIntact,
          },
        });
        patchState({
          isPlaying: false,
          error: "Tap play to continue.",
          playbackState: "paused",
          playbackNetworkState: transportIntact ? "idle" : "recovering",
        });
        return false;
      }
    }
    setPreviewEnded(false);
    if (!track || (typeof track !== "object")) {
      console.error("[AudioContext] playTrack: invalid track", track);
      return false;
    }
    const normalized = normalizeTrack(track);
    lastUserActionRef.current = "track_change";
    clearViewportResume();
    tracePlayback("trackChange", "playTrackInternal", {
      requestId,
      slug: normalized.slug,
      trackId: normalized.id,
    });
    if (!normalized.slug && !normalized.id && !normalized.src) {
      console.error("[AudioContext] playTrack: track missing identity and src", track);
      return false;
    }
    const presentation = resolvePlaybackPresentation(normalized, csModeRef.current, csUsingAlternateSrcRef.current);
    let nextTrack = {
      ...normalized,
      title: presentation.title,
      src: presentation.src,
      cover: presentation.cover,
    };

    const coverToPreload = nextTrack.cover || nextTrack.baseCover;
    const coverPreloadOptions = { coverArtType: nextTrack.coverArtType };
    const scheduleCoverPreload = () => {
      preloadCoverImage(coverToPreload, coverPreloadOptions);
    };
    const isMobileViewport =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(max-width: 768px)")?.matches ||
        /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || ""));

    perfMark(MARKS.AUDIO_START_LATENCY_START);
    logPlayback("play_track", { trackId: nextTrack.id, source: nextTrack.source });
    const audio = audioRef.current;
    if (!audio) {
      console.error("[AudioContext] playTrack: audio element not mounted");
      patchState({
        currentTrackId: nextTrack.id || null,
        currentTrack: nextTrack,
        source: nextTrack.source,
        isPlaying: false,
        error: "Audio player unavailable.",
        hasStarted: false,
        playbackState: "idle",
      });
      return false;
    }
    if (!nextTrack.src) {
      console.error("[AudioContext] playTrack: no playback src", {
        slug: nextTrack.slug,
        id: nextTrack.id,
      });
      patchState({
        currentTrackId: nextTrack.id || null,
        currentTrack: nextTrack,
        source: nextTrack.source,
        isPlaying: false,
        error: "Audio source unavailable.",
        hasStarted: false,
        playbackState: "idle",
      });
      return false;
    }

    if (!isMobileViewport && coverToPreload) {
      scheduleCoverPreload();
    } else if (isMobileViewport && coverToPreload) {
      audio.addEventListener("canplay", scheduleCoverPreload, { once: true });
    }

    streamErrorRetriedRef.current = false;

    const streamSlug = parseStreamSlugFromSrc(nextTrack.src) || nextTrack.slug;
    const usesLibraryStream = isLibraryStreamSrc(nextTrack.src);
    const redirectFastPath = isLibraryStreamRedirectSrc(nextTrack.src);
    const previewSrc = getTrackPreviewSrc(nextTrack);

    let syncSrc = nextTrack.src;
    let backgroundStreamResolve = false;

    const applyStreamResolveError = (err) => {
      if (requestId !== playRequestIdRef.current) return;
      if (err?.name === "AbortError") return;
      const canFallbackToPreview = canFallbackStreamToPreview(err, nextTrack);
      if (canFallbackToPreview) {
        console.warn("[AudioContext] stream fetch denied; falling back to preview", {
          slug: nextTrack.slug,
          trackId: nextTrack.id,
          status: err?.status,
        });
        const previewFallbackSrc =
          getTrackPreviewSrc(nextTrack) ||
          nextTrack?.metadata?.previewSrc ||
          nextTrack?.previewUrl ||
          null;
        if (previewFallbackSrc) {
          skipPauseInterruptionRef.current = true;
          void loadAudioSrcAndPlay(audio, previewFallbackSrc).then((played) => {
            if (requestId !== playRequestIdRef.current) return;
            patchState({
              isPlaying: false,
              error: played ? null : "Preview unavailable",
              source: "preview",
              playbackState: played ? "preview_fallback" : "idle",
              playbackNetworkState: played ? "playing" : "error_stream",
              hasStarted: played,
              currentTrack: {
                ...nextTrack,
                src: previewFallbackSrc,
                metadata: {
                  ...(nextTrack.metadata || {}),
                  access: {
                    ...(nextTrack.metadata?.access || {}),
                    previewOnly: true,
                  },
                },
              },
            });
          });
          return;
        }
      }
      if (err?.code === "ACCESS_DENIED") {
        const prevMeta = streamMetaRef.current;
        if (prevMeta) finalizeStreamSession(prevMeta, { completed: false, durationSeconds: audio.currentTime || 0 });
        streamErrorRetriedRef.current = false;
        skipPauseInterruptionRef.current = true;
        audio.pause();
        patchState({
          isPlaying: false,
          accessDenied: true,
          streamRetryable: false,
          error: "Access unavailable",
          hasStarted: false,
          playbackNetworkState: "error_stream",
          currentTrack: nextTrack,
          currentTrackId: nextTrack.id,
        });
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
        }
        return;
      }
      if (err?.code === "CONCURRENT_STREAM") {
        patchState({
          streamConflict: {
            slug: streamSlug,
            sessionId: err.sessionId || null,
            track: nextTrack,
            resumeAt: options.resumeAt,
          },
          hasStarted: false,
          currentTrack: nextTrack,
          currentTrackId: nextTrack.id,
        });
        return;
      }
      patchState({
        isPlaying: false,
        error: "Stream unavailable — tap to retry",
        streamRetryable: true,
        hasStarted: false,
        playbackNetworkState: "error_stream",
        currentTrack: nextTrack,
        currentTrackId: nextTrack.id,
      });
    };

    if (usesLibraryStream && streamSlug) {
      const entitledFullStream = Boolean(nextTrack.metadata?.access?.canStream);
      if (previewSrc && !entitledFullStream) {
        syncSrc = previewSrc;
      } else if (entitledFullStream) {
        if (redirectFastPath) {
          // The redirect URL is the playable proxy — auth and entitlement are
          // re-validated server-side per request. Start audio immediately; session
          // creation resolves in the background.
          syncSrc = nextTrack.src;
          backgroundStreamResolve = true;
          // Seed slug-only meta so finalizeStreamSession can send analytics via
          // the server-side slug-based fallback (redirect plays never get a streamEventId).
          if (!streamMetaRef.current?.streamEventId && !streamMetaRef.current?.sessionId) {
            streamMetaRef.current = { slug: streamSlug };
          }
        } else {
          try {
            const resolved = await resolveLibraryStreamForTrack(nextTrack, {
              force: options.forceStream,
              signal: streamAbortController.signal,
            });
            const signedUrl = resolved?.track?.src;
            if (signedUrl) {
              syncSrc = signedUrl;
              backgroundStreamResolve = false;
            } else if (isLibraryStreamRedirectSrc(nextTrack.src)) {
              syncSrc = nextTrack.src;
              backgroundStreamResolve = true;
            }
          } catch (err) {
            if (requestId !== playRequestIdRef.current) return false;
            if (err?.name === "AbortError") return false;
            if (isLibraryStreamRedirectSrc(nextTrack.src)) {
              syncSrc = nextTrack.src;
              backgroundStreamResolve = true;
            } else {
              applyStreamResolveError(err);
              return false;
            }
          }
        }
      } else if (redirectFastPath) {
        syncSrc = nextTrack.src;
      }
    }

    const swapToSignedStream = async (resolved) => {
      if (requestId !== playRequestIdRef.current) return;
      if (crossfadeStateRef.current !== "idle") cancelCrossfade();
      const signedUrl = resolved.track?.src;
      if (!signedUrl || signedUrl === syncSrc) return;
      const resumeAt = audio.currentTime || 0;
      const wasPlaying = stateRef.current.isPlaying && !audio.paused;
      skipPauseInterruptionRef.current = true;
      if (isPlaybackTraceEnabled()) {
        logStreamLifecycle("signed-swap-start", {
          source: "swapToSignedStream",
          slug: streamSlug,
          resumeAt,
          wasPlaying,
        });
      }
      const preloadEl = streamSwapPreloadRef.current;
      if (preloadEl) {
        await warmupSignedStreamPreload(preloadEl, signedUrl, {
          signal: streamAbortController.signal,
        });
      }
      if (wasPlaying) {
        patchTransport({ isBuffering: true });
      } else {
        patchTransport({ playbackNetworkState: "loading_stream" });
      }
      await waitAudioSrcReady(audio, signedUrl, { signal: streamAbortController.signal });
      const applySwapSeek = () => {
        clearTimeout(applySwapSeekTimeout);
        if (resumeAt > 0 && isFinite(audio.duration)) {
          audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
        }
      };
      if (isFinite(audio.duration) && audio.duration > 0) {
        applySwapSeek();
      } else {
        audio.addEventListener("loadedmetadata", applySwapSeek, { once: true });
        const applySwapSeekTimeout = setTimeout(
          () => audio.removeEventListener("loadedmetadata", applySwapSeek),
          5000
        );
      }
      if (wasPlaying && audio.paused) {
        await playAudioIfNotPaused(audio, true, {
          command: PLAYBACK_COMMANDS.PLAY_TRACK,
          requestId,
          state: stateRef.current,
          context: { source: "signed_stream_swap" },
        });
      }
      const liveTrack = stateRef.current.currentTrack;
      if (!liveTrack || !isSamePlaybackTrack(liveTrack, nextTrack)) return;
      stateRef.current = {
        ...stateRef.current,
        currentTrack: {
          ...liveTrack,
          src: signedUrl,
          metadata: {
            ...(liveTrack.metadata || {}),
            access: {
              ...(liveTrack.metadata?.access || {}),
              previewOnly: false,
              canStream: true,
            },
          },
        },
      };
      patchTransport({
        playbackNetworkState: wasPlaying && !audio.paused ? "playing" : "idle",
        isBuffering: false,
      });
      notifyMediaEngineBridge();
      if (isPlaybackTraceEnabled()) {
        logStreamLifecycle("signed-swap-end", {
          source: "swapToSignedStream",
          slug: streamSlug,
          paused: audio.paused,
        });
      }
    };

    if (backgroundStreamResolve && streamSlug && !redirectFastPath) {
      void resolveLibraryStreamForTrack(nextTrack, {
        force: options.forceStream,
        signal: streamAbortController.signal,
      })
        .then(async (resolved) => {
          const signedUrl = resolved?.track?.src;
          if (signedUrl && signedUrl !== syncSrc && streamSwapPreloadRef.current) {
            await warmupSignedStreamPreload(streamSwapPreloadRef.current, signedUrl, {
              signal: streamAbortController.signal,
            });
          }
          return swapToSignedStream(resolved);
        })
        .catch(redirectFastPath ? () => {} : applyStreamResolveError);
    }

    const userId = listeningUserIdRef.current;
    const previousLastPlayedSlug = lastPlayedSlugRef.current;
    const playedDifferentSince =
      previousLastPlayedSlug != null && previousLastPlayedSlug !== nextTrack.slug;
    if (playedDifferentSince && userId) {
      clearPlaybackPosition(userId, previousLastPlayedSlug);
    }
    lastPlayedSlugRef.current = nextTrack.slug;

    let resumeAt =
      options.resumeAt != null && options.resumeAt > RESTORE_MIN_POSITION_SEC
        ? options.resumeAt
        : null;
    if (options.resumeAt === 0) {
      resumeAt = null;
      if (userId && streamSlug) clearPlaybackPosition(userId, streamSlug);
    }
    if (playedDifferentSince && userId && streamSlug) {
      clearPlaybackPosition(userId, streamSlug);
    }
    if (!resumeAt && !playedDifferentSince && userId && streamSlug) {
      const saved = getSavedPlaybackPosition(userId, streamSlug);
      if (saved?.positionSeconds > RESTORE_MIN_POSITION_SEC) {
        const clamped = clampRestorePosition(saved.positionSeconds, saved.durationSeconds);
        if (clamped != null) {
          resumeAt = clamped;
        } else {
          clearPlaybackPosition(userId, streamSlug);
        }
      }
    }
    if (!resumeAt && !playedDifferentSince && !authLoadingRef.current && entitlementAccountStateRef.current?.mediaProgress?.length) {
      const savedProgress = entitlementAccountStateRef.current.mediaProgress.find(
        (p) => p.product_slug === nextTrack.slug && !p.completed
      );
      if (savedProgress?.position_seconds > RESTORE_MIN_POSITION_SEC) {
        const clamped = clampRestorePosition(
          savedProgress.position_seconds,
          savedProgress.duration_seconds
        );
        if (clamped != null) resumeAt = clamped;
      }
    }
    if (resumeAt != null && isFinite(audio.duration) && audio.duration > 0) {
      resumeAt = clampRestorePosition(resumeAt, audio.duration);
    }

    const prevTrack = stateRef.current.currentTrack;
    const sameIdentity = isSamePlaybackTrack(prevTrack, nextTrack);
    const isSameTrack = sameIdentity;
    const isReplay = isSameTrack && audio.ended;
    const previousTrack = stateRef.current.currentTrack;

    if (!sameIdentity) {
      clearContinuityFreeze("playTrackInternal");
    }

    if (isReplay) {
      audio.currentTime = 0;
      pendingSeekRef.current = null;
      patchState({ playbackState: null });
      syncProgressTime(0);
    }

    if (
      previousTrack &&
      !isSamePlaybackTrack(previousTrack, nextTrack) &&
      stateRef.current.hasStarted &&
      !isSameTrack
    ) {
      const prevMeta = streamMetaRef.current;
      if (prevMeta) {
        finalizeStreamSession(prevMeta, {
          completed: false,
          durationSeconds: audio.currentTime || 0,
        });
      }
      recordLocalListening(previousTrack, {
        positionSeconds: audio.currentTime || 0,
        durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
        completed: true,
      });
      listeningProgressRef.current = { slug: null, recorded30s: false };
    }

    patchTransport({ playbackNetworkState: "loading_stream" });
    if (isUiHydrationTraceEnabled()) {
      logUiHydrationTrace("PLAYBACK_FIRST_MUTATION", {
        slug: nextTrack.slug ?? null,
        trackId: nextTrack.id ?? null,
        source: "playTrackInternal",
        phase: "p12-track-load",
      });
    }
    patchState({
      currentTrackId: nextTrack.id,
      currentTrack: { ...nextTrack, src: syncSrc },
      source: nextTrack.source,
      error: null,
      accessDenied: false,
      streamRetryable: false,
      streamConflict: null,
      hasStarted: isSameTrack ? stateRef.current.hasStarted : false,
      csTrack: csModeRef.current ? normalized : null,
      playbackState: isSameTrack ? stateRef.current.playbackState : "loading",
    });

    preloadCsAssets(normalized, { csImgRef, csVidRef, csAudioRef });

    try {
      if (!isSameTrack) {
        // Only set the skip flag and pause if not already paused (e.g. from early fast-path
        // src assignment). audio.pause() on an already-paused element is a no-op and won't
        // fire onPause, so the flag would leak into the playing phase and mask real OS pauses.
        if (!audio.paused) {
          skipPauseInterruptionRef.current = true;
          audio.pause();
        }
        // Set volume while the element is paused — before waitAudioSrcReady and play().
        // Setting audio.volume after play() causes a digital pop when the volume snaps
        // from a preview-fade value. Volume = 0 for first-listen; swell starts AFTER play().
        if (swellIntervalRef.current) {
          cancelAnimationFrame(swellIntervalRef.current);
          swellIntervalRef.current = null;
        }
        const isFirst = isFirstListen(nextTrack.slug);
        if (isFirst) {
          markListened(nextTrack.slug);
          audio.volume = 0;
        } else {
          audio.volume = 1;
        }
        spuriousEndedGuardRef.current = Date.now() + SPURIOUS_ENDED_GUARD_MS;
        await waitAudioSrcReady(audio, syncSrc, { signal: streamAbortController.signal });
        patchState({ hasStarted: true, playbackState: "ready" });
        const startedPlay = await playAudioIfNotPaused(audio, true, {
          command: PLAYBACK_COMMANDS.PLAY_TRACK,
          requestId,
          state: stateRef.current,
          context: { source: nextTrack.source },
        });
        if (!startedPlay) {
          patchState({
            isPlaying: false,
            error: "Audio playback failed. Try again in a moment.",
            playbackState: "paused",
            playbackNetworkState: "error_stream",
          });
          void updateMediaSession({ ...nextTrack, src: syncSrc }, { playing: false });
          return false;
        }
        // While the preview plays, race-prefetch the signed stream URL + warm the
        // preload element so the upgrade swap 2s later hits browser cache (near-zero gap).
        if (!isSameTrack && previewSrc && syncSrc === previewSrc &&
            nextTrack.metadata?.access?.canStream && !nextTrack.metadata?.access?.previewOnly &&
            nextTrack.slug) {
          void (async () => {
            try {
              if (streamAbortController.signal.aborted) return;
              const data = await fetchLibraryStream(nextTrack.slug, {
                force: false,
                trackSlug: nextTrack.metadata?.trackSlug || nextTrack.trackSlug || null,
                signal: streamAbortController.signal,
              });
              if (!data?.url || streamAbortController.signal.aborted) return;
              streamMetaRef.current = {
                slug: nextTrack.slug,
                url: data.url,
                fetchedAt: Date.now(),
                expiresIn: data.expiresIn || 3600,
                streamEventId: data.streamEventId || null,
                sessionId: data.sessionId || null,
              };
              const preloadEl = streamSwapPreloadRef.current;
              if (preloadEl) {
                void warmupSignedStreamPreload(preloadEl, data.url, { signal: streamAbortController.signal });
              }
            } catch {
              // Non-fatal — upgradeToFullStream fetches on its own if this race loses
            }
          })();
        }
        // Start swell AFTER play() confirms audio is actually outputting.
        // Using requestAnimationFrame for 60fps smoothness; time-based so frame drops
        // don't stall the ramp (important for iOS which can drop frames on wake).
        if (isFirst) {
          const SWELL_DURATION_MS = 500;
          const swellStart = performance.now();
          const swellStep = () => {
            const t = Math.min(1, (performance.now() - swellStart) / SWELL_DURATION_MS);
            audio.volume = t;
            if (t < 1) {
              swellIntervalRef.current = requestAnimationFrame(swellStep);
            } else {
              swellIntervalRef.current = null;
            }
          };
          swellIntervalRef.current = requestAnimationFrame(swellStep);
        }
        pendingSeekRef.current = resumeAt;
      } else {
        if (!audio.paused) {
          const audible = isAudioActuallyAudible({
            audio,
            webAudioContext: audioCtxRef.current,
            sampleRef: audibilitySampleRef,
          });
          patchState({
            hasStarted: true,
            playbackState: audible ? "playing" : "ready",
            isPlaying: audible,
            error: null,
          });
          applyCsToElement(audio, presentation, pendingSeekRef.current || null);
          return audible;
        }
        if (resumeAt) {
          const dur = isFinite(audio.duration) ? audio.duration : 0;
          const safe = dur > 0 ? clampRestorePosition(resumeAt, dur) : resumeAt;
          if (safe != null && Math.abs(audio.currentTime - safe) > 2) {
            audio.currentTime = safe;
          } else if (safe == null && userId && streamSlug) {
            clearPlaybackPosition(userId, streamSlug);
          }
        }
      }

      applyCsToElement(audio, presentation, pendingSeekRef.current || null);
      if (requestId !== playRequestIdRef.current) return false;

      if (pendingSeekRef.current) {
        const pendingSnapshot = pendingSeekRef.current;
        const applyPendingSeek = () => {
          clearTimeout(pendingSeekTimeoutRef);
          if (pendingSnapshot != null && isFinite(audio.duration) && audio.duration > 0) {
            const safe = clampRestorePosition(pendingSnapshot, audio.duration);
            if (safe != null) {
              audio.currentTime = safe;
            } else if (listeningUserIdRef.current && nextTrack.slug) {
              clearPlaybackPosition(listeningUserIdRef.current, nextTrack.slug);
            }
            spuriousEndedGuardRef.current = Date.now() + SPURIOUS_ENDED_GUARD_MS;
          }
          pendingSeekRef.current = null;
        };
        audio.addEventListener("loadedmetadata", applyPendingSeek, { once: true });
        const pendingSeekTimeoutRef = setTimeout(
          () => audio.removeEventListener("loadedmetadata", applyPendingSeek),
          5000
        );
      }

      // Same-track resume: ensure volume is 1 (a stale preview fade may have left it < 1).
      // New-track path already applied volume/swell above before waitAudioSrcReady.
      if (isSameTrack) {
        if (swellIntervalRef.current) {
          cancelAnimationFrame(swellIntervalRef.current);
          swellIntervalRef.current = null;
        }
        audio.volume = 1;
      }

      if (isSameTrack) {
        const played = await playAudioIfNotPaused(audio, true, {
          command: PLAYBACK_COMMANDS.PLAY_TRACK,
          requestId,
          state: stateRef.current,
          context: { source: nextTrack.source, sameTrack: true },
        });
        if (!played) {
          patchState({
            isPlaying: false,
            error: "Audio playback failed. Try again in a moment.",
            playbackState: "paused",
            playbackNetworkState: "error_stream",
          });
          void updateMediaSession({ ...nextTrack, src: syncSrc }, { playing: false });
          return false;
        }
      }
      void updateMediaSession({ ...nextTrack, src: syncSrc }, { playing: !audio.paused });

      if (isReplay) {
        sendControlSystemPlaybackEvent(nextTrack, "replay", {
          mediaType: "audio",
          positionSeconds: 0,
          durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
        });
      }
      patchState({
        error: null,
        hasStarted: true,
        playbackState: audio.paused ? "paused" : "ready",
      });
      return !audio.paused;
    } catch (err) {
      // Superseded by a newer navigation command — the stream abort is intentional,
      // not an error. Exit silently so the new command can start without any error state.
      if (err?.code === "AUDIO_SRC_ABORTED") {
        if (crossfadeStateRef.current !== "idle") cancelCrossfade();
        return false;
      }
      const previewFallbackSrc =
        getTrackPreviewSrc(nextTrack) ||
        nextTrack?.metadata?.previewSrc ||
        nextTrack?.previewUrl ||
        null;
      const failedLibraryStream =
        isLibraryStreamSrc(syncSrc) || isLibraryStreamSrc(nextTrack?.src || "");
      if (failedLibraryStream && previewFallbackSrc) {
        console.warn("[AudioContext] library stream load failed; falling back to preview", {
          slug: nextTrack?.slug,
          message: err?.message || String(err),
        });
        logStreamLifecycle("preview-fallback", {
          source: "playTrackInternal",
          slug: nextTrack?.slug,
        });
        try {
          skipPauseInterruptionRef.current = true;
          const played = await loadAudioSrcAndPlay(audio, previewFallbackSrc, {
            signal: streamAbortController.signal,
          });
          patchState({
            isPlaying: false,
            error: played ? null : "Preview unavailable",
            source: "preview",
            playbackState: played ? "preview_fallback" : "idle",
            playbackNetworkState: played ? "playing" : "error_stream",
            hasStarted: played,
            currentTrack: {
              ...nextTrack,
              src: previewFallbackSrc,
              metadata: {
                ...(nextTrack.metadata || {}),
                access: {
                  ...(nextTrack.metadata?.access || {}),
                  previewOnly: true,
                  canStream: false,
                },
              },
            },
          });
          return played;
        } catch (previewErr) {
          console.error("[AudioContext] preview fallback failed", {
            slug: nextTrack?.slug,
            message: previewErr?.message || String(previewErr),
          });
          if (nextTrack?.slug) {
            writeAvailabilityCache(
              {
                slug: nextTrack.slug,
                trackSlug: nextTrack.metadata?.trackSlug,
                albumSlug: nextTrack.metadata?.albumSlug,
              },
              { status: "unavailable", reasons: ["missing_preview"], audioKey: null, previewKey: null }
            );
          }
          patchState({
            isPlaying: false,
            error: "Preview unavailable",
            streamRetryable: false,
            hasStarted: false,
            playbackState: "idle",
            playbackNetworkState: "error_stream",
          });
          void updateMediaSession(nextTrack, { playing: false });
          return false;
        }
      }
      // Always cancel crossfade on failure — if we were in "bridging" state,
      // mainGainRef.gain was set to 0 to hide the gap; leaving it there makes
      // subsequent tracks inaudible until the user seeks or seeks manually.
      cancelCrossfade();
      console.error("[AudioContext] playTrack failed", {
        message: err?.message || String(err),
        code: err?.code || null,
        slug: nextTrack?.slug || null,
      });
      patchState({
        isPlaying: false,
        error: "Audio playback failed. Try again in a moment.",
        playbackState: "paused",
        playbackNetworkState: "error_stream",
      });
      void updateMediaSession(nextTrack, { playing: false });
      return false;
    }
  }, [
    patchState,
    updateMediaSession,
    applyCsToElement,
    recordLocalListening,
    resolveLibraryStreamForTrack,
    finalizeStreamSession,
    initWebAudio,
    unlockAudioFromGesture,
    cancelCrossfade,
    tracePlayback,
    logDirectInternalCallViolation,
    attemptLightweightPlaybackResume,
    getPlaybackTransportHealth,
    isLifecycleRecoverySuppressed,
    clearContinuityFreeze,
  ]);

  const upgradeToFullStream = useCallback(async () => {
    logDirectInternalCallViolation("upgradeToFullStream");
    tracePlayback("upgradeToFullStream", "upgradeToFullStream", {
      slug: stateRef.current.currentTrack?.slug ?? null,
    });
    logStateChurn("upgradeToFullStream", {
      source: "AudioContext",
      reason: "invoke",
      slug: stateRef.current.currentTrack?.slug ?? null,
    });
    const audio = audioRef.current;
    const track = stateRef.current.currentTrack;
    if (!audio || !track?.slug) return false;
    const serverUserId = entitlementAccountStateRef.current?.user?.id;
    const clientUserId = listeningUserIdRef.current;
    if (!serverUserId || !clientUserId || serverUserId !== clientUserId) {
      return false;
    }
    const previewSrc = getTrackPreviewSrc(track);
    const currentPlaybackSrc = normalizePlaybackSrc(audio.currentSrc || audio.src || "");
    const signedUrl = streamMetaRef.current?.url
      ? normalizePlaybackSrc(streamMetaRef.current.url)
      : "";
    const stillOnPreview =
      Boolean(previewSrc) &&
      (currentPlaybackSrc === normalizePlaybackSrc(previewSrc) ||
        (Boolean(track.metadata?.access?.previewOnly) &&
          !isLibraryStreamSrc(currentPlaybackSrc) &&
          !signedUrl));

    if (!track.metadata?.access?.previewOnly && signedUrl && currentPlaybackSrc === signedUrl) {
      return true;
    }
    if (!stillOnPreview && signedUrl && currentPlaybackSrc === signedUrl) {
      return true;
    }
    if (!stillOnPreview && !track.metadata?.access?.previewOnly && isLibraryStreamSrc(currentPlaybackSrc)) {
      return true;
    }

    const libraryTrack = {
      ...track,
      src: `/api/library/stream?slug=${encodeURIComponent(track.slug)}&redirect=1`,
    };

    patchState({ playbackNetworkState: "loading_stream" });
    try {
      const cachedMeta = streamMetaRef.current;
      const useCachedUrl = cachedMeta?.slug === track.slug && cachedMeta?.url && !streamUrlNeedsRefresh(cachedMeta);
      const resolved = useCachedUrl
        ? { track: { ...libraryTrack, src: cachedMeta.url }, meta: cachedMeta }
        : await resolveLibraryStreamForTrack(libraryTrack, { force: false, signal: activeStreamAbortRef.current?.signal });
      const nextSrc = normalizePlaybackSrc(resolved.track.src);
      if (nextSrc && nextSrc === currentPlaybackSrc) {
        patchState({
          currentTrack: {
            ...track,
            src: resolved.track.src,
            metadata: {
              ...track.metadata,
              access: {
                ...(track.metadata?.access || {}),
                previewOnly: false,
                canStream: true,
              },
            },
          },
          playbackState: audio.paused ? "paused" : "playing",
          error: null,
          accessDenied: false,
        });
        return true;
      }
      const preloadEl = streamSwapPreloadRef.current;
      if (preloadEl) {
        await warmupSignedStreamPreload(preloadEl, resolved.track.src, { timeoutMs: 2500 });
      }
      const resumeAt = audio.currentTime || 0;
      skipPauseInterruptionRef.current = true;
      patchState({ playbackNetworkState: "loading_stream" });
      await waitAudioSrcReady(audio, resolved.track.src, { signal: activeStreamAbortRef.current?.signal });
      if (resumeAt > 0) {
        const applyUpgradeSeek = () => {
          if (isFinite(audio.duration) && audio.duration > 0) {
            audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
          }
        };
        if (isFinite(audio.duration) && audio.duration > 0) {
          applyUpgradeSeek();
        } else {
          let upgradeSeekCleanup;
          const onUpgradeMetadata = () => {
            clearTimeout(upgradeSeekCleanup);
            applyUpgradeSeek();
          };
          audio.addEventListener("loadedmetadata", onUpgradeMetadata, { once: true });
          upgradeSeekCleanup = setTimeout(
            () => audio.removeEventListener("loadedmetadata", onUpgradeMetadata),
            5000
          );
        }
      }
      patchState({
        currentTrack: {
          ...track,
          src: resolved.track.src,
          metadata: {
            ...track.metadata,
            access: {
              ...(track.metadata?.access || {}),
              previewOnly: false,
              canStream: true,
            },
          },
        },
        playbackState: audio.paused ? "paused" : "playing",
        playbackNetworkState: audio.paused ? "idle" : "playing",
        error: null,
        accessDenied: false,
      });
      if (!audio.paused) await playAudioIfNotPaused(audio, stateRef.current.isPlaying);
      return true;
    } catch (err) {
      if (err?.name === "AbortError" || err?.code === "AUDIO_SRC_ABORTED") return false;
      if (err?.code === "ACCESS_DENIED") {
        patchState({
          accessDenied: true,
          error: "Access unavailable",
          isPlaying: false,
          playbackNetworkState: "error_stream",
        });
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
        }
      } else {
        patchState({
          isPlaying: false,
          playbackNetworkState: "error_stream",
        });
      }
      return false;
    }
  }, [
    patchState,
    resolveLibraryStreamForTrack,
    logDirectInternalCallViolation,
    tracePlayback,
  ]);

  const setOnPreviewEnded = useCallback((handler) => {
    onPreviewEndedRef.current = typeof handler === "function" ? handler : null;
  }, []);

  const overrideConcurrentStream = useCallback(async () => {
    const conflict = stateRef.current.streamConflict;
    if (!conflict?.track) return false;
    patchState({ streamConflict: null });
    return (
      playTrackRef.current?.(conflict.track, {
      resumeAt: conflict.resumeAt,
      forceStream: true,
      }) ?? false
    );
  }, [patchState]);

  const dismissStreamConflict = useCallback(() => {
    patchState({ streamConflict: null });
  }, [patchState]);

  const retryStreamPlayback = useCallback(async () => {
    const track = stateRef.current.currentTrack;
    if (!track) return false;
    streamErrorRetriedRef.current = false;
    patchState({ error: null, streamRetryable: false, accessDenied: false });
    const resumeAt = audioRef.current?.currentTime || stateRef.current.currentTime || 0;
    // preserveQueue: true — retry must not replace the album/EP queue; next/prev
    // must still work after the stall recovers.
    return playTrackRef.current?.(track, { resumeAt, forceStream: true, preserveQueue: true }) ?? false;
  }, [patchState]);

  useEffect(() => {
    retryStreamPlaybackRef.current = retryStreamPlayback;
  }, [retryStreamPlayback]);

  const recoverAudioHard = useCallback(
    async (reason, { resumeAfter = false } = {}) => {
      if (isRecoveringRef.current) return false;
      if (Date.now() < recoveryCooldownUntilRef.current && reason !== "truth_violation") {
        return false;
      }
      if (blockRecoveryForLifecycleOsSuspended("recoverAudioHard", reason)) {
        return false;
      }

      const audioPre = audioRef.current;
      const trackPre = stateRef.current.currentTrack;
      const transportPre = evaluatePlaybackTransportHealth(audioPre, trackPre, {
        queueLength: queueRef.current.length,
        queueIndex: queueIndexRef.current,
      });
      const lifecycleOnlyPause =
        !userPausedRef.current &&
        transportPre.intact &&
        audioPre?.paused &&
        (playbackIntentBeforeHideRef.current ||
          isLifecycleInterruptReason(reason) ||
          Date.now() < lifecycleRecoverySuppressedUntilRef.current);
      if (
        lifecycleOnlyPause &&
        reason !== "truth_violation" &&
        !isGenuineTransportFailureReason(reason)
      ) {
        if (isLifecycleRecoverySuppressed(reason)) {
          logLifecycleRecoverySuppressed({
            source: "recoverAudioHard",
            reason,
            resumeAfter,
            slug: trackPre?.slug ?? null,
          });
        } else {
          logBackgroundRecoverySkipped({
            source: "recoverAudioHard",
            reason,
            resumeAfter,
            slug: trackPre?.slug ?? null,
            path: "lifecycle_transport_intact",
          });
        }
        const lightOk = await attemptLightweightPlaybackResume(`recoverAudioHard_blocked:${reason}`);
        logRecoveryPathClassification({
          path: lightOk ? "lightweight" : "no_op",
          reason: lightOk ? "lifecycle_lightweight_resume" : "os_suspend_not_failure",
          transportIntact: transportPre.intact,
          lifecycleIntent: playbackIntentBeforeHideRef.current,
          userPaused: userPausedRef.current,
          resumeAfter,
          source: "recoverAudioHard_blocked",
          slug: trackPre?.slug ?? null,
        });
        if (lightOk) {
          armLifecycleRecoverySuppression("recoverAudioHard_blocked", reason);
          return true;
        }
        if (
          transportPre.intact &&
          (isLifecycleOsSuspended() ||
            audioCtxRef.current?.state === "suspended" ||
            isDocumentPlaybackHidden() ||
            lifecycleInBackgroundRef.current ||
            isLifecycleRecoverySuppressed(reason))
        ) {
          logRecoveryPathClassification({
            path: "no_op",
            reason: "lifecycle_preserve_transport",
            transportIntact: transportPre.intact,
            lifecycleIntent: playbackIntentBeforeHideRef.current,
            userPaused: userPausedRef.current,
            resumeAfter,
            source: "recoverAudioHard_blocked",
            slug: trackPre?.slug ?? null,
          });
          return false;
        }
      }

      isRecoveringRef.current = true;
      internalPlaybackAuthorityRef.current = true;
      const track = stateRef.current.currentTrack;
      const audio = audioRef.current;
      const resumeAt = audio?.currentTime || stateRef.current.currentTime || 0;
      const shouldResume =
        Boolean(resumeAfter) &&
        !userPausedRef.current &&
        Boolean(track) &&
        (isEntitledFullPlaybackTrack(track) || !track?.metadata?.access?.previewOnly);

      try {
        logPlaybackResilience("recover-audio-hard", {
          source: "AudioContext",
          code: "RECOVER_AUDIO_HARD",
          reason,
          slug: track?.slug ?? null,
          resumeAfter: shouldResume,
        });
        tracePlayback("recovery", "recoverAudioHard", { reason, resumeAfter: shouldResume });

        stopStallRecovery();
        stopProgressRaf();
        stopKeepAlivePing();
        stopPositionSaveTimer();

        if (audio) {
          skipPauseInterruptionRef.current = true;
          audio.pause();
          try {
            audio.removeAttribute("src");
            audio.load();
          } catch {
            /* brief src clear for iOS silent graph */
          }
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
        if (resumeAt > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
          const safe = clampRestorePosition(resumeAt, audio.duration);
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
          requestId: activeCommandRef.current?.requestId || null,
          state: stateRef.current,
          error,
          context: { reason },
        });
        patchState({
          isPlaying: false,
          playbackState: "paused",
          isBuffering: false,
          playbackNetworkState: "error_stream",
          error: "Playback needs a moment — tap play to continue.",
        });
        return false;
      } finally {
        recoveryCooldownUntilRef.current = Date.now() + RECOVERY_COOLDOWN_MS;
        isRecoveringRef.current = false;
        internalPlaybackAuthorityRef.current = false;
      }
    },
    [
      initWebAudio,
      patchState,
      resolveLibraryStreamForTrack,
      stopKeepAlivePing,
      stopPositionSaveTimer,
      stopProgressRaf,
      stopStallRecovery,
      tracePlayback,
      attemptLightweightPlaybackResume,
      armLifecycleRecoverySuppression,
      blockRecoveryForLifecycleOsSuspended,
      isLifecycleRecoverySuppressed,
    ]
  );

  useEffect(() => {
    recoverAudioHardRef.current = recoverAudioHard;
  }, [recoverAudioHard]);

  useEffect(() => {
    playbackStateMachine.setRecoverExecutor((reason, opts) =>
      recoverAudioHard(reason, opts)
    );
    return () => playbackStateMachine.setRecoverExecutor(null);
  }, [recoverAudioHard]);

  useEffect(() => {
    playbackStateMachine.setLifecycleRecoveryGuard(() =>
      blockRecoveryForLifecycleOsSuspended("PlaybackStateMachine", null)
    );
    return () => playbackStateMachine.setLifecycleRecoveryGuard(null);
  }, [blockRecoveryForLifecycleOsSuspended]);

  const releaseLifecycleRecoveryLock = useCallback((lockId) => {
    if (lifecycleRecoveryLockTimerRef.current) {
      clearTimeout(lifecycleRecoveryLockTimerRef.current);
      lifecycleRecoveryLockTimerRef.current = null;
    }
    if (lifecycleRecoveryLockIdRef.current === lockId) {
      lifecycleRecoveryLockRef.current = false;
    }
  }, []);

  const clearBfcacheRecoveryInProgress = useCallback(() => {
    bfcacheRecoveryInProgressRef.current = false;
    if (bfcacheRecoveryTimeoutRef.current) {
      clearTimeout(bfcacheRecoveryTimeoutRef.current);
      bfcacheRecoveryTimeoutRef.current = null;
    }
  }, []);

  const beginBfcacheRecoveryInProgress = useCallback(() => {
    clearBfcacheRecoveryInProgress();
    bfcacheRecoveryInProgressRef.current = true;
    bfcacheRecoveryTimeoutRef.current = setTimeout(() => {
      clearBfcacheRecoveryInProgress();
    }, BFCACHE_RECOVERY_TIMEOUT_MS);
  }, [clearBfcacheRecoveryInProgress]);

  const requestPlaybackRecovery = useCallback(
    (event, payload) => {
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
        return attemptLightweightPlaybackResume(`recovery_suppressed:${reason}`).then(
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
    },
    [
      armLifecycleRecoverySuppression,
      attemptLightweightPlaybackResume,
      blockRecoveryForLifecycleOsSuspended,
      computeLifecycleAudioTruthState,
      getPlaybackTransportHealth,
      isLifecycleRecoverySuppressed,
    ]
  );

  const runCoalescedLifecycleRecovery = useCallback(
    ({ reason, resumeAfter, trigger }) => {
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
        releaseLifecycleRecoveryLock(lockId);
      }, LIFECYCLE_RECOVERY_LOCK_MS);

      if (trigger === "bfcache_restore") {
        beginBfcacheRecoveryInProgress();
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
        return requestPlaybackRecovery(PLAYBACK_ORCHESTRATION_EVENTS.RECOVERY_REQUESTED, {
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

        if (resumeAfter && !userPausedRef.current) {
          logBackgroundRecoveryTrigger({
            source: trigger,
            reason,
            slug: stateRef.current.currentTrack?.slug ?? null,
          });
          const lightOk = await attemptLightweightPlaybackResume(trigger);
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
        releaseLifecycleRecoveryLock(lockId);
        if (trigger === "bfcache_restore") {
          clearBfcacheRecoveryInProgress();
        }
      });
    },
    [
      armLifecycleRecoverySuppression,
      attemptLightweightPlaybackResume,
      beginBfcacheRecoveryInProgress,
      blockRecoveryForLifecycleOsSuspended,
      clearBfcacheRecoveryInProgress,
      computeLifecycleAudioTruthState,
      evaluateLifecyclePlaybackHealth,
      getPlaybackTransportHealth,
      releaseLifecycleRecoveryLock,
      requestPlaybackRecovery,
      syncMediaSessionAfterLifecycle,
    ]
  );

  const resumePlaybackTransport = useCallback(async () => {
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
      internalPlaybackAuthorityRef.current = false;
    }
  }, [initWebAudio, patchState, resolveLibraryStreamForTrack]);

  useEffect(() => {
    if (!state.hasStarted) return undefined;
    const intervalId = setInterval(() => {
      if (!stateRef.current.hasStarted) return;
      if (!stateRef.current.isPlaying && !playbackIntentBeforeHideRef.current) return;
      if (isRecoveringRef.current) return;
      if (Date.now() < recoveryCooldownUntilRef.current) return;

      const lifecycleTruth = computeLifecycleAudioTruthState();
      if (lifecycleTruth === LIFECYCLE_AUDIO_TRUTH_STATES.OS_SUSPENDED) {
        logWatchdogSkippedOsSuspend({
          source: "audibility_watchdog",
          slug: stateRef.current.currentTrack?.slug ?? null,
        });
        return;
      }

      const audibilityParams = getAudibilityParams();
      const { audio } = audibilityParams;
      if (!audio) return;

      updateAudibilitySample(audio, audibilitySampleRef);

      const truth = validatePlaybackTruthIntegrity({
        ...audibilityParams,
        uiPlaying: stateRef.current.isPlaying,
      });
      if (
        isDocumentPlaybackHidden() ||
        lifecycleInBackgroundRef.current ||
        (playbackIntentBeforeHideRef.current && !userPausedRef.current)
      ) {
        return;
      }

      if (truth.violation === PLAYBACK_TRUTH_VIOLATION) {
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
              Boolean(stateRef.current.currentTrack),
          }
        );
        return;
      }

      if (!stateRef.current.isPlaying) return;

      if (
        isDocumentPlaybackHidden() ||
        lifecycleInBackgroundRef.current ||
        (playbackIntentBeforeHideRef.current && !userPausedRef.current)
      ) {
        return;
      }

      if (isAudioActuallyAudible(audibilityParams)) return;

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
          resumeAfter: !userPausedRef.current,
        }
      );
    }, AUDIBILITY_WATCHDOG_MS);
    return () => clearInterval(intervalId);
  }, [
    computeLifecycleAudioTruthState,
    getAudibilityParams,
    getPlaybackTransportHealth,
    isLifecycleRecoverySuppressed,
    requestPlaybackRecovery,
    state.hasStarted,
  ]);

  const applyCSModeToTrack = useCallback(
    async (track) => {
      if (!csModeRef.current || !track) return;
      const normalized = normalizeTrack(track);
      const audio = audioRef.current;
      if (!audio) return;
      const presentation = resolvePlaybackPresentation(
        normalized,
        true,
        csUsingAlternateSrcRef.current
      );
      const nextTrack = {
        ...normalized,
        title: presentation.title,
        src: presentation.src,
        cover: presentation.cover,
      };
      const currentUrl = audio.currentSrc || audio.src;
      const targetUrl = new URL(nextTrack.src, window.location.href).href;
      if (currentUrl !== targetUrl) {
        skipPauseInterruptionRef.current = true;
        audio.pause();
        await waitAudioSrcReady(audio, nextTrack.src);
      }
      applyCsToElement(audio, presentation, audio.currentTime > 0 ? audio.currentTime : null);
      patchState({
        csTrack: normalized,
        currentTrack: nextTrack,
        currentTrackId: nextTrack.id,
      });
      void updateMediaSession(nextTrack, { playing: !audio.paused });
    },
    [applyCsToElement, patchState, updateMediaSession]
  );

  const toggleCSMode = useCallback(async () => {
    const next = !csModeRef.current;
    csModeRef.current = next;

    const audio = audioRef.current;
    const track = stateRef.current.currentTrack;
    if (!audio || !track || !stateRef.current.hasStarted) {
      patchState({ csMode: next, csTrack: next && track ? normalizeTrack(track) : null });
      void updateMediaSession(track, { playing: stateRef.current.isPlaying });
      return next;
    }

    const normalized = stateRef.current.csTrack || normalizeTrack(track);
    const resumeAt = audio.currentTime;
    const presentation = resolvePlaybackPresentation(normalized, next, csUsingAlternateSrcRef.current);
    const nextTrack = {
      ...normalized,
      title: presentation.title,
      src: presentation.src,
      cover: presentation.cover,
    };

    const currentUrl = audio.currentSrc || audio.src;
    const targetUrl = new URL(nextTrack.src, window.location.href).href;
    const needsSrcSwap = currentUrl !== targetUrl;

    try {
      if (needsSrcSwap) {
        skipPauseInterruptionRef.current = true;
        audio.pause();
        await waitAudioSrcReady(audio, nextTrack.src);
        pendingSeekRef.current = resumeAt > 0 ? resumeAt : null;
      }
      applyCsToElement(audio, presentation, resumeAt > 0 ? resumeAt : null);
      patchState({
        csMode: next,
        csTrack: next ? normalized : null,
        currentTrack: nextTrack,
      });
      void updateMediaSession(nextTrack, { playing: !audio.paused });
      if (audio.paused && stateRef.current.isPlaying) {
        await playAudioIfNotPaused(audio, true, {
          command: "TOGGLE_CS_MODE",
          requestId: activeCommandRef.current?.requestId || null,
          state: stateRef.current,
          context: { source: "applyCSModeToTrack" },
        });
      }
      syncPositionState(true);
    } catch (error) {
      csModeRef.current = !next;
      patchState({ error: "Could not apply chopped & slowed mode.", csMode: !next });
      reportPlaybackDiagnostic({
        level: "warn",
        code: "CS_MODE_APPLY_FAILED",
        command: "TOGGLE_CS_MODE",
        requestId: activeCommandRef.current?.requestId || null,
        state: stateRef.current,
        error,
        context: {
          visibility: typeof document !== "undefined" ? document.visibilityState : null,
          source: stateRef.current?.source || null,
        },
      });
    }
    return next;
  }, [patchState, updateMediaSession, applyCsToElement, syncPositionState]);

  const setQueueInternal = useCallback((tracks = [], startIndex = 0) => {
    logDirectInternalCallViolation("setQueueInternal");
    const normalized = (tracks || []).map(normalizeTrack).filter((t) => t.src);
    const index = Math.max(0, Math.min(startIndex, normalized.length - 1));
    const sameTracks = playbackQueuesMatch(normalized, queueRef.current);
    queueRef.current = normalized;
    queueIndexRef.current = normalized.length ? index : -1;
    // New queue → discard stale shuffle permutation.
    if (!sameTracks) {
      shuffledOrderRef.current = null;
      shufflePositionRef.current = 0;
    }
    tracePlayback("queueReset", "setQueue", { length: normalized.length, index, sameTracks });
    perfMark(MARKS.QUEUE_UPDATE_START);
    startTransition(() => {
      if (sameTracks) {
        if (queueIndexRef.current !== stateRef.current.queueIndex) {
          patchState({ queueIndex: queueIndexRef.current });
        }
      } else {
        patchState({ queue: normalized, queueIndex: queueIndexRef.current });
      }
      perfMark(MARKS.QUEUE_UPDATE_END);
      perfMeasure("queue-update", MARKS.QUEUE_UPDATE_START, MARKS.QUEUE_UPDATE_END);
    });
    return normalized;
  }, [patchState, tracePlayback, logDirectInternalCallViolation]);

  const playNextInternal = useCallback(async ({ autoAdvance = false } = {}) => {
    const current = stateRef.current.currentTrack;
    if (autoAdvance && current?.metadata?.access?.previewOnly) {
      return false;
    }
    const queue = queueRef.current;
    if (!queue.length) return false;
    let nextIndex = queueIndexRef.current + 1;
    if (shuffleRef.current && queue.length > 1) {
      nextIndex = advanceShuffleOrder(queue, queueIndexRef.current);
    } else if (nextIndex >= queue.length) {
      if (repeatModeRef.current === "all") nextIndex = 0;
      else return false;
    }
    let attempts = 0;
    while (attempts < queue.length) {
      const track = queue[nextIndex];
      if (!track?.src) {
        nextIndex += 1;
        if (nextIndex >= queue.length) {
          if (repeatModeRef.current === "all") nextIndex = 0;
          else return false;
        }
        attempts += 1;
        continue;
      }
      queueIndexRef.current = nextIndex;
      patchState({ queueIndex: nextIndex });
      const ok = await playTrackInternal(track, { resumeAt: 0 });
      if (ok && csModeRef.current) await applyCSModeToTrack(track);
      return ok;
    }
    return false;
  }, [playTrackInternal, patchState, applyCSModeToTrack]);

  const playPreviousInternal = useCallback(async () => {
    const queue = queueRef.current;
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      syncProgressTime(0);
      syncPositionState(true);
      return true;
    }
    if (!queue.length) return false;
    let prevIndex = queueIndexRef.current - 1;
    if (prevIndex < 0) prevIndex = repeatModeRef.current === "all" ? queue.length - 1 : 0;
    let attempts = 0;
    while (attempts < queue.length) {
      const track = queue[prevIndex];
      if (!track?.src) {
        prevIndex -= 1;
        if (prevIndex < 0) {
          if (repeatModeRef.current === "all") prevIndex = queue.length - 1;
          else return false;
        }
        attempts += 1;
        continue;
      }
      queueIndexRef.current = prevIndex;
      patchState({ queueIndex: prevIndex });
      const ok = await playTrackInternal(track, { resumeAt: 0 });
      if (ok && csModeRef.current) await applyCSModeToTrack(track);
      return ok;
    }
    return false;
  }, [playTrackInternal, patchState, syncPositionState, applyCSModeToTrack]);

  const setRepeatMode = useCallback((mode) => {
    const next = REPEAT_MODES.includes(mode) ? mode : "off";
    repeatModeRef.current = next;
    patchState({ repeatMode: next });
    const userId = listeningUserIdRef.current;
    if (userId && queueRef.current.length) {
      savePlaybackSession(userId, {
        queue: queueRef.current,
        queueIndex: queueIndexRef.current,
        shuffle: shuffleRef.current,
        repeatMode: next,
      });
    }
  }, [patchState]);

  const toggleRepeat = useCallback(() => {
    const order = ["off", "one", "all"];
    const current = repeatModeRef.current || "off";
    const next = order[(order.indexOf(current) + 1) % order.length];
    setRepeatMode(next);
    return next;
  }, [setRepeatMode]);

  const setShuffle = useCallback((enabled) => {
    shuffleRef.current = Boolean(enabled);
    if (!enabled) {
      // Discard the permutation so the next shuffle starts fresh.
      shuffledOrderRef.current = null;
      shufflePositionRef.current = 0;
    }
    patchState({ shuffle: Boolean(enabled) });
    const userId = listeningUserIdRef.current;
    if (userId && queueRef.current.length) {
      savePlaybackSession(userId, {
        queue: queueRef.current,
        queueIndex: queueIndexRef.current,
        shuffle: Boolean(enabled),
        repeatMode: repeatModeRef.current,
      });
    }
  }, [patchState]);

  const toggleShuffle = useCallback(() => {
    setShuffle(!shuffleRef.current);
    return shuffleRef.current;
  }, [setShuffle]);

  // Advance the Fisher-Yates shuffle permutation and return the next queue index.
  // Generates a new permutation when the current one is exhausted (repeat-all semantics).
  const advanceShuffleOrder = useCallback((queue, currentIndex) => {
    if (!shuffledOrderRef.current || shuffledOrderRef.current.length !== queue.length) {
      const indices = Array.from({ length: queue.length }, (_, i) => i);
      shuffledOrderRef.current = fisherYatesShuffle(indices);
      // Ensure the current track is not the first to be played in the new order.
      const ci = shuffledOrderRef.current.indexOf(currentIndex);
      if (ci === 0 && queue.length > 1) {
        shuffledOrderRef.current[0] = shuffledOrderRef.current[1];
        shuffledOrderRef.current[1] = currentIndex;
      }
      shufflePositionRef.current = 0;
    }
    const nextPos = shufflePositionRef.current + 1;
    if (nextPos >= shuffledOrderRef.current.length) {
      // All tracks played — reshuffle for next cycle.
      const indices = Array.from({ length: queue.length }, (_, i) => i);
      shuffledOrderRef.current = fisherYatesShuffle(indices);
      shufflePositionRef.current = 0;
    } else {
      shufflePositionRef.current = nextPos;
    }
    return shuffledOrderRef.current[shufflePositionRef.current];
  }, []);

  const playQueueInternal = useCallback(async (tracks = [], startIndex = 0, options = {}) => {
    logDirectInternalCallViolation("playQueueInternal");
    // autoAdvance defaults to true — singles/features pass false to stop after each track
    stopAfterEachTrackRef.current = options.autoAdvance === false;
    const normalized = setQueueInternal(tracks, startIndex);
    if (!normalized.length) return false;
    const index = Math.max(0, Math.min(startIndex, normalized.length - 1));
    return playTrackInternal(normalized[index], {
      ...options,
      preserveActiveStream: Boolean(options.preserveActiveStream),
    });
  }, [setQueueInternal, playTrackInternal, logDirectInternalCallViolation]);

  const pauseInternal = useCallback((opts = {}) => {
    logDirectInternalCallViolation("pauseInternal");
    const fromViewport = Boolean(opts.fromViewport);
    const userInitiated = Boolean(opts.userInitiated);
    const interrupt = Boolean(opts.interrupt);

    if (userInitiated) {
      lastUserActionRef.current = "pause";
      clearViewportResume();
      userPausedRef.current = true;
    } else if (fromViewport) {
      viewportPauseRef.current = true;
    } else if (!interrupt) {
      userPausedRef.current = true;
    }

    tracePlayback("pauseInternal", "pauseInternal", { fromViewport, userInitiated, interrupt });
    audioRef.current?.pause();
  }, [clearViewportResume, tracePlayback, logDirectInternalCallViolation]);

  const pauseForViewport = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) {
      if (stateRef.current.isPlaying) {
        patchState({ isPlaying: false, playbackState: "paused" });
      }
      return;
    }
    tracePlayback("pauseForViewport", "pauseForViewport");
    void dispatchPlaybackCommandRef.current?.(PLAYBACK_COMMANDS.VIEWPORT_PAUSE, {}, { serial: false });
  }, [patchState, tracePlayback]);

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

  const resumeInternal = useCallback(async () => {
    logDirectInternalCallViolation("resumeInternal");
    const audio = audioRef.current;
    const track = stateRef.current.currentTrack;
    if (!audio || !track) return false;

    tracePlayback("resumeInternal", "resumeInternal", { slug: track.slug });
    lastUserActionRef.current = "play";
    userPausedRef.current = false;

    try {
      // iOS gesture trust fix: initWebAudio + ctx.resume() MUST run synchronously in the
      // gesture call stack — before any await. iOS Safari captures the "user activation"
      // grant from synchronous AudioContext.resume() calls. Once the AudioContext has user
      // activation, audio.play() succeeds after subsequent async awaits. Without this,
      // the 3 awaits below break the gesture chain and play() throws NotAllowedError on iOS
      // after lock-screen or phone-call interruptions.
      initWebAudio();
      const iosGestureCtx = audioCtxRef.current;
      if (iosGestureCtx && iosGestureCtx.state !== "running") {
        iosGestureCtx.resume().catch(() => {}); // fire-and-forget: iOS gesture captured here
      }
      // Android + older iOS: play-then-pause to unlock the element itself.
      // On iOS 14+, the ctx.resume() above already propagates to element play permission,
      // so this becomes a no-op (audio.paused is checked inside unlockAudioFromGesture).
      await unlockAudioFromGesture(audio);
      await resumeWebAudioContextIfSuspended(audioCtxRef);
      if (!(await ensureWebAudioRunning(audioCtxRef))) {
        const lightOk = await attemptLightweightPlaybackResume("resume_ctx_suspended");
        await resumeWebAudioContextIfSuspended(audioCtxRef, "resume-after-light");
        if (!(await ensureWebAudioRunning(audioCtxRef))) {
          reportPlaybackDiagnostic({
            level: "warn",
            code: "WEB_AUDIO_SUSPENDED_BLOCKED_RESUME",
            command: PLAYBACK_COMMANDS.RESUME,
            requestId: activeCommandRef.current?.requestId || null,
            state: stateRef.current,
            context: { lightResumeOk: lightOk },
          });
          patchState({
            isPlaying: false,
            error: "Tap play to continue.",
            playbackState: "paused",
          });
          return false;
        }
      }
      const played = await playAudioIfNotPaused(audio, true, {
        command: PLAYBACK_COMMANDS.RESUME,
        requestId: activeCommandRef.current?.requestId || null,
        state: stateRef.current,
        context: { source: "resumeInternal" },
      });
      if (!played || audio.paused) {
        patchState({
          isPlaying: false,
          error: "Audio playback failed. Try again in a moment.",
          playbackState: "paused",
        });
        return false;
      }
      if (track) void updateMediaSession(track, { playing: !audio.paused });
      patchState({
        error: null,
        accessDenied: false,
        hasStarted: true,
      });

      const meta = streamMetaRef.current;
      const slug = meta?.slug || parseStreamSlugFromSrc(track.src) || track.slug;
      if (slug && meta && streamUrlNeedsRefresh(meta) && !isLibraryStreamRedirectSrc(meta.url)) {
        const refreshTrackSlug = track?.slug;
        void (async () => {
          try {
            const data = await fetchLibraryStream(slug, { force: false });
            // Bail if the user skipped to a different track while the URL refresh was in flight.
            if (stateRef.current.currentTrack?.slug !== refreshTrackSlug) return;
            streamMetaRef.current = {
              ...meta,
              url: data.url,
              fetchedAt: Date.now(),
              expiresIn: data.expiresIn || 3600,
              streamEventId: data.streamEventId || meta.streamEventId,
              sessionId: data.sessionId || meta.sessionId,
            };
            const resumeAt = audio.currentTime || 0;
            skipPauseInterruptionRef.current = true;
            await waitAudioSrcReady(audio, data.url, { signal: activeStreamAbortRef.current?.signal });
            // Check again after the async src-ready wait
            if (stateRef.current.currentTrack?.slug !== refreshTrackSlug) return;
            if (resumeAt > 0) {
              const seekAfterLoad = () => {
                if (resumeAt > 0 && isFinite(audio.duration)) {
                  audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.25));
                }
              };
              if (isFinite(audio.duration) && audio.duration > 0) {
                seekAfterLoad();
              } else {
                audio.addEventListener("loadedmetadata", seekAfterLoad, { once: true });
              }
            }
            if (!audio.paused) await playAudioIfNotPaused(audio, stateRef.current.isPlaying);
          } catch (error) {
            reportPlaybackDiagnostic({
              level: "warn",
              code: "RESUME_STREAM_REFRESH_FAILED",
              command: PLAYBACK_COMMANDS.RESUME,
              requestId: activeCommandRef.current?.requestId || null,
              state: stateRef.current,
              error,
              context: {
                visibility: typeof document !== "undefined" ? document.visibilityState : null,
                source: stateRef.current?.source || null,
              },
            });
          }
        })();
      }

      return true;
    } catch (err) {
      if (err?.code === "ACCESS_DENIED") {
        const meta = streamMetaRef.current;
        if (meta) finalizeStreamSession(meta, { completed: false, durationSeconds: audio.currentTime || 0 });
        patchState({
          isPlaying: false,
          accessDenied: true,
          error: "Access unavailable",
          playbackState: "paused",
        });
        return false;
      }
      patchState({ isPlaying: false, error: "Audio playback failed. Try again in a moment.", playbackState: "paused" });
      return false;
    }
  }, [
    patchState,
    updateMediaSession,
    finalizeStreamSession,
    initWebAudio,
    requestPlaybackRecovery,
    unlockAudioFromGesture,
    tracePlayback,
    logDirectInternalCallViolation,
  ]);

  const seekInternal = useCallback((time) => {
    logDirectInternalCallViolation("seekInternal");
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(time)) return;
    cancelCrossfade();
    tracePlayback("seekInternal", "seekInternal", { time });
    const track = stateRef.current.currentTrack;
    let capped = time;
    if (track?.metadata?.access?.previewOnly) {
      capped = Math.min(time, PREVIEW_HARD_CAP_SEC);
    }
    if (audio.readyState < 1 || stateRef.current.playbackState === "loading") {
      pendingSeekRef.current = Math.max(0, capped);
      syncProgressTime(pendingSeekRef.current);
      return;
    }
    audio.currentTime = Math.max(0, Math.min(capped, isFinite(audio.duration) ? audio.duration : capped));
    syncProgressTime(audio.currentTime);
    syncPositionState(true);
    if (stateRef.current.currentTrack) {
      sendControlSystemPlaybackEvent(stateRef.current.currentTrack, "seek", {
        mediaType: "audio",
        positionSeconds: audio.currentTime,
        durationSeconds: isFinite(audio.duration) ? audio.duration : 0,
      });
    }
  }, [syncProgressTime, syncPositionState, tracePlayback, logDirectInternalCallViolation, cancelCrossfade]);

  const seekBack = useCallback((seconds = 15) => {
    const audio = audioRef.current;
    if (!audio) return;
    seekInternal(Math.max(0, (audio.currentTime || 0) - seconds));
  }, [seekInternal]);

  const seekForward = useCallback((seconds = 15) => {
    const audio = audioRef.current;
    if (!audio) return;
    const max = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (audio.currentTime || 0) + seconds;
    seekInternal(Math.min(max, (audio.currentTime || 0) + seconds));
  }, [seekInternal]);

  const resumeTrackAtPosition = useCallback(
    async (trackId, position) => {
      const track = stateRef.current.currentTrack;
      if (!track || !stateRef.current.hasStarted) return false;
      const normalizedId = trackId != null ? String(trackId) : "";
      const matches =
        normalizedId &&
        (normalizedId === String(track.id || "") ||
          normalizedId === String(track.trackId || "") ||
          normalizedId === String(track.slug || ""));
      if (!matches) return false;

      const audio = audioRef.current;
      if (!audio) return false;

      const targetPos = Math.max(0, Number(position) || 0);
      if (Number.isFinite(targetPos) && Math.abs((audio.currentTime || 0) - targetPos) > 0.25) {
        seekInternal(targetPos);
      }

      if (!audio.paused) return true;
      return resumeInternal();
    },
    [resumeInternal, seekInternal]
  );

  const resumeFromViewport = useCallback(async () => {
    if (viewportResumeInFlightRef.current) return false;
    if (isInAudioVisualViewportRef.current) return false;

    const trackId = lastTrackIdRef.current;
    const audio = audioRef.current;
    const position = audio?.currentTime ?? stateRef.current.currentTime ?? 0;

    viewportResumeInFlightRef.current = true;
    try {
      const ok =
        trackId != null
          ? await resumeTrackAtPosition(trackId, position)
          : await resumeInternal();
      if (ok) {
        lastUserActionRef.current = "play";
        clearViewportResume();
      }
      return ok;
    } finally {
      viewportResumeInFlightRef.current = false;
    }
  }, [clearViewportResume, resumeInternal, resumeTrackAtPosition]);

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
    } else {
      wasPlayingBeforeViewportPauseRef.current = false;
      resumeEligibleRef.current = false;
    }
  }, [getCurrentTrackId, pauseForViewport]);

  const exitAudioVisualViewport = useCallback(() => {
    isInAudioVisualViewportRef.current = false;

    if (!shouldAutoResumeViewport()) {
      clearViewportResume();
      return;
    }

    resumeEligibleRef.current = false;
    wasPlayingBeforeViewportPauseRef.current = false;

    void dispatchPlaybackCommandRef.current?.(PLAYBACK_COMMANDS.VIEWPORT_RESUME).catch(() => {});
  }, [clearViewportResume, shouldAutoResumeViewport]);

  const stopInternal = useCallback(() => {
    tracePlayback("stopInternal", "stopInternal");
    lastUserActionRef.current = "stop";
    clearViewportResume();
    userPausedRef.current = true;
    const audio = audioRef.current;
    const meta = streamMetaRef.current;
    if (meta) {
      finalizeStreamSession(meta, {
        completed: false,
        durationSeconds: audio?.currentTime || 0,
      });
      void clearLibraryStreamSession(meta.slug, meta.sessionId);
    }
    stopProgressRaf();
    stopPositionSaveTimer();
    stopKeepAlivePing();
    if (audio) {
      skipPauseInterruptionRef.current = true;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    csModeRef.current = false;
    csUsingAlternateSrcRef.current = false;
    if (activeStreamAbortRef.current) {
      activeStreamAbortRef.current.abort();
      activeStreamAbortRef.current = null;
    }
    streamMetaRef.current = null;
    setState(EMPTY_STATE);
    stateRef.current = EMPTY_STATE;
    transportSnapshotRef.current = {
      playbackNetworkState: EMPTY_STATE.playbackNetworkState,
      isBuffering: EMPTY_STATE.isBuffering,
    };
    notifyTransportListeners();
    queueRef.current = [];
    queueIndexRef.current = -1;
    clearPersistedMediaSessionTrack();
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
  }, [
    clearViewportResume,
    finalizeStreamSession,
    stopPositionSaveTimer,
    stopProgressRaf,
    stopKeepAlivePing,
    tracePlayback,
    notifyTransportListeners,
  ]);

  const executePlaybackCommand = useCallback(async (command) => {
    if (command.requestId !== activeCommandRef.current?.requestId) return false;
    switch (command.type) {
      case PLAYBACK_COMMANDS.PLAY_TRACK: {
        const track = command.payload.track;
        const opts = command.payload.options || {};
        // Replace the queue with a single-item queue unless the caller explicitly
        // opts out (retry/recovery flows) or the track is already in the current queue.
        // Without this, playing a single or feature while an album queue is active
        // leaves the old queue intact — when the single ends, the next album track
        // auto-advances instead of stopping (or playing the next single).
        if (track && !opts.preserveQueue) {
          const alreadyQueued = queueRef.current.some((qt) => isSamePlaybackTrack(qt, track));
          if (!alreadyQueued) setQueueInternal([track], 0);
        }
        return playTrackInternal(track, opts);
      }
      case PLAYBACK_COMMANDS.PLAY_QUEUE:
        return playQueueInternal(
          command.payload.tracks || [],
          command.payload.startIndex || 0,
          command.payload.options || {}
        );
      case PLAYBACK_COMMANDS.PAUSE:
        pauseInternal({ userInitiated: true });
        return true;
      case PLAYBACK_COMMANDS.INTERRUPT:
        pauseInternal({ interrupt: true });
        return true;
      case PLAYBACK_COMMANDS.RESUME:
        return resumeInternal();
      case PLAYBACK_COMMANDS.RECOVER: {
        tracePlayback("recovery", "executePlaybackCommand", {
          command: "RECOVER",
          reason: command.payload?.reason ?? null,
        });
        if (command.payload?.hard === false) {
          return resumeInternal();
        }
        return requestPlaybackRecovery(
          PLAYBACK_ORCHESTRATION_EVENTS.RECOVERY_REQUESTED,
          {
            reason: command.payload?.reason || "recover_command",
            resumeAfter: Boolean(command.payload?.resumeAfter ?? true),
          }
        );
      }
      case PLAYBACK_COMMANDS.SEEK:
        seekInternal(command.payload.time);
        return true;
      case PLAYBACK_COMMANDS.NEXT_TRACK:
        return playNextInternal();
      case PLAYBACK_COMMANDS.COMPLETE:
        return playNextInternal({ autoAdvance: true });
      case PLAYBACK_COMMANDS.PREV_TRACK:
        return playPreviousInternal();
      case PLAYBACK_COMMANDS.STOP:
        stopInternal();
        return true;
      case PLAYBACK_COMMANDS.SET_QUEUE:
        setQueueInternal(command.payload.tracks || [], command.payload.startIndex ?? 0);
        return true;
      case PLAYBACK_COMMANDS.REPLACE_TRACK:
        return playTrackInternal(command.payload.track, command.payload.options || {});
      case PLAYBACK_COMMANDS.UPGRADE_STREAM:
        return upgradeToFullStream();
      case PLAYBACK_COMMANDS.RECOVER_PLAYBACK:
        return retryStreamPlayback();
      case PLAYBACK_COMMANDS.VIEWPORT_PAUSE:
        pauseInternal({ fromViewport: true });
        return true;
      case PLAYBACK_COMMANDS.VIEWPORT_RESUME:
        return resumeFromViewport();
      default:
        return false;
    }
  }, [
    pauseInternal,
    playNextInternal,
    playPreviousInternal,
    playQueueInternal,
    playTrackInternal,
    resumeFromViewport,
    requestPlaybackRecovery,
    resumeInternal,
    retryStreamPlayback,
    seekInternal,
    setQueueInternal,
    stopInternal,
    upgradeToFullStream,
  ]);

  /**
   * Phase 8 — single authority for playback mutations. Serial by default (`commandQueueRef`).
   * Accepts `PLAYBACK_COMMANDS.*` or aliases: play, pause, resume, stop, seek, setQueue,
   * replaceTrack, upgradeStream, recoverPlayback.
   */
  const dispatchPlaybackCommand = useCallback((type, payload = {}, { serial = true, cancelActiveStream = false } = {}) => {
    const resolvedType = PLAYBACK_COMMAND_ALIASES[type] || type;
    const requestId = commandRequestIdRef.current + 1;
    commandRequestIdRef.current = requestId;
    const command = { type: resolvedType, payload, requestId, issuedAt: Date.now() };
    const isEmergencyBypass =
      resolvedType === PLAYBACK_COMMANDS.STOP || resolvedType === PLAYBACK_COMMANDS.PAUSE;

    if (USER_GESTURE_PLAYBACK_COMMANDS.has(resolvedType)) {
      initWebAudio();
      resumeWebAudioContextFromUserGesture(audioCtxRef, `dispatch:${resolvedType}`);
    }

    const run = async () => {
      commandExecutionDepthRef.current += 1;
      perfMark(MARKS.PLAYBACK_QUEUE_RESOLVED);
      if (
        activeCommandRef.current &&
        Date.now() - (activeCommandRef.current.issuedAt || 0) > ACTIVE_COMMAND_STALE_MS
      ) {
        reportPlaybackDiagnostic({
          level: "warn",
          code: "PLAYBACK_COMMAND_STALE_CLEANUP",
          command: resolvedType,
          requestId,
          state: stateRef.current,
          context: {
            staleRequestId: activeCommandRef.current.requestId,
            staleType: activeCommandRef.current.type,
          },
        });
        activeCommandRef.current = null;
      }
      activeCommandRef.current = command;
      if (cancelActiveStream && activeStreamAbortRef.current) {
        activeStreamAbortRef.current.abort();
      }
      try {
        const streamCommand =
          resolvedType === PLAYBACK_COMMANDS.PLAY_TRACK ||
          resolvedType === PLAYBACK_COMMANDS.PLAY_QUEUE ||
          resolvedType === PLAYBACK_COMMANDS.UPGRADE_STREAM ||
          resolvedType === PLAYBACK_COMMANDS.REPLACE_TRACK;
        const commandTimeoutMs = streamCommand
          ? PLAYBACK_STREAM_COMMAND_TIMEOUT_MS
          : PLAYBACK_COMMAND_TIMEOUT_MS;
        const result = await Promise.race([
          executePlaybackCommand(command),
          new Promise((_, reject) => {
            queueWatchdogRef.current = setTimeout(() => {
              reject(
                createPlaybackError("PLAYBACK_COMMAND_TIMEOUT", "Playback command watchdog timeout", {
                  command: resolvedType,
                  requestId,
                  timeoutMs: commandTimeoutMs,
                })
              );
            }, commandTimeoutMs);
          }),
        ]);
        queueCircuitOpenRef.current = false;
        return result;
      } catch (error) {
        if (error?.code === "PLAYBACK_COMMAND_TIMEOUT") {
          queueCircuitOpenRef.current = true;
        }
        reportPlaybackDiagnostic({
          code: "PLAYBACK_COMMAND_FAILED",
          command: resolvedType,
          requestId,
          state: stateRef.current,
          error,
          context: {
            ...payload,
            visibility: typeof document !== "undefined" ? document.visibilityState : null,
            source: stateRef.current?.source || null,
          },
        });
        // Return null instead of re-throwing so the promise chain never produces
        // an unhandled rejection in callers that don't .catch() the result.
        return null;
      } finally {
        commandExecutionDepthRef.current = Math.max(0, commandExecutionDepthRef.current - 1);
        if (queueWatchdogRef.current) {
          clearTimeout(queueWatchdogRef.current);
          queueWatchdogRef.current = null;
        }
        if (activeCommandRef.current?.requestId === requestId) {
          activeCommandRef.current = null;
        }
        const track = stateRef.current?.currentTrack;
        correlateBlackscreenPlayback(resolvedType, {
          requestId,
          trackId: track?.id ?? track?.trackId ?? track?.slug ?? null,
          isPlaying: Boolean(stateRef.current?.isPlaying),
        });
      }
    };

    if (!serial) return Promise.resolve().then(run);
    if (isEmergencyBypass) {
      return Promise.resolve()
        .then(run)
        .finally(() => {
          if (queueCircuitOpenRef.current) {
            commandQueueRef.current = Promise.resolve();
            queueCircuitOpenRef.current = false;
          }
        });
    }
    if (queueCircuitOpenRef.current) {
      reportPlaybackDiagnostic({
        level: "warn",
        code: "PLAYBACK_QUEUE_RELEASE_FALLBACK",
        command: resolvedType,
        requestId,
        state: stateRef.current,
      });
      commandQueueRef.current = Promise.resolve();
    }
    // Navigation commands supersede any in-progress stream load. Aborting here
    // causes the running waitAudioSrcReady to resolve instantly with AUDIO_SRC_ABORTED,
    // the active command's run() exits cleanly, and the new command starts without delay.
    if (
      resolvedType === PLAYBACK_COMMANDS.PLAY_TRACK ||
      resolvedType === PLAYBACK_COMMANDS.PLAY_QUEUE ||
      resolvedType === PLAYBACK_COMMANDS.NEXT_TRACK ||
      resolvedType === PLAYBACK_COMMANDS.PREV_TRACK ||
      resolvedType === PLAYBACK_COMMANDS.REPLACE_TRACK
    ) {
      activeStreamAbortRef.current?.abort();
    }
    commandQueueRef.current = commandQueueRef.current.catch(() => undefined).then(run);
    return commandQueueRef.current;
  }, [executePlaybackCommand, initWebAudio]);

  useEffect(() => {
    dispatchPlaybackCommandRef.current = dispatchPlaybackCommand;
  }, [dispatchPlaybackCommand]);

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
      // Fire pending session upgrade immediately on entitlement change instead of
      // waiting for the 4-second timer (avoids the upgrade racing with auth load).
      const pendingUpgrade = pendingSessionUpgradeRef.current;
      if (pendingUpgrade && track?.slug === pendingUpgrade && !meta?.previewOnly) {
        pendingSessionUpgradeRef.current = null;
        void dispatchPlaybackCommandRef.current?.(PLAYBACK_COMMANDS.UPGRADE_STREAM).catch(() => {});
      }
    };
    window.addEventListener("entitlements:updated", onEntitlementsUpdated);
    return () => window.removeEventListener("entitlements:updated", onEntitlementsUpdated);
  }, []);

  const setQueue = useCallback(
    (tracks = [], startIndex = 0) =>
      dispatchPlaybackCommand(PLAYBACK_COMMANDS.SET_QUEUE, { tracks, startIndex }),
    [dispatchPlaybackCommand]
  );

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
        extra: {
          slug: track?.slug ?? null,
          msSinceVisibility,
          scenario: options?.playbackScenario ?? null,
        },
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
    return dispatchPlaybackCommand(
      PLAYBACK_COMMANDS.PLAY_TRACK,
      { track, options },
      { serial: true, cancelActiveStream: true }
    );
  }, [dispatchPlaybackCommand, initWebAudio]);

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
    return dispatchPlaybackCommand(
      PLAYBACK_COMMANDS.PLAY_QUEUE,
      {
        tracks,
        startIndex,
        options: { ...options, preserveActiveStream: sameQueue },
      },
      { serial: true, cancelActiveStream: !sameQueue }
    );
  }, [dispatchPlaybackCommand, initWebAudio]);

  const playNext = useCallback(() => {
    resetPlaybackTimingCapture();
    setPlaybackScenario(PLAYBACK_SCENARIOS.TRACK_SKIP, { manualSkip: true, commandType: PLAYBACK_COMMANDS.NEXT_TRACK });
    perfMark(MARKS.PLAYBACK_TAP);
    initWebAudio();
    resumeWebAudioContextFromUserGesture(audioCtxRef, "playNext:gesture");
    return dispatchPlaybackCommand(PLAYBACK_COMMANDS.NEXT_TRACK);
  }, [dispatchPlaybackCommand, initWebAudio]);
  const pause = useCallback(() => dispatchPlaybackCommand(PLAYBACK_COMMANDS.PAUSE), [dispatchPlaybackCommand]);
  const resume = useCallback(() => {
    initWebAudio();
    resumeWebAudioContextFromUserGesture(audioCtxRef, "resume:gesture");
    return dispatchPlaybackCommand(PLAYBACK_COMMANDS.RESUME);
  }, [dispatchPlaybackCommand, initWebAudio]);
  const seek = useCallback((time) => dispatchPlaybackCommand(PLAYBACK_COMMANDS.SEEK, { time }, { serial: false }), [dispatchPlaybackCommand]);
  const playPrevious = useCallback(() => dispatchPlaybackCommand(PLAYBACK_COMMANDS.PREV_TRACK), [dispatchPlaybackCommand]);
  const stop = useCallback(() => dispatchPlaybackCommand(PLAYBACK_COMMANDS.STOP, {}, { cancelActiveStream: true }), [dispatchPlaybackCommand]);

  const enqueueTrack = useCallback((track, { playNext = false } = {}) => {
    const normalized = normalizeTrack(track);
    if (!normalized?.src) return;
    const current = [...queueRef.current];
    if (!current.length) {
      queueRef.current = [normalized];
      queueIndexRef.current = 0;
      startTransition(() => patchState({ queue: [normalized], queueIndex: 0 }));
      return;
    }
    if (playNext) {
      const insertAt = Math.max(0, queueIndexRef.current + 1);
      current.splice(insertAt, 0, normalized);
    } else {
      current.push(normalized);
    }
    queueRef.current = current;
    startTransition(() => patchState({ queue: current }));
  }, [patchState]);

  const removeFromQueue = useCallback((index) => {
    const current = [...queueRef.current];
    if (index < 0 || index >= current.length) return;
    if (index === queueIndexRef.current) return;
    current.splice(index, 1);
    const newIndex = index < queueIndexRef.current ? queueIndexRef.current - 1 : queueIndexRef.current;
    queueRef.current = current;
    queueIndexRef.current = newIndex;
    startTransition(() => patchState({ queue: current, queueIndex: newIndex }));
  }, [patchState]);

  const setSleepTimer = useCallback((minutes) => {
    if (!minutes || minutes <= 0) {
      sleepTimerRef.current = { endsAt: null, afterCurrentTrack: false };
      setSleepTimerEndsAt(null);
      setSleepAfterCurrentTrack(false);
      return;
    }
    if (minutes === "end_of_track") {
      sleepTimerRef.current = { endsAt: null, afterCurrentTrack: true };
      setSleepTimerEndsAt(null);
      setSleepAfterCurrentTrack(true);
      return;
    }
    const endsAt = Date.now() + minutes * 60 * 1000;
    sleepTimerRef.current = { endsAt, afterCurrentTrack: false };
    setSleepTimerEndsAt(endsAt);
    setSleepAfterCurrentTrack(false);
  }, []);

  const toggle = useCallback(() => {
    if (audioRef.current?.paused) return resume();
    pause();
    return false;
  }, [pause, resume]);

  useEffect(() => {
    playTrackRef.current = playTrack;
    applyCSModeToTrackRef.current = applyCSModeToTrack;
  }, [applyCSModeToTrack, playTrack]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return undefined;
    const ms = navigator.mediaSession;
    const handlePlay = () => {
      void resume();
    };
    const handlePause = () => {
      pause();
    };
    const handleNext = () => {
      void playNext();
    };
    const handlePrev = () => {
      void playPrevious();
    };
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
      ms.setActionHandler("stop", () => {
        stop();
      });
      ms.setActionHandler("seekbackward", (details) => {
        const skipTime = details?.seekOffset ?? 10;
        seek(Math.max(0, (audioRef.current?.currentTime || 0) - skipTime));
      });
      ms.setActionHandler("seekforward", (details) => {
        const skipTime = details?.seekOffset ?? 10;
        const dur = audioRef.current?.duration || 0;
        seek(Math.min(dur, (audioRef.current?.currentTime || 0) + skipTime));
      });
      try {
        ms.setActionHandler("togglemicrophone", () => {
          void toggleCSMode();
        });
      } catch {
        /* togglemicrophone not supported */
      }
    } catch {
      /* action handler not supported */
    }
    return () => {
      try {
        ms.setActionHandler("play", null);
        ms.setActionHandler("pause", null);
        ms.setActionHandler("previoustrack", null);
        ms.setActionHandler("nexttrack", null);
        ms.setActionHandler("seekto", null);
        ms.setActionHandler("stop", null);
        ms.setActionHandler("seekbackward", null);
        ms.setActionHandler("seekforward", null);
        ms.setActionHandler("togglemicrophone", null);
      } catch {
        /* ignore */
      }
    };
  }, [pause, resume, playNext, playPrevious, seek, stop, toggleCSMode, tracePlayback]);

  // Screen wake lock — keeps display active during playback so iOS/Android don't
  // throttle timers or suspend the audio pipeline when the screen dims.
  // Acquired on play, released on pause/stop. Re-acquired on visibility return if
  // still playing (lock is automatically released when the tab is hidden).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    const acquire = async () => {
      if (wakeLockRef.current) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener("release", () => {
          wakeLockRef.current = null;
        });
      } catch {
        /* wake lock denied (battery saver, permissions) — non-fatal */
      }
    };
    const release = () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
    if (state.isPlaying) {
      void acquire();
    } else {
      release();
    }
    return release;
  }, [state.isPlaying]);

  // Re-acquire after tab returns to visible (browser releases lock on hide).
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
              // Discard if the track changed while the tab was hidden
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

        // If audio was stalled while hidden (iOS throttles timers in background),
        // the soft/hard recovery timers may not have fired. Re-arm immediately so
        // the user hears audio resume within 1s of returning to the tab.
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
                  patchState({
                    error: "Tap play to continue.",
                    isPlaying: false,
                    playbackState: "paused",
                  });
                }
                armLifecycleRecoverySuppression(
                  "visibility_return",
                  "gesture_unlock_required"
                );
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
          (s.isPlaying && !userPausedRef.current);
        wasPlayingBeforeHideRef.current = false;
        const resumeAfter =
          wasPlaying && !userPausedRef.current && isEntitledFullPlaybackTrack(track);
        const health = evaluateLifecyclePlaybackHealth({
          resumeAfter,
          lifecycleIntent: wasPlaying,
        });
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

  // Proactive offline detection: rather than waiting for a stream error (7–10s lag),
  // listen for the browser's connectivity events and suppress stall recovery while offline.
  // When connectivity is restored, attempt seamless resume from the last known position.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOffline = () => {
      const audio = audioRef.current;
      const isCurrentlyPlaying = stateRef.current.isPlaying && audio && !audio.paused;
      // Suppress stall recovery — retrying without a network connection is wasteful.
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
      // Only auto-resume if the user hadn't manually paused and we were playing.
      if (
        !userPausedRef.current &&
        track &&
        audio &&
        (stateRef.current.isPlaying || stateRef.current.error === "RECONNECTING")
      ) {
        streamErrorRetriedRef.current = false;
        patchState({ error: null, isBuffering: true });
        void playTrackRef.current?.(track, {
          resumeAt: audio.currentTime || 0,
          forceStream: true,
        });
      } else if (stateRef.current.error === "RECONNECTING") {
        // Was offline but user had paused — clear the reconnecting error.
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
      if (csHoldSavedRef.current?.wasPlaying) {
        await playAudioIfNotPaused(audio, true, {
          command: "CS_HOLD_PREVIEW",
          requestId: activeCommandRef.current?.requestId || null,
          state: stateRef.current,
          context: { source: stateRef.current?.source || null },
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
        if (saved.wasPlaying && audio.paused) {
          await playAudioIfNotPaused(audio, true, {
            command: "CS_HOLD_END",
            requestId: activeCommandRef.current?.requestId || null,
            state: stateRef.current,
            context: { source: stateRef.current?.source || null },
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
    }

    csHoldActiveRef.current = false;
    csHoldSavedRef.current = null;
  }, []);

  const playbackOrchestrationState = useSyncExternalStore(
    (onStoreChange) => playbackStateMachine.subscribe(() => onStoreChange()),
    () => playbackStateMachine.getState(),
    () => playbackStateMachine.getState()
  );

  const value = useMemo(() => {
    const {
      currentTime: _progressTime,
      playbackNetworkState: _network,
      isBuffering: _buffering,
      ...playbackState
    } = state;
    const transport = transportSnapshotRef.current;
    return {
      ...playbackState,
      playbackNetworkState: transport.playbackNetworkState,
      isBuffering: transport.isBuffering,
      playbackOrchestrationState,
      subscribePlaybackOrchestration: playbackStateMachine.subscribe,
      playTrack,
      playQueue,
      setQueue,
      dispatchPlaybackCommand,
      playNext,
      playPrevious,
      setRepeatMode,
      toggleRepeat,
      setShuffle,
      toggleShuffle,
      toggleCSMode,
      suppressPauseInterruptionRef: skipPauseInterruptionRef,
      pause,
      pauseForViewport,
      enterAudioVisualViewport,
      exitAudioVisualViewport,
      getCurrentPlaybackSnapshot,
      resumeTrackAtPosition,
      resume,
      toggle,
      seek,
      seekBack,
      seekForward,
      stop,
      audioRef,
      overrideConcurrentStream,
      dismissStreamConflict,
      retryStreamPlayback,
      resumePlaybackTransport,
      storeLinkHref: STORE_LINK_HREF,
      beginCsHoldPreview,
      setCsHoldPlaybackRate,
      endCsHoldPreview,
      upgradeToFullStream,
      setOnPreviewEnded,
      previewEnded,
      setPreviewEnded,
      toggleSpaceMode,
      toggleBassBoost,
      cycleAtmosphere,
      getAnalyser: () => (webAudioAvailableRef.current ? analyserRef.current : null),
      getCurrentTime: () => stateRef.current.currentTime ?? 0,
      getIsAudiblyPlaying: readIsAudiblyPlaying,
      setSleepTimer,
      sleepTimerEndsAt,
      sleepAfterCurrentTrack,
      enqueueTrack,
      removeFromQueue,
      continuityFrozen,
      getContinuitySnapshot,
      clearContinuityFreeze,
      subscribeProgress,
      getProgressSnapshot,
      subscribeTransport,
      getTransportSnapshot,
      subscribeIdentity,
      getIdentitySnapshot,
    };
  }, [
    pause,
    pauseForViewport,
    enterAudioVisualViewport,
    exitAudioVisualViewport,
    getCurrentPlaybackSnapshot,
    resumeTrackAtPosition,
    dispatchPlaybackCommand,
    playQueue,
    playTrack,
    playNext,
    playPrevious,
    resume,
    seek,
    seekBack,
    seekForward,
    setQueue,
    setRepeatMode,
    setShuffle,
    state,
    playbackOrchestrationState,
    stop,
    toggle,
    toggleRepeat,
    toggleShuffle,
    toggleCSMode,
    overrideConcurrentStream,
    dismissStreamConflict,
    retryStreamPlayback,
    resumePlaybackTransport,
    beginCsHoldPreview,
    setCsHoldPlaybackRate,
    endCsHoldPreview,
    upgradeToFullStream,
    setOnPreviewEnded,
    previewEnded,
    setPreviewEnded,
    toggleSpaceMode,
    toggleBassBoost,
    cycleAtmosphere,
    readIsAudiblyPlaying,
    setSleepTimer,
    sleepTimerEndsAt,
    sleepAfterCurrentTrack,
    enqueueTrack,
    removeFromQueue,
    subscribeProgress,
    getProgressSnapshot,
    getContinuitySnapshot,
    clearContinuityFreeze,
    subscribeTransport,
    getTransportSnapshot,
    subscribeIdentity,
    getIdentitySnapshot,
  ]);

  useEffect(() => () => {
    stopProgressRaf();
    stopKeepAlivePing();
    stopPositionSaveTimer();
    if (swellIntervalRef.current) {
      cancelAnimationFrame(swellIntervalRef.current);
      swellIntervalRef.current = null;
    }
    if (nextTrackPreloadRef.current) {
      nextTrackPreloadRef.current.src = "";
      nextTrackPreloadRef.current.load();
    }
    if (streamSwapPreloadRef.current) {
      streamSwapPreloadRef.current.src = "";
      streamSwapPreloadRef.current.load();
    }
    if (queueWatchdogRef.current) {
      clearTimeout(queueWatchdogRef.current);
      queueWatchdogRef.current = null;
    }
    if (activeStreamAbortRef.current) {
      activeStreamAbortRef.current.abort();
      activeStreamAbortRef.current = null;
    }
  }, [stopProgressRaf, stopKeepAlivePing, stopPositionSaveTimer]);

  if (isPlaybackTraceEnabled()) {
    renderCountRef.current += 1;
    const traceAudio = audioRef.current;
    if (state.isPlaying && traceAudio?.paused) {
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
    } else if (
      changed.some((k) => k === "authLoading" || k === "userId" || k === "entitlementUserId")
    ) {
      reasonGuess = changed.includes("entitlementUserId") ? "entitlement" : "auth";
    } else if (
      changed.length > 0 &&
      changed.every((k) =>
        ["isPlaying", "playbackState", "currentTrackId", "queueLen"].includes(k)
      )
    ) {
      reasonGuess = "playback";
    }
    const authOnlyChurn =
      changed.length > 0 &&
      changed.every((k) => ["authLoading", "userId", "entitlementUserId"].includes(k));

    if (authOnlyChurn) {
      logPlaybackRenderNoImpact({
        renderCount: renderCountRef.current,
        reasonGuess,
        changed,
        deps,
      });
    } else if (changed.length > 0 || renderCountRef.current <= 2) {
      logAudioProviderRender({
        renderCount: renderCountRef.current,
        reasonGuess,
        changed,
        deps,
      });
    }
  }

  return (
    <AudioContext.Provider value={value}>
      <AudioPhase10Bridge />
      <AudioProviderSubtree>{children}</AudioProviderSubtree>
    </AudioContext.Provider>
  );
}

export function useAudioPlayer() {
  const value = useContext(AudioContext);
  if (!value) {
    throw new Error("useAudioPlayer must be used within AudioProvider");
  }
  return value;
}

const SERVER_PLAYBACK_PROGRESS_SNAPSHOT = Object.freeze({
  currentTime: 0,
  duration: 0,
});

/** Subscribe to high-frequency playback progress without re-rendering the full AudioContext tree. */
export function usePlaybackProgress() {
  const { subscribeProgress, getProgressSnapshot } = useAudioPlayer();
  return useSyncExternalStore(
    subscribeProgress,
    getProgressSnapshot,
    () => SERVER_PLAYBACK_PROGRESS_SNAPSHOT
  );
}

const SERVER_PLAYBACK_TRANSPORT_SNAPSHOT = Object.freeze({
  playbackNetworkState: "idle",
  isBuffering: false,
});

/** Transport/network fields without AudioProvider reconcile (Phase P1). */
export function usePlaybackTransport() {
  const { subscribeTransport, getTransportSnapshot } = useAudioPlayer();
  return useSyncExternalStore(
    subscribeTransport,
    getTransportSnapshot,
    () => SERVER_PLAYBACK_TRANSPORT_SNAPSHOT
  );
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
  return useSyncExternalStore(
    subscribeIdentity,
    getIdentitySnapshot,
    () => SERVER_PLAYBACK_IDENTITY_SNAPSHOT
  );
}
