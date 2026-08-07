/**
 * Miscellaneous playback utilities.
 * Extracted verbatim from AudioContext.js (lines 313–356, 860–866).
 */

import { PLAYBACK_COMMANDS } from "@/lib/playback/playback-commands";
import { PLAYBACK_SCENARIOS } from "@/lib/dev/performanceMarks";
import { isSamePlaybackTrack } from "@/lib/music-playback";
import { normalizePlaybackSrc } from "@/lib/audio/audio-element-utils";

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

function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true
  );
}

export { inferPlaybackScenario, isStandalonePwa };
