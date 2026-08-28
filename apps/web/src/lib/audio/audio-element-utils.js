/**
 * Audio element utilities.
 * Extracted verbatim from AudioContext.js (lines 272–295, 359–534, 681–709).
 * Pure functions — no React, no component state. Constants re-exported for AudioContext.js.
 */

import { MARKS, perfMark } from "@/lib/dev/performanceMarks";
import { isPlaybackTraceEnabled, logStreamLifecycle } from "@/lib/diagnostics/playback-trace";
import {
  parseStreamSlugFromSrc,
  isLibraryStreamSrc,
} from "@/lib/playback/stream-client";
import { createPlaybackError } from "@/lib/playback/playback-errors";
import { reportPlaybackDiagnostic } from "@/lib/playback/playback-diagnostics";
import { catalogPreviewAudioUrl } from "@/lib/media-urls";
import { isSiteApiMediaPath } from "@/lib/media/site-api-url";
import {
  PhysicalEffectAuthorityMode,
  getCurrentPhysicalEffectGuard,
} from "@/lib/audio/physical-effect-authority";

export const RESTORE_MIN_POSITION_SEC = 5;
export const RESTORE_NEAR_END_BUFFER_SEC = 3;
export const AUDIO_SRC_READY_TIMEOUT_MS = 12000;
export const PHYSICAL_EFFECT_BECOME_AUDIBLE = "BECOME_AUDIBLE";

/**
 * Generic, injected physical-effect guard. This module deliberately knows
 * nothing about Playback Core; it only evaluates the opaque authority and
 * read-only predicate supplied by the caller.
 *
 * Legacy behavior must be explicitly classified. An unclassified, partially
 * installed, or broken protected path fails closed.
 */
function canBecomeAudible({
  effectAuthorityMode = null,
  effectGuardRequired = false,
  effectAuthority,
  canApplyEffect,
  mediaIdentity,
  command,
  requestId,
  state,
  context,
} = {}) {
  const hasAuthority = effectAuthority != null;
  const hasGuard = typeof canApplyEffect === "function";
  const isCurrentCoreEffect =
    effectAuthorityMode === PhysicalEffectAuthorityMode.CORE_CURRENT;
  const isCapturedCoreEffect =
    effectAuthorityMode === PhysicalEffectAuthorityMode.CORE || effectGuardRequired;
  const resolvedMediaIdentity =
    mediaIdentity ??
    state?.currentTrack?.id ??
    state?.currentTrack?.trackId ??
    state?.currentTrack?.slug ??
    null;

  if (isCurrentCoreEffect) {
    const currentGuard = getCurrentPhysicalEffectGuard();
    if (!currentGuard) {
      reportPlaybackDiagnostic({
        level: "error",
        code: "PHYSICAL_EFFECT_GUARD_UNAVAILABLE",
        command: command || "PLAY",
        requestId: requestId ?? null,
        state,
        context: {
          effectType: PHYSICAL_EFFECT_BECOME_AUDIBLE,
          mediaIdentity: resolvedMediaIdentity,
          authorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
          ...(context || {}),
        },
      });
      return false;
    }
    try {
      const allowed = currentGuard.canApplyCurrentEffect({
        type: PHYSICAL_EFFECT_BECOME_AUDIBLE,
        mediaIdentity: resolvedMediaIdentity,
      });
      if (!allowed) {
        reportPlaybackDiagnostic({
          level: "warn",
          code: "PHYSICAL_EFFECT_DENIED",
          command: command || "PLAY",
          requestId: requestId ?? null,
          state,
          context: {
            effectType: PHYSICAL_EFFECT_BECOME_AUDIBLE,
            mediaIdentity: resolvedMediaIdentity,
            authorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
            ...(context || {}),
          },
        });
      }
      return Boolean(allowed);
    } catch (error) {
      reportPlaybackDiagnostic({
        level: "error",
        code: "PHYSICAL_EFFECT_GUARD_ERROR",
        command: command || "PLAY",
        requestId: requestId ?? null,
        state,
        error,
        context: {
          effectType: PHYSICAL_EFFECT_BECOME_AUDIBLE,
          mediaIdentity: resolvedMediaIdentity,
          authorityMode: PhysicalEffectAuthorityMode.CORE_CURRENT,
          ...(context || {}),
        },
      });
      return false;
    }
  }

  if (!isCapturedCoreEffect || !hasAuthority || !hasGuard) {
    reportPlaybackDiagnostic({
      level: "error",
      code: "PHYSICAL_EFFECT_GUARD_UNAVAILABLE",
      command: command || "PLAY",
      requestId: requestId ?? null,
      state,
      context: { effectType: PHYSICAL_EFFECT_BECOME_AUDIBLE, mediaIdentity: resolvedMediaIdentity, ...(context || {}) },
    });
    return false;
  }

  try {
    const allowed = canApplyEffect(effectAuthority, {
      type: PHYSICAL_EFFECT_BECOME_AUDIBLE,
      mediaIdentity: resolvedMediaIdentity,
    });
    if (!allowed) {
      reportPlaybackDiagnostic({
        level: "warn",
        code: "PHYSICAL_EFFECT_DENIED",
        command: command || "PLAY",
        requestId: requestId ?? null,
        state,
        context: { effectType: PHYSICAL_EFFECT_BECOME_AUDIBLE, mediaIdentity: resolvedMediaIdentity, ...(context || {}) },
      });
    }
    return Boolean(allowed);
  } catch (error) {
    reportPlaybackDiagnostic({
      level: "error",
      code: "PHYSICAL_EFFECT_GUARD_ERROR",
      command: command || "PLAY",
      requestId: requestId ?? null,
      state,
      error,
      context: { effectType: PHYSICAL_EFFECT_BECOME_AUDIBLE, mediaIdentity: resolvedMediaIdentity, ...(context || {}) },
    });
    return false;
  }
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

  if (sameSrc && audio.readyState >= 3) {
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
      // readyState 3 = HAVE_FUTURE_DATA — the browser has a buffer ahead.
      // readyState 2 (HAVE_CURRENT_DATA) is only one decoded frame; starting playback
      // there causes immediate buffer underruns → stutter and pitch distortion on mobile.
      if (audio.readyState >= 3) onReady();
    };
    const onMetadataReady = () => {
      perfMark(MARKS.PLAYBACK_LOADEDMETADATA);
      if (audio.readyState >= 3) onReady();
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
    if (audio.readyState >= 3) {
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
    if (audio.readyState < 3) {
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

async function loadAudioSrcAndPlay(audio, src, {
  signal,
  command,
  requestId,
  state,
  context,
  effectAuthority,
  canApplyEffect,
  effectGuardRequired,
  effectAuthorityMode,
  mediaIdentity,
} = {}) {
  await waitAudioSrcReady(audio, src, { signal });
  try {
    if (!canBecomeAudible({ effectAuthorityMode, effectGuardRequired, effectAuthority, canApplyEffect, mediaIdentity, command, requestId, state, context })) {
      return null;
    }
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

// On iOS Safari with ManagedMediaSource (hls.js), audio.play() can throw
// AbortError when hls.js makes internal SourceBuffer operations that race
// with the play() call. The element settles within ~300ms — retry resolves it.
const ABORT_RETRY_DELAY_MS = 300;
const ABORT_MAX_RETRIES = 2;

async function playAudioIfNotPaused(audio, isPlaying, {
  command,
  requestId,
  state,
  context,
  signal,
  effectAuthority,
  canApplyEffect,
  effectGuardRequired,
  effectAuthorityMode,
  mediaIdentity,
} = {}) {
  if (!isPlaying) return true;
  if (!audio.paused) return true;

  if (isPlaybackTraceEnabled()) {
    console.log("[PLAY-CHAIN] play() called", {
      command, requestId,
      readyState: audio.readyState,
      networkState: audio.networkState,
      src: audio.src ? audio.src.slice(0, 80) : null,
      buffered: audio.buffered?.length ? `${audio.buffered.end(audio.buffered.length - 1).toFixed(1)}s` : "0",
      currentTime: audio.currentTime,
    });
  }

  for (let attempt = 0; attempt <= ABORT_MAX_RETRIES; attempt++) {
    try {
      // INV-EFFECT-1: check immediately before every real play() attempt,
      // including iOS AbortError retries. Preparation above remains harmless.
      if (!canBecomeAudible({ effectAuthorityMode, effectGuardRequired, effectAuthority, canApplyEffect, mediaIdentity, command, requestId, state, context })) {
        return null;
      }
      perfMark(MARKS.PLAYBACK_AUDIO_PLAY_CALL);
      await audio.play();
      perfMark(MARKS.PLAYBACK_PLAY_PROMISE_RESOLVED);
      if (isPlaybackTraceEnabled()) {
        console.log("[PLAY-CHAIN] play() resolved OK", { command, requestId, attempt, paused: audio.paused });
      }
      return isAudioElementPlaying(audio);
    } catch (e) {
      const isAbort = e?.name === "AbortError";
      if (isPlaybackTraceEnabled()) {
        console.warn("[PLAY-CHAIN] play() rejected", {
          command, requestId, attempt, error: e?.name, message: e?.message,
          readyState: audio.readyState, signalAborted: signal?.aborted,
          willRetry: isAbort && attempt < ABORT_MAX_RETRIES && !signal?.aborted,
        });
      }
      if (isAbort && attempt < ABORT_MAX_RETRIES && !signal?.aborted) {
        // iOS: play() aborted by ManagedMediaSource internal operation.
        // Wait for canplay (element ready to play) then retry.
        await new Promise((resolve) => {
          const done = () => {
            audio.removeEventListener("canplay", onCanPlay);
            clearTimeout(tid);
            signal?.removeEventListener("abort", done);
            resolve();
          };
          const onCanPlay = () => done();
          const tid = setTimeout(done, ABORT_RETRY_DELAY_MS);
          audio.addEventListener("canplay", onCanPlay, { once: true });
          signal?.addEventListener("abort", done, { once: true });
        });
        if (signal?.aborted) break;
        continue;
      }
      reportPlaybackDiagnostic({
        level: isAbort ? "warn" : "error",
        code: "AUDIO_RESUME_FAILED",
        command: command || "PLAY",
        requestId: requestId ?? null,
        state,
        error: e,
        context: { ...context, attempt },
      });
      return false;
    }
  }
  return isAudioElementPlaying(audio);
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

export {
  normalizePlaybackSrc,
  isNearEndRestorePosition,
  clampRestorePosition,
  waitAudioSrcReady,
  waitForAudioElementReady,
  warmupSignedStreamPreload,
  isAudioElementPlaying,
  loadAudioSrcAndPlay,
  playAudioIfNotPaused,
  canBecomeAudible,
  isFlatPreviewCdnSrc,
  getTrackPreviewSrc,
  isLikelyIOS,
};
