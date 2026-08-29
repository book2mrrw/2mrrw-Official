/**
 * InteractiveMediaState — module-level singleton.
 * OWNER of all interactive artwork / performance state:
 *   playbackMode   (NORMAL | SLOW_MOMENTARY | SLOW_LOCKED)
 *   slowIntensity  (0–1; 0 = default screw depth, 1 = deepest)
 *   performanceEffect (NONE | CHOP | FILTER)
 *   videoState     (ARTWORK | VIDEO_ELIGIBLE | VIDEO_WAKE_PENDING | VIDEO_WOKEN | VIDEO_MODAL)
 *   visualMode     (boolean — project Visual Mode on/off)
 *   fullscreenState (NORMAL | FULL)
 *   gestureOwner   (string slug or null)
 *   generationId   (increments on every significant state change)
 *
 * Authority contract:
 *   Playback Core = authoritative over Transport and presentation timeline
 *   PlaybackStateMachine = authoritative over Selection (queue and identity)
 *   InteractiveMediaState = authoritative over gesture-driven and visual state
 *   GlobalMediaController = authoritative over visual asset activation (from previous session)
 *
 * InteractiveMediaState reads PSM identity (track changes) to auto-cancel momentary effects.
 * It NEVER owns or modifies audio. All audio effects are dispatched to ScrewEngine / ChopEngine / FilterEngine.
 */

import { playbackStateMachine } from "@/media/PlaybackStateMachine";
import { resolveTrackPerformanceProfile } from "@/lib/player/performance-profile";

// ── Constants ─────────────────────────────────────────────────────────────────

export const PLAYBACK_MODE = /** @type {const} */ ({
  NORMAL:           "NORMAL",
  SLOW_MOMENTARY:   "SLOW_MOMENTARY",
  SLOW_LOCKED:      "SLOW_LOCKED",
});

export const PERFORMANCE_EFFECT = /** @type {const} */ ({
  NONE:   "NONE",
  CHOP:   "CHOP",
  FILTER: "FILTER",
});

export const VIDEO_STATE = /** @type {const} */ ({
  ARTWORK:             "ARTWORK",
  VIDEO_ELIGIBLE:      "VIDEO_ELIGIBLE",
  VIDEO_WAKE_PENDING:  "VIDEO_WAKE_PENDING",
  VIDEO_WOKEN:         "VIDEO_WOKEN",
  VIDEO_MODAL:         "VIDEO_MODAL",
});

export const FULLSCREEN_STATE = /** @type {const} */ ({
  NORMAL: "NORMAL",
  FULL:   "FULL",
});

// ── State factory ──────────────────────────────────────────────────────────────

function createInteractiveMediaState() {
  let _playbackMode       = PLAYBACK_MODE.NORMAL;
  let _slowIntensity      = 0.4;          // default on hold — mid-depth screw
  let _performanceEffect  = PERFORMANCE_EFFECT.NONE;
  let _videoState         = VIDEO_STATE.ARTWORK;
  let _visualMode         = false;
  let _fullscreenState    = FULLSCREEN_STATE.NORMAL;
  let _gestureOwner       = null;         // slug of artwork surface currently owning gesture
  let _generationId       = 0;

  // Audio effect dispatch callbacks — registered by InteractiveArtwork / effect engines
  let _screwActivate   = null;  // (intensity: number) => void
  let _screwDeactivate = null;  // () => void
  let _screwSetIntensity = null;// (intensity: number) => void
  let _chopFire        = null;  // (x: number, y: number) => void — fire one chop burst
  let _chopClear       = null;  // () => void — cancel pending teardown + clear chain extension
  let _filterSetXY     = null;  // (x: number, y: number) => void
  let _filterDeactivate= null;  // () => void

  const _listeners = new Set();
  let _notifying = false;
  let _pendingNotify = false;

  // ── Track identity cancel ─────────────────────────────────────────────────

  let _lastTrackId   = null;
  let _lastTrackSlug = null;
  const _unsubIdentity = playbackStateMachine.subscribeIdentity((snap) => {
    const tid = snap.currentTrackId;
    if (tid !== _lastTrackId) {
      _lastTrackId   = tid;
      _lastTrackSlug = snap.currentTrackSlug ?? null;
      if (_playbackMode === PLAYBACK_MODE.SLOW_MOMENTARY) {
        // Auto-cancel momentary Slow on track change
        _cancelSlowInternal();
      }
      // SLOW_LOCKED is preserved on track change; re-apply rate for the new track.
      if (_playbackMode === PLAYBACK_MODE.SLOW_LOCKED) {
        _resolveLockedRate();
      }
      // Clear all performance effects on track change (CHOP and FILTER)
      if (_performanceEffect !== PERFORMANCE_EFFECT.NONE) {
        _clearEffect();
      }
      if (_videoState !== VIDEO_STATE.ARTWORK) {
        _setVideoState(VIDEO_STATE.ARTWORK);
      }
    }
  });

  // ── Internal helpers ───────────────────────────────────────────────────────

  function _notify() {
    if (_notifying) { _pendingNotify = true; return; }
    _notifying = true;
    do {
      _pendingNotify = false;
      _generationId++;
      const snap = _snapshot();
      for (const fn of _listeners) {
        try { fn(snap); } catch {}
      }
    } while (_pendingNotify);
    _notifying = false;
  }

  function _snapshot() {
    return Object.freeze({
      playbackMode:      _playbackMode,
      slowIntensity:     _slowIntensity,
      performanceEffect: _performanceEffect,
      videoState:        _videoState,
      visualMode:        _visualMode,
      fullscreenState:   _fullscreenState,
      gestureOwner:      _gestureOwner,
      generationId:      _generationId,
    });
  }

  function _resolveLockedRate() {
    // Resolve the new track's authored Performance Profile, or fall back to house.
    // Future: registerAuthoredProfile(slug, profile) populates authored data.
    const { intensity } = resolveTrackPerformanceProfile(_lastTrackSlug);
    _slowIntensity = intensity;
    try { _screwActivate?.(_slowIntensity); } catch {}
  }

  function _cancelSlowInternal() {
    _playbackMode = PLAYBACK_MODE.NORMAL;
    try { _screwDeactivate?.(); } catch {}
    _clearEffect();
    _gestureOwner = null;
  }

  function _clearEffect() {
    if (_performanceEffect === PERFORMANCE_EFFECT.FILTER) {
      try { _filterDeactivate?.(); } catch {}
    } else if (_performanceEffect === PERFORMANCE_EFFECT.CHOP) {
      // Cancel the pending teardown timer and remove the Chop GainNode from the
      // WebAudio chain immediately. Without this, the chopGain stays connected as a
      // pass-through (gain=1) after the burst — invisible but never cleaned up.
      try { _chopClear?.(); } catch {}
    }
    _performanceEffect = PERFORMANCE_EFFECT.NONE;
  }

  function _setVideoState(vs) {
    if (_videoState === vs) return;
    _videoState = vs;
    _notify();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Subscribe to state changes. Returns unsubscribe fn. */
  function subscribe(listener) {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  }

  function getSnapshot() {
    return _snapshot();
  }

  // ── Audio effect registrations ─────────────────────────────────────────────

  function registerScrewCallbacks({ activate, deactivate, setIntensity }) {
    _screwActivate    = typeof activate    === "function" ? activate    : null;
    _screwDeactivate  = typeof deactivate  === "function" ? deactivate  : null;
    _screwSetIntensity= typeof setIntensity=== "function" ? setIntensity: null;
  }

  function registerChopCallbacks({ fire, clear }) {
    _chopFire  = typeof fire  === "function" ? fire  : null;
    _chopClear = typeof clear === "function" ? clear : null;
  }

  function registerFilterCallbacks({ setXY, deactivate }) {
    _filterSetXY     = typeof setXY     === "function" ? setXY     : null;
    _filterDeactivate= typeof deactivate=== "function" ? deactivate: null;
  }

  // ── Slow / Screw ──────────────────────────────────────────────────────────

  /**
   * Called when hold threshold reached.
   * @param {string} ownerSlug — slug of the artwork card initiating the gesture
   */
  function beginSlowMomentary(ownerSlug) {
    if (_gestureOwner && _gestureOwner !== ownerSlug) return; // another surface owns gesture
    _playbackMode = PLAYBACK_MODE.SLOW_MOMENTARY;
    _gestureOwner = ownerSlug;
    try { _screwActivate?.(_slowIntensity); } catch {}
    _notify();
  }

  /**
   * Update screw depth while hold + drag.
   * @param {number} intensity — 0 (lightest) to 1 (deepest)
   */
  function setSlowIntensity(intensity) {
    const clamped = Math.max(0, Math.min(1, intensity));
    _slowIntensity = clamped;
    if (_playbackMode !== PLAYBACK_MODE.NORMAL) {
      try { _screwSetIntensity?.(clamped); } catch {}
    }
  }

  /**
   * Transition to locked Slow.
   */
  function lockSlow() {
    if (_playbackMode === PLAYBACK_MODE.NORMAL) return;
    _playbackMode = PLAYBACK_MODE.SLOW_LOCKED;
    _notify();
  }

  /**
   * Release momentary hold without lock. Returns to NORMAL.
   */
  function releaseMomentarySlow() {
    if (_playbackMode !== PLAYBACK_MODE.SLOW_MOMENTARY) return;
    _cancelSlowInternal();
    _notify();
  }

  /**
   * Unlock SLOW_LOCKED → return to NORMAL audio.
   * Cancels any active performance effect.
   */
  function unlockSlow() {
    if (_playbackMode !== PLAYBACK_MODE.SLOW_LOCKED) return;
    _cancelSlowInternal();
    _notify();
  }

  // ── Performance effects (SLOW_LOCKED context) ──────────────────────────────

  /**
   * Fire a Chop burst (one tap while SLOW_LOCKED).
   * @param {number} nx — normalized X position [0,1] (maps to chop rate)
   * @param {number} ny — normalized Y position [0,1] (maps to chop depth)
   */
  function fireChop(nx, ny) {
    if (_playbackMode !== PLAYBACK_MODE.SLOW_LOCKED) return;
    _clearEffect(); // cancel any active filter
    _performanceEffect = PERFORMANCE_EFFECT.CHOP;
    try { _chopFire?.(nx, ny); } catch {}
    // Chop is auto-clearing (returns to NONE after burst completes)
    _notify();
  }

  /** Called by ChopEngine when burst completes. */
  function onChopComplete() {
    if (_performanceEffect === PERFORMANCE_EFFECT.CHOP) {
      _performanceEffect = PERFORMANCE_EFFECT.NONE;
      _notify();
    }
  }

  /**
   * Activate/update filter drag (during SLOW_LOCKED drag).
   * @param {number} nx — [0,1] → cutoff frequency sweep
   * @param {number} ny — [0,1] → resonance
   */
  function setFilterXY(nx, ny) {
    if (_playbackMode !== PLAYBACK_MODE.SLOW_LOCKED) return;
    if (_performanceEffect !== PERFORMANCE_EFFECT.FILTER) {
      _clearEffect();
      _performanceEffect = PERFORMANCE_EFFECT.FILTER;
      _notify();
    }
    try { _filterSetXY?.(nx, ny); } catch {}
  }

  /** Deactivate filter, return to NONE. */
  function deactivateFilter() {
    if (_performanceEffect !== PERFORMANCE_EFFECT.FILTER) return;
    try { _filterDeactivate?.(); } catch {}
    _performanceEffect = PERFORMANCE_EFFECT.NONE;
    _notify();
  }

  // ── Video State ───────────────────────────────────────────────────────────

  function setVideoEligible()    { _setVideoState(VIDEO_STATE.VIDEO_ELIGIBLE);     }
  function setVideoWakePending() { _setVideoState(VIDEO_STATE.VIDEO_WAKE_PENDING); }
  function setVideoWoken()       { _setVideoState(VIDEO_STATE.VIDEO_WOKEN);        }
  function setVideoModal()       { _setVideoState(VIDEO_STATE.VIDEO_MODAL);        }
  function setVideoArtwork()     { _setVideoState(VIDEO_STATE.ARTWORK);            }

  // ── Visual Mode ───────────────────────────────────────────────────────────

  function setVisualMode(on) {
    if (_visualMode === Boolean(on)) return;
    _visualMode = Boolean(on);
    _notify();
  }

  function toggleVisualMode() {
    _visualMode = !_visualMode;
    _notify();
  }

  // ── Fullscreen ────────────────────────────────────────────────────────────

  function enterFullscreen() {
    if (_fullscreenState === FULLSCREEN_STATE.FULL) return;
    _fullscreenState = FULLSCREEN_STATE.FULL;
    _notify();
  }

  function exitFullscreen() {
    if (_fullscreenState === FULLSCREEN_STATE.NORMAL) return;
    _fullscreenState = FULLSCREEN_STATE.NORMAL;
    _notify();
  }

  return {
    // State
    getSnapshot,
    subscribe,
    // Effect registrations
    registerScrewCallbacks,
    registerChopCallbacks,
    registerFilterCallbacks,
    // Slow / Screw
    beginSlowMomentary,
    setSlowIntensity,
    lockSlow,
    releaseMomentarySlow,
    unlockSlow,
    // Performance
    fireChop,
    onChopComplete,
    setFilterXY,
    deactivateFilter,
    // Video
    setVideoEligible,
    setVideoWakePending,
    setVideoWoken,
    setVideoModal,
    setVideoArtwork,
    // Visual mode
    setVisualMode,
    toggleVisualMode,
    // Fullscreen
    enterFullscreen,
    exitFullscreen,
  };
}

export const interactiveMediaState = createInteractiveMediaState();
