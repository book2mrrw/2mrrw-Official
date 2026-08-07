/**
 * Playback transport health and lifecycle reason classification.
 * Extracted verbatim from AudioContext.js (lines 536–605).
 * Pure functions — no React, no refs, no component state.
 */

/** True when the page is hidden (background tab / lock screen). */
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

export {
  isDocumentPlaybackHidden,
  hasIntactPlaybackTransport,
  evaluatePlaybackTransportHealth,
  isGenuineTransportFailureReason,
  isLifecycleInterruptReason,
};
