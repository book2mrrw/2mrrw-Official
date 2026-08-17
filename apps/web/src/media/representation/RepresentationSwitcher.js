/**
 * RepresentationSwitcher — zero-gap DJ-deck handoff between audio representations.
 *
 * Architecture (per user spec):
 *   ┌─ Active deck ─────────────────────────────────────────────────────────────┐
 *   │  audioRef.current → MediaElementSourceNode → mainGain → userGain → ...   │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *   ┌─ Standby deck (RepresentationDeck) ──────────────────────────────────────┐
 *   │  standbyEl → standbySource → _standbyGain (gain=0) → userGain → ...      │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *
 * Handoff sequence (switchTo):
 *   1. Load + position standby via HLS startPosition  [LOADING]
 *   2. Destination readiness gate — canplay + buffered confirmation [AWAITING_READINESS]
 *   3. Musical alignment verification — correct drift > 100ms
 *   4. Equal-power crossfade via AudioParam automation (~30ms) [CROSSFADING]
 *   5. completeCrossfade() — swap JS deck identities, re-wire DOM listeners
 *   6. Update runtime refs (audioRef, hlsEngineRef, HLS module singleton)
 *   7. Recycle old active as next standby placeholder  [IDLE]
 *
 * Rapid reversal (latest intent wins):
 *   - Each switchTo() increments _transitionId.  Stale async continuations abort on mismatch.
 *   - If CROSSFADING when a new switchTo() fires: cancelCrossfade() first, then new cycle.
 *
 * 38ms settle timer (Part 2 — timer safety analysis):
 *   The crossfade AudioParam ramp is scheduled against AudioContext.currentTime and executes
 *   on the audio rendering thread, completely independent of JavaScript timing.  The 38ms
 *   setTimeout only determines when we call completeCrossfade() to commit JS state.
 *
 *   If timer fires LATE (background tab throttling — up to 1000ms):
 *     The 30ms ramp has already completed on the audio thread.  The subsequent
 *     completeCrossfade() snap is a no-op (gains are already at target values).
 *     Audio is CORRECT.  Only the JS state commit (audioRef.current swap) is delayed.
 *     During this window, progress UI and seek operations target the wrong element.
 *     Acceptable limitation for background-tab use cases.
 *
 *   If timer fires EARLY (not expected in production — browsers don't fire before deadline):
 *     completeCrossfade() snaps gains via cancelScheduledValues + setValueAtTime, which
 *     supersedes any in-progress ramp on the audio thread.  CROSSFADE_SETTLE_MS=8ms buffer
 *     provides headroom against sub-ms timer variance in foreground tabs.
 *
 *   Audio correctness does NOT depend on 38ms precision.  The audio thread governs the
 *   transition; the timer governs only when JS bookkeeping commits.
 *
 * Not yet wired to the representation model (Wave 1–10). Consumers call switchTo() directly
 * with a pre-resolved manifest URL and musical position.
 */

import { getWebAudioEngine }          from "@/lib/audio/WebAudioEngine";
import { getAudioEngineRefs }         from "@/lib/playback/audio-engine-runtime";
import { setActiveHLSEngine }         from "@/lib/audio/HLSEngine";
import { RepresentationDeck }         from "./RepresentationDeck";
import {
  playbackStateMachine,
  PLAYBACK_ORCHESTRATION_EVENTS,
} from "@/media/PlaybackStateMachine";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Starting crossfade estimate per spec.  Tunable once telemetry is wired. */
const CROSSFADE_SEC = 0.03;

/** Extra ms buffer after the scheduled ramp before we snap+swap. */
const CROSSFADE_SETTLE_MS = 8;

/** Drift threshold: re-seek standby if it wandered more than this from targetSec. */
const DRIFT_CORRECTION_SEC = 0.1;

/** Telemetry tag for transition outcome logging. */
const LOG_TAG = "[RepresentationSwitcher]";

/** Dev-mode diagnostic logging.  No-ops in production. */
const DEV = typeof process !== "undefined" && process.env.NODE_ENV !== "production";
function _diag(phase, data) {
  if (DEV) console.debug(LOG_TAG, `[${phase}]`, data ?? "");
}

// ── State ─────────────────────────────────────────────────────────────────────

export const SWITCHER_STATE = Object.freeze({
  IDLE:               "idle",
  LOADING:            "loading",
  AWAITING_READINESS: "awaiting_readiness",
  CROSSFADING:        "crossfading",
  RECYCLING:          "recycling",
});

/**
 * Explicit handoff result codes — richer than boolean for telemetry and retry logic.
 *   COMPLETE    — crossfade finished, new active is playing
 *   NOT_READY   — standby timed out; active deck kept playing unchanged
 *   ABORTED     — caller called abort() before completion
 *   SUPERSEDED  — a newer switchTo() arrived; this one was abandoned
 *   FAILED      — unexpected error (load failure, missing engine, etc.)
 */
export const HANDOFF_RESULT = Object.freeze({
  COMPLETE:   "complete",
  NOT_READY:  "not_ready",
  ABORTED:    "aborted",
  SUPERSEDED: "superseded",
  FAILED:     "failed",
});

// ── Class ─────────────────────────────────────────────────────────────────────

class RepresentationSwitcher {
  constructor() {
    /** @type {keyof typeof SWITCHER_STATE} */
    this._state = SWITCHER_STATE.IDLE;

    /** @type {RepresentationDeck|null} The current standby deck (null when idle). */
    this._standby = null;

    /**
     * Monotonically increasing transition ID.  Every switchTo() increments this.
     * In-flight continuations abort when their captured ID no longer matches.
     */
    this._transitionId = 0;

    /**
     * Active deck normalization gain captured immediately before startCrossfade().
     * Used by cancelCrossfade() / reversal to restore the correct active gain.
     * Reading mainGain.gain.value DURING a crossfade returns a ramp intermediate
     * (possibly 0 after the ramp completes) — NOT the original normalization gain.
     */
    this._preCrossfadeActiveGain = null;

    /**
     * Optional callback fired after each successful deck swap.
     * Signature: (newActiveEl: HTMLAudioElement, oldActiveEl: HTMLAudioElement) => void
     * @type {((newEl: HTMLAudioElement, oldEl: HTMLAudioElement) => void)|null}
     */
    this._onDeckSwap = null;

    /** Telemetry: timestamps for transition metrics. */
    this._telemetry = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** @returns {keyof typeof SWITCHER_STATE} */
  getState() { return this._state; }

  /** @returns {boolean} */
  isIdle() { return this._state === SWITCHER_STATE.IDLE; }

  /**
   * Register a callback to fire when a deck swap completes.
   * @param {((newEl: HTMLAudioElement, oldEl: HTMLAudioElement) => void)|null} fn
   */
  onDeckSwap(fn) {
    this._onDeckSwap = typeof fn === "function" ? fn : null;
  }

  /**
   * Switch the active representation to the track at manifestUrl.
   *
   * Readiness invariant: if standby cannot prove it can produce audio (readiness
   * gate timed out), the active deck continues playing unchanged.  A timeout is
   * NEVER treated as evidence of readiness.
   *
   * Rapid reversal: if called again while in progress, this call is the new authority.
   * The stale transition is abandoned cleanly; the new one begins immediately.
   *
   * @param {string}  manifestUrl
   * @param {number}  targetPositionSec
   * @param {{ normGainDb?: number, playbackRate?: number }} [opts]
   * @returns {Promise<string>}  One of HANDOFF_RESULT — COMPLETE, NOT_READY, ABORTED,
   *                             SUPERSEDED, or FAILED
   */
  async switchTo(manifestUrl, targetPositionSec, opts = {}) {
    const tid = ++this._transitionId;
    this._telemetry = { start: performance.now(), url: manifestUrl };

    _diag("switchTo", { tid, targetPositionSec, manifestUrl });

    // ── Reversal guard: cancel any in-flight crossfade smoothly ───────────────
    if (this._state === SWITCHER_STATE.CROSSFADING) {
      // Use the gain captured BEFORE the ramp started — mainGain.gain.value may
      // be near 0 if the ramp has already completed, which would cause cancelCrossfade
      // to restore the active deck to silence.
      const restoreGain = this._preCrossfadeActiveGain ?? getWebAudioEngine().mainGain?.gain.value ?? 1;
      _diag("reversal", { restoreGain });
      getWebAudioEngine().cancelCrossfade(restoreGain);
    }

    // ── Release stale standby deck ─────────────────────────────────────────────
    if (this._standby) {
      this._standby.detachHls();
      // Keep the audio element alive — it stays wired to the WebAudio standby path
      // and will be reused as the next standby placeholder.  dispose() would remove it.
      this._standby = null;
    }

    this._state = SWITCHER_STATE.LOADING;
    this._preCrossfadeActiveGain = null;

    const normGainLinear = _dbToLinear(opts.normGainDb);
    const deck = new RepresentationDeck();
    this._standby = deck;

    // ── Phase 1: Load standby + buffer from targetPositionSec ─────────────────
    _diag("loading", { normGainLinear });
    const loaded = await deck.loadAndPosition(manifestUrl, targetPositionSec, {
      playbackRate: opts.playbackRate,
    });

    if (!loaded || this._transitionId !== tid) {
      _diag("superseded-or-failed", { loaded, tid, current: this._transitionId });
      _cleanupAborted(deck, this);
      return loaded ? HANDOFF_RESULT.SUPERSEDED : HANDOFF_RESULT.FAILED;
    }

    this._state = SWITCHER_STATE.AWAITING_READINESS;

    // ── Phase 2: Destination readiness gate ────────────────────────────────────
    _diag("awaiting-readiness", { targetPositionSec });
    const ready = await deck.waitForReadiness(targetPositionSec);

    if (this._transitionId !== tid) {
      _diag("superseded-during-readiness", { tid, current: this._transitionId });
      _cleanupAborted(deck, this);
      return HANDOFF_RESULT.SUPERSEDED;
    }

    if (!ready) {
      // INVARIANT: a timeout is NOT evidence of readiness.
      // NEVER silence or crossfade the active source merely because standby timed out.
      // Keep the active deck playing; release standby resources cleanly.
      console.warn(LOG_TAG, "readiness gate timed out — active deck kept playing", { targetPositionSec });
      _diag("not-ready-abort", { targetPositionSec });
      _cleanupAborted(deck, this);
      return HANDOFF_RESULT.NOT_READY;
    }

    this._state = SWITCHER_STATE.CROSSFADING;

    // ── Phase 3: Musical alignment verification ────────────────────────────────
    if (deck.audioEl) {
      const drift = Math.abs(deck.audioEl.currentTime - targetPositionSec);
      if (drift > DRIFT_CORRECTION_SEC) {
        _diag("drift-correction", { drift, targetPositionSec });
        deck.audioEl.currentTime = targetPositionSec;
        deck.hlsEngine?.seekTo(targetPositionSec);
      }
    }

    playbackStateMachine.transition(PLAYBACK_ORCHESTRATION_EVENTS.CROSSFADE_START);

    // ── Phase 4: Equal-power crossfade via AudioParam automation ──────────────
    const engine = getWebAudioEngine();

    // Capture the active gain NOW — before the ramp drives it toward 0.
    // cancelCrossfade() and reversal use this value, not the in-flight ramp value.
    this._preCrossfadeActiveGain = engine.mainGain?.gain.value ?? 1;
    _diag("crossfade-start", { activeGain: this._preCrossfadeActiveGain, standbyGain: normGainLinear });

    engine.startCrossfade(CROSSFADE_SEC, normGainLinear);

    // Wait for ramp to complete.  Audio transition is fully AudioContext-driven;
    // this timer only gates the JS state commit.  See file header for safety analysis.
    await _sleep(Math.ceil(CROSSFADE_SEC * 1000) + CROSSFADE_SETTLE_MS);

    if (this._transitionId !== tid) {
      // A reversal arrived while we were waiting — cancelCrossfade() already fired.
      // The new switchTo() owns state; just close out the PSM event.
      _diag("superseded-during-crossfade", { tid, current: this._transitionId });
      playbackStateMachine.transition(PLAYBACK_ORCHESTRATION_EVENTS.CROSSFADE_END);
      return HANDOFF_RESULT.SUPERSEDED;
    }

    // ── Phase 5: Deck swap ─────────────────────────────────────────────────────
    this._state = SWITCHER_STATE.RECYCLING;

    // completeCrossfade() snaps gains, swaps JS refs, re-wires DOM listeners.
    const oldActiveEl = engine.completeCrossfade(normGainLinear);

    // ── Phase 6: Update runtime refs ──────────────────────────────────────────
    const refs = getAudioEngineRefs();

    // audioRef.current now points to the former standby element (now active).
    const newActiveEl = engine.getActiveBoundElement();
    if (newActiveEl) refs.audioRef.current = newActiveEl;

    // HLS engine: standby HLS is now managing the active element.
    const prevHlsEngine = refs.hlsEngineRef.current;
    if (deck.hlsEngine) {
      refs.hlsEngineRef.current = deck.hlsEngine;
      setActiveHLSEngine(deck.hlsEngine);
    }

    _diag("swap-complete", { newActiveEl: !!newActiveEl, oldActiveEl: !!oldActiveEl });

    // ── Phase 7: Notify AudioProvider of the element change ───────────────────
    if (this._onDeckSwap && newActiveEl && oldActiveEl) {
      try { this._onDeckSwap(newActiveEl, oldActiveEl); } catch {}
    }

    // ── Phase 8: Recycle old active as standby placeholder ────────────────────
    // Detach old HLS engine (it was driving the former active element).
    if (prevHlsEngine) {
      try { prevHlsEngine.detach(); } catch {}
    }

    // The former active audio element is now the WebAudio standby element.
    // Keep it alive in DOM + WebAudio standby path for the next representation switch.
    deck.audioEl   = oldActiveEl ?? null;
    deck.hlsEngine = null;
    this._standby  = deck;
    this._preCrossfadeActiveGain = null;

    // Telemetry.
    if (this._telemetry) {
      const elapsed = Math.round(performance.now() - this._telemetry.start);
      console.info(LOG_TAG, "handoff complete", { elapsed, normGainLinear });
      this._telemetry = null;
    }

    playbackStateMachine.transition(PLAYBACK_ORCHESTRATION_EVENTS.CROSSFADE_END);

    this._state = SWITCHER_STATE.IDLE;
    return HANDOFF_RESULT.COMPLETE;
  }

  /**
   * Abort any in-progress transition immediately.
   * Restores active deck gain using the pre-crossfade snapshot (or restoreGain if provided).
   * @param {number} [restoreGain]
   */
  abort(restoreGain) {
    this._transitionId++;
    const engine = getWebAudioEngine();
    // Prefer the captured pre-ramp gain over the live gain.value, which may be
    // mid-ramp (or 0 if the ramp already completed on the audio thread).
    const gain = restoreGain ?? this._preCrossfadeActiveGain ?? engine.mainGain?.gain.value ?? 1;
    _diag("abort", { gain });
    engine.cancelCrossfade(gain);

    if (this._standby) {
      this._standby.detachHls();
      this._standby = null;
    }

    this._preCrossfadeActiveGain = null;
    this._state = SWITCHER_STATE.IDLE;
    this._telemetry = null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _dbToLinear(gainDb) {
  if (gainDb == null) return 1;
  return Math.max(0.01, Math.min(4, Math.pow(10, gainDb / 20)));
}

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _cleanupAborted(deck, switcher) {
  deck.detachHls();
  if (switcher._standby === deck) switcher._standby = null;
  switcher._state = SWITCHER_STATE.IDLE;
}

// ── Module singleton ──────────────────────────────────────────────────────────

/** @type {RepresentationSwitcher|null} */
let _switcher = null;

/**
 * Module-level singleton — one switcher per tab, survives React tree tears.
 * @returns {RepresentationSwitcher}
 */
export function getRepresentationSwitcher() {
  if (!_switcher) _switcher = new RepresentationSwitcher();
  return _switcher;
}
