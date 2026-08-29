/**
 * Global Media Controller — singleton coordination layer.
 *
 * Responsibilities:
 *   - Track the current media mode (audio-only, audio+visual, full-video)
 *   - Manage visual moment lifecycle (idle → active → full)
 *   - Coordinate audio engine for independent media (pause/resume with position preservation)
 *   - Provide video→audio synchronization helpers for synced visual modes
 *
 * Authority hierarchy:
 *   Playback Core = authoritative over Transport
 *   PlaybackStateMachine = authoritative over Selection
 *   GlobalMediaController = authoritative over visual/video state
 *
 * This module is pure JS — no React, no hooks. React components subscribe via subscribe().
 * Audio operations flow through callbacks registered by the React audio bridge hook.
 */

import { getCanonicalTransportTimeline } from "@/lib/playback/transport-observation-port.js";

export const MEDIA_MODE = /** @type {const} */ ({
  AUDIO:        'audio',
  AUDIO_VISUAL: 'audio_visual',
  VIDEO:        'video',
});

export const VISUAL_STATE = /** @type {const} */ ({
  IDLE:       'idle',
  PREWARMING: 'prewarming',
  ACTIVE:     'active',
  EXPANDING:  'expanding',
  FULL:       'full',
});

function createGlobalMediaController() {
  let _mode        = MEDIA_MODE.AUDIO;
  let _visualState = VISUAL_STATE.IDLE;
  let _activeRelease = null;
  let _activeAsset   = null;

  // Audio bridge — registered by useGlobalMediaControllerBridge
  let _audioPause  = null;  // () => void
  let _audioResume = null;  // (resumeAt?: number) => void

  // Preserved audio position when independent visual takes over
  let _preservedAudioPos = null;

  const _listeners = new Set();

  // ─── Internal ──────────────────────────────────────────────────────────────

  function _notify() {
    const state = getState();
    for (const fn of _listeners) {
      try { fn(state); } catch {}
    }
  }

  function _audioPos() {
    try {
      return getCanonicalTransportTimeline().position ?? 0;
    } catch {
      return 0;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  function getState() {
    return {
      mode:          _mode,
      visualState:   _visualState,
      activeRelease: _activeRelease,
      activeAsset:   _activeAsset,
    };
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  function subscribe(listener) {
    _listeners.add(listener);
    return () => _listeners.delete(listener);
  }

  /**
   * Called once by useGlobalMediaControllerBridge mounted near the app root.
   * Provides audio control callbacks that operate on the React audio engine.
   */
  function registerAudioBridge({ pause, resume }) {
    _audioPause  = typeof pause  === 'function' ? pause  : null;
    _audioResume = typeof resume === 'function' ? resume : null;
  }

  /** Current authoritative audio position in seconds. */
  function getAudioPosition() {
    return _audioPos();
  }

  /**
   * Activate a Visual Moment for a release.
   * @param {string} releaseSlug
   * @param {object} asset — release_visual_assets row
   */
  function activateMoment(releaseSlug, asset) {
    _activeRelease = releaseSlug;
    _activeAsset   = asset;
    _visualState   = VISUAL_STATE.ACTIVE;
    _mode          = MEDIA_MODE.AUDIO_VISUAL;

    if (asset?.playback_mode === 'independent' && _preservedAudioPos === null) {
      _preservedAudioPos = _audioPos();
      _audioPause?.();
    }

    _notify();
  }

  /**
   * Deactivate the current Visual Moment and return to audio-only mode.
   * If independent media was playing, resumes audio from the preserved position.
   */
  function deactivateMoment() {
    const wasIndependent = _activeAsset?.playback_mode === 'independent';
    _activeRelease = null;
    _activeAsset   = null;
    _visualState   = VISUAL_STATE.IDLE;
    _mode          = MEDIA_MODE.AUDIO;

    if (wasIndependent && _preservedAudioPos !== null) {
      _audioResume?.(_preservedAudioPos);
      _preservedAudioPos = null;
    }

    _notify();
  }

  /**
   * Expand to full visual experience (hold+swipe or explicit expand).
   */
  function expandToFull(releaseSlug, asset) {
    _activeRelease = releaseSlug ?? _activeRelease;
    _activeAsset   = asset       ?? _activeAsset;
    _visualState   = VISUAL_STATE.FULL;

    const isIndependent = _activeAsset?.playback_mode === 'independent';
    _mode = isIndependent ? MEDIA_MODE.VIDEO : MEDIA_MODE.AUDIO_VISUAL;

    if (isIndependent && _preservedAudioPos === null) {
      _preservedAudioPos = _audioPos();
      _audioPause?.();
    }

    _notify();
  }

  /** Close the full visual experience and return to audio-only. */
  function exitFull() {
    const wasIndependent = _activeAsset?.playback_mode === 'independent';
    _activeRelease = null;
    _activeAsset   = null;
    _visualState   = VISUAL_STATE.IDLE;
    _mode          = MEDIA_MODE.AUDIO;

    if (wasIndependent && _preservedAudioPos !== null) {
      _audioResume?.(_preservedAudioPos);
      _preservedAudioPos = null;
    }

    _notify();
  }

  /**
   * Seek a video element to match the current audio position (for synced visuals).
   * Safe to call repeatedly — only seeks if drift > 0.5 s.
   * @param {HTMLVideoElement} videoEl
   * @param {number} [syncOffset] — seconds to add to audioTime (from asset.sync_offset)
   */
  function syncVideoToAudio(videoEl, syncOffset = 0) {
    if (!videoEl) return;
    const target = _audioPos() + (Number(syncOffset) || 0);
    if (Math.abs(videoEl.currentTime - target) > 0.5) {
      try { videoEl.currentTime = target; } catch {}
    }
  }

  /**
   * Mark a moment as prewarming (video element loading but not yet shown).
   * Components call this when the hover/intent triggers a prefetch.
   */
  function markPrewarming(releaseSlug) {
    if (_visualState !== VISUAL_STATE.IDLE) return;
    _notify(); // state unchanged but used to broadcast prewarm intent
  }

  return {
    MEDIA_MODE,
    VISUAL_STATE,
    getState,
    subscribe,
    registerAudioBridge,
    getAudioPosition,
    activateMoment,
    deactivateMoment,
    expandToFull,
    exitFull,
    syncVideoToAudio,
    markPrewarming,
  };
}

/** Module-level singleton. One per browser tab. */
export const globalMediaController = createGlobalMediaController();
