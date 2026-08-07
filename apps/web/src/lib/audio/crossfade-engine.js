/**
 * Crossfade Engine — extracted from AudioContext.js.
 *
 * All functions accept a refs bag (no React dependencies) so they can be
 * called from any module or tested in isolation without mounting a React tree.
 *
 * The crossfade state machine has three states:
 *   "idle"     — no crossfade in progress
 *   "fading"   — main track fading out, pre-buffered next track fading in
 *   "bridging" — crossfade complete, next track is now the main track
 *
 * AudioContext.js delegates all crossfade mutations here; it retains ownership
 * of the refs themselves.
 */

const CROSSFADE_SEC = 5;

// Equal-power crossfade curves — precomputed once at module load.
// Linear amplitude ramps produce a −3 dB perceived loudness dip at the midpoint
// because RMS power is not preserved. Equal-power crossfade uses cosine² curves
// where gain_A² + gain_B² = 1 at every point, preserving perceived loudness.
//
//   Track A (fading out): cos²(t·π/2)   — starts at 1, ends at 0
//   Track B (fading in):  sin²(t·π/2)   — starts at 0, ends at 1
//
// 128 samples is sufficient resolution for any crossfade duration ≥ 1 s.
const CROSSFADE_CURVE_SAMPLES = 128;
const CROSSFADE_FADE_OUT_CURVE = (() => {
  const curve = new Float32Array(CROSSFADE_CURVE_SAMPLES);
  for (let i = 0; i < CROSSFADE_CURVE_SAMPLES; i++) {
    const angle = (i / (CROSSFADE_CURVE_SAMPLES - 1)) * (Math.PI / 2);
    curve[i] = Math.cos(angle) * Math.cos(angle);
  }
  return curve;
})();
const CROSSFADE_FADE_IN_CURVE = (() => {
  const curve = new Float32Array(CROSSFADE_CURVE_SAMPLES);
  for (let i = 0; i < CROSSFADE_CURVE_SAMPLES; i++) {
    const angle = (i / (CROSSFADE_CURVE_SAMPLES - 1)) * (Math.PI / 2);
    curve[i] = Math.sin(angle) * Math.sin(angle);
  }
  return curve;
})();

/**
 * Cancel any active crossfade and restore main gain to the current track level.
 * Safe to call at any state — no-ops when already idle.
 *
 * @param {object} refs
 * @param {import("react").MutableRefObject<string>} refs.crossfadeStateRef
 * @param {import("react").MutableRefObject<HTMLAudioElement|null>} refs.nextTrackPreloadRef
 * @param {import("react").MutableRefObject<AudioContext|null>} refs.audioCtxRef
 * @param {import("react").MutableRefObject<GainNode|null>} refs.mainGainRef
 * @param {import("react").MutableRefObject<GainNode|null>} refs.crossfadeGainRef
 * @param {import("react").MutableRefObject<number>} refs.trackGainRef
 */
export function cancelCrossfadeEngine(refs) {
  const { crossfadeStateRef, nextTrackPreloadRef, audioCtxRef, mainGainRef, crossfadeGainRef, trackGainRef } = refs;
  if (crossfadeStateRef.current === "idle") return;
  crossfadeStateRef.current = "idle";

  const nextEl = nextTrackPreloadRef.current;
  try { if (nextEl && !nextEl.paused) nextEl.pause(); } catch {}
  try { if (nextEl) nextEl.currentTime = 0; } catch {}

  const ctx = audioCtxRef.current;
  if (ctx && ctx.state !== "closed") {
    const now = ctx.currentTime;
    try {
      mainGainRef.current?.gain.cancelScheduledValues(now);
      mainGainRef.current?.gain.setValueAtTime(trackGainRef.current, now);
    } catch {}
    try {
      crossfadeGainRef.current?.gain.cancelScheduledValues(now);
      crossfadeGainRef.current?.gain.setValueAtTime(0, now);
    } catch {}
  }
}

/**
 * Attempt to start a crossfade from the current track to the next track in queue.
 * Checks all preconditions; returns false if crossfade cannot start.
 *
 * Called from the AudioContext timeupdate handler once per tick when near end of track.
 *
 * @param {object} refs
 * @param {import("react").MutableRefObject<string>} refs.crossfadeStateRef
 * @param {import("react").MutableRefObject<AudioContext|null>} refs.audioCtxRef
 * @param {import("react").MutableRefObject<GainNode|null>} refs.mainGainRef
 * @param {import("react").MutableRefObject<GainNode|null>} refs.crossfadeGainRef
 * @param {import("react").MutableRefObject<HTMLAudioElement|null>} refs.nextTrackPreloadRef
 * @param {import("react").MutableRefObject<number>} refs.trackGainRef
 * @param {object} args
 * @param {number} args.rem  Seconds remaining in current track.
 * @param {number} args.dur  Total track duration in seconds.
 * @param {object|null} args.nextTrack  Next track in queue (with src and gainDb).
 * @param {boolean} args.previewOnly    True when current track is a preview clip.
 * @param {string} [args.repeatMode]    Current repeat mode ("off" | "one" | "all").
 * @returns {boolean} True if crossfade was initiated.
 */
export function triggerCrossfadeIfReady(refs, { rem, dur, nextTrack, previewOnly, repeatMode }) {
  const { crossfadeStateRef, audioCtxRef, mainGainRef, crossfadeGainRef, nextTrackPreloadRef, trackGainRef } = refs;

  if (crossfadeStateRef.current !== "idle") return false;
  if (previewOnly) return false;
  if (repeatMode === "one") return false;
  if (!mainGainRef.current || !crossfadeGainRef.current) return false;
  if (audioCtxRef.current?.state !== "running") return false;
  if (rem <= 0 || rem > CROSSFADE_SEC || dur <= CROSSFADE_SEC * 2) return false;
  if (!nextTrack?.src) return false;

  const nextEl = nextTrackPreloadRef.current;
  if (!nextEl || !nextEl.src || nextEl.readyState < 3) return false;

  crossfadeStateRef.current = "fading";
  const ctx = audioCtxRef.current;
  const now = ctx.currentTime;
  const mGain = mainGainRef.current;
  const cfGain = crossfadeGainRef.current;
  const nextTrackGainLinear = Math.pow(10, (nextTrack.gainDb || 0) / 20);

  // Equal-power crossfade: cos²/sin² curves so gain_A² + gain_B² = 1 at every
  // point, preserving perceived loudness. setValueCurveAtTime replaces the curve
  // array in-place, so we pass the shared module-level arrays directly.
  // Clamp the outgoing gain to [0, 1] before the fade — if a preview-fade ramp
  // left mainGain below 1, the curve starts from that suppressed value and the
  // fade-out is audibly wrong. setValueAtTime pins it to 1 first.
  const clampedCurrent = Math.min(1, Math.max(0, mGain.gain.value));
  mGain.gain.cancelScheduledValues(now);
  mGain.gain.setValueAtTime(clampedCurrent, now);
  // Scale the fade-out curve by the current mainGain value so it starts exactly
  // where the gain currently sits (accounts for per-track normalization).
  if (clampedCurrent === 1) {
    mGain.gain.setValueCurveAtTime(CROSSFADE_FADE_OUT_CURVE, now, rem);
  } else {
    // Build a scaled copy when the starting gain != 1 (rare but correct).
    const scaled = new Float32Array(CROSSFADE_CURVE_SAMPLES);
    for (let i = 0; i < CROSSFADE_CURVE_SAMPLES; i++) scaled[i] = CROSSFADE_FADE_OUT_CURVE[i] * clampedCurrent;
    mGain.gain.setValueCurveAtTime(scaled, now, rem);
  }

  cfGain.gain.cancelScheduledValues(now);
  cfGain.gain.setValueAtTime(0, now);
  // Scale the fade-in curve by the next track's loudness-normalized gain so the
  // incoming track arrives at its correct playback level, not always at 1.0.
  if (nextTrackGainLinear === 1) {
    cfGain.gain.setValueCurveAtTime(CROSSFADE_FADE_IN_CURVE, now, rem);
  } else {
    const scaled = new Float32Array(CROSSFADE_CURVE_SAMPLES);
    for (let i = 0; i < CROSSFADE_CURVE_SAMPLES; i++) scaled[i] = CROSSFADE_FADE_IN_CURVE[i] * nextTrackGainLinear;
    cfGain.gain.setValueCurveAtTime(scaled, now, rem);
  }

  nextEl.currentTime = 0;
  nextEl.play().catch(() => {
    const t = audioCtxRef.current?.currentTime ?? 0;
    try { mGain.gain.cancelScheduledValues(t); mGain.gain.setValueAtTime(trackGainRef.current, t); } catch {}
    try { cfGain.gain.cancelScheduledValues(t); cfGain.gain.setValueAtTime(0, t); } catch {}
    crossfadeStateRef.current = "idle";
  });

  return true;
}

/**
 * Complete the fading → bridging transition.
 * Called when the crossfade pre-buffer element fires onEnded / timeupdate
 * and we know the current audio element has ended its fade-out window.
 *
 * @param {object} refs  Same refs bag as triggerCrossfadeIfReady.
 * @param {object} args
 * @param {number} args.nextTrackGainLinear  Loudness-normalized gain for the incoming track.
 * @returns {boolean} True if state was transitioned from fading → bridging.
 */
export function completeCrossfadeBridge(refs, { nextTrackGainLinear }) {
  const { crossfadeStateRef, audioCtxRef, mainGainRef, crossfadeGainRef, trackGainRef } = refs;
  if (crossfadeStateRef.current !== "fading") return false;

  crossfadeStateRef.current = "bridging";
  const ctx = audioCtxRef.current;
  if (ctx && ctx.state !== "closed") {
    const now = ctx.currentTime;
    try {
      mainGainRef.current?.gain.cancelScheduledValues(now);
      mainGainRef.current?.gain.setValueAtTime(0, now);
    } catch {}
    try {
      crossfadeGainRef.current?.gain.cancelScheduledValues(now);
      crossfadeGainRef.current?.gain.setValueAtTime(nextTrackGainLinear ?? trackGainRef.current, now);
    } catch {}
  }
  return true;
}

/**
 * True if a crossfade is in any active (non-idle) state.
 * @param {import("react").MutableRefObject<string>} crossfadeStateRef
 */
export function isCrossfadeActive(crossfadeStateRef) {
  return crossfadeStateRef.current !== "idle";
}

/** The fixed crossfade window in seconds — exported so callers can apply the same guard. */
export const CROSSFADE_WINDOW_SEC = CROSSFADE_SEC;
