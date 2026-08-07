/**
 * Web Audio API context resume/running utilities.
 * Extracted verbatim from AudioContext.js (lines 612–679).
 * Pure functions — no React, no component state.
 */

import {
  isPlaybackTraceEnabled,
  logAudioContextStateChange,
} from "@/lib/diagnostics/playback-trace";

/**
 * Invoke AudioContext.resume() synchronously inside a user gesture (no await before call).
 * iOS rejects or defers resume when resume() is first reached after queue/stream awaits.
 */
function resumeWebAudioContextFromUserGesture(ctxRef, source = "resumeWebAudioContextFromUserGesture") {
  const ctx = ctxRef?.current;
  if (!ctx || ctx.state === "running" || ctx.state === "closed") return false;
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
  if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
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

export {
  resumeWebAudioContextFromUserGesture,
  resumeWebAudioContextIfSuspended,
  ensureWebAudioRunning,
};
