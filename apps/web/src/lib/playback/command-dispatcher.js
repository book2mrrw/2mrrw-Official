/**
 * Module-level playback command dispatcher — lives entirely outside React.
 *
 * Single authority for all playback mutations. Serializes commands through a
 * persistent promise chain (commandQueueRef), with an emergency bypass lane for
 * STOP and PAUSE so they never wait behind a stalled stream load.
 *
 * All mutable state is accessed via runtime refs at call time. This function has
 * a permanently stable identity — callers import and call it directly.
 */

import { getAudioEngineRuntime } from "./audio-engine-runtime";
import { getPlaybackCommandBus } from "./command-bus";
import { executePlaybackCommand } from "./command-executor";
import { createPlaybackError } from "./playback-errors";
import {
  PLAYBACK_COMMANDS,
  PLAYBACK_COMMAND_ALIASES,
  USER_GESTURE_PLAYBACK_COMMANDS,
  STREAM_COMMANDS,
  EMERGENCY_BYPASS_COMMANDS,
  STREAM_ABORT_COMMANDS,
  PLAYBACK_COMMAND_TIMEOUT_MS,
  PLAYBACK_STREAM_COMMAND_TIMEOUT_MS,
  ACTIVE_COMMAND_STALE_MS,
} from "./playback-commands";
import { getWebAudioEngine } from "@/lib/audio/WebAudioEngine";
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";
import { correlateBlackscreenPlayback } from "@/lib/diagnostics/playback-trace";
import { MARKS, perfMark } from "@/lib/dev/performanceMarks";

// PLAY_QUEUE supersede counter. Increments with every PLAY_QUEUE dispatch.
// The queued run() for each command checks this at execution time — if a
// newer PLAY_QUEUE has arrived, the stale one skips immediately without
// touching audio state. Result: only the last rapid tap executes.
let _playQueueSeq = 0;

// Minimal silent WAV (RIFF header, 0 PCM samples) used as a dedicated unlock
// element for iOS gesture-time audio permission. iOS Safari requires audio.play()
// to be called synchronously within the user gesture event handler — calling it
// later (after HLS stream setup, URL resolution, etc.) loses the activation token
// on iOS 18. A separate element is used so no events fire on the main audio element
// and no real stream buffering begins before the command handler runs.
const SILENT_WAV_URI = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
let _silentUnlockEl = null;
function getSilentUnlockEl() {
  if (!_silentUnlockEl && typeof Audio !== "undefined") {
    _silentUnlockEl = new Audio(SILENT_WAV_URI);
    _silentUnlockEl.volume = 0;
  }
  return _silentUnlockEl;
}

/**
 * Dispatch a playback command through the serial command queue.
 *
 * @param {string} type  PLAYBACK_COMMANDS constant or lowercase alias.
 * @param {Record<string, any>} [payload]
 * @param {{ serial?: boolean, cancelActiveStream?: boolean }} [opts]
 * @returns {Promise<any>}
 */
export function dispatchPlaybackCommand(type, payload = {}, { serial = true, cancelActiveStream = false } = {}) {
  const {
    commandRequestIdRef,
    commandQueueRef,
    commandExecutionDepthRef,
    activeCommandRef,
    queueCircuitOpenRef,
    queueWatchdogRef,
    activeStreamAbortRef,
    initWebAudioRef,
    stateGetterRef,
  } = getAudioEngineRuntime().refs;

  const resolvedType = PLAYBACK_COMMAND_ALIASES[type] || type;
  const requestId = commandRequestIdRef.current + 1;
  commandRequestIdRef.current = requestId;
  const command = { type: resolvedType, payload, requestId, issuedAt: Date.now() };
  getPlaybackCommandBus().emit("command:issued", { type: resolvedType, requestId });

  if (USER_GESTURE_PLAYBACK_COMMANDS.has(resolvedType)) {
    // Initialize Web Audio graph synchronously inside the user gesture before
    // any await, then resume the AudioContext in the same synchronous turn.
    // iOS rejects AudioContext.resume() issued after an await.
    initWebAudioRef.current?.();
    getWebAudioEngine().resumeSync();
    // Unlock the HTML audio element for iOS gesture activation. AudioContext and
    // HTMLMediaElement are tracked as separate permissions in iOS Safari — ctx.resume()
    // alone does not grant audio.play() permission on iOS 18. Calling play() on a
    // dedicated silent element here (synchronously, before any await) grants page-wide
    // media autoplay permission that persists for all subsequent programmatic play()
    // calls on any audio element, regardless of async depth.
    getSilentUnlockEl()?.play().catch(() => {});
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
        state: stateGetterRef.current?.(),
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

    getPlaybackCommandBus().emit("command:started", { type: resolvedType, requestId });
    const commandTimeoutMs = STREAM_COMMANDS.has(resolvedType)
      ? PLAYBACK_STREAM_COMMAND_TIMEOUT_MS
      : PLAYBACK_COMMAND_TIMEOUT_MS;

    try {
      const result = await Promise.race([
        executePlaybackCommand(command),
        new Promise((_, reject) => {
          queueWatchdogRef.current = setTimeout(() => {
            getPlaybackCommandBus().emit("command:timeout", { type: resolvedType, requestId, timeoutMs: commandTimeoutMs });
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
      getPlaybackCommandBus().emit("command:completed", { type: resolvedType, requestId, result });
      return result;
    } catch (error) {
      if (error?.code === "PLAYBACK_COMMAND_TIMEOUT") {
        queueCircuitOpenRef.current = true;
      }
      getPlaybackCommandBus().emit("command:failed", {
        type: resolvedType,
        requestId,
        error: error?.message ?? String(error),
      });
      const currentState = stateGetterRef.current?.();
      reportPlaybackDiagnostic({
        code: "PLAYBACK_COMMAND_FAILED",
        command: resolvedType,
        requestId,
        state: currentState,
        error,
        context: {
          ...payload,
          visibility: typeof document !== "undefined" ? document.visibilityState : null,
          source: currentState?.source || null,
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
      const state = stateGetterRef.current?.();
      const track = state?.currentTrack;
      correlateBlackscreenPlayback(resolvedType, {
        requestId,
        trackId: track?.id ?? track?.trackId ?? track?.slug ?? null,
        isPlaying: Boolean(state?.isPlaying),
      });
    }
  };

  if (!serial) return Promise.resolve().then(run);

  if (EMERGENCY_BYPASS_COMMANDS.has(resolvedType)) {
    // Emergency lane — run immediately without waiting for the serial queue.
    // After completion, reset the circuit breaker if it tripped.
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
      state: stateGetterRef.current?.(),
    });
    commandQueueRef.current = Promise.resolve();
  }

  // Navigation commands supersede any in-progress stream load. Aborting here
  // causes the running waitAudioSrcReady to resolve instantly with AUDIO_SRC_ABORTED,
  // the active command's run() exits cleanly, and the new command starts without delay.
  if (STREAM_ABORT_COMMANDS.has(resolvedType)) {
    activeStreamAbortRef.current?.abort();
  }

  // For PLAY_QUEUE: wrap run() in a supersede guard so only the most recently
  // dispatched command actually loads a stream. Intermediate rapid-tap commands
  // skip the queue synchronously — no stream request, no timeout, no error state.
  let execFn = run;
  if (resolvedType === PLAYBACK_COMMANDS.PLAY_QUEUE) {
    const mySeq = ++_playQueueSeq;
    const original = run;
    execFn = () => {
      if (_playQueueSeq !== mySeq) {
        getPlaybackCommandBus().emit("command:superseded", { type: resolvedType, requestId });
        return null;
      }
      return original();
    };
  }

  commandQueueRef.current = commandQueueRef.current.catch(() => undefined).then(execFn);
  return commandQueueRef.current;
}
