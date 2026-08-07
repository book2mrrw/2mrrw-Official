/**
 * AudioEngineInterface — platform-agnostic contract for audio execution.
 *
 * Architecture (B+C):
 *   PlaybackStateMachine  — authoritative business logic, platform-agnostic
 *          │ transitions drive
 *   AudioEngine           — executor layer, platform-specific
 *          │ emits events back to SM
 *   AudioContext.js       — thin React adapter (~300 lines, subscribes to SM)
 *
 * Implementations:
 *   WebAudioEngine    (apps/web)  — HTMLAudioElement + Web Audio API graph
 *   NativeAudioEngine (apps/app)  — React Native Track Player / AVFoundation
 *
 * The PlaybackStateMachine dispatches commands; each AudioEngine implementation
 * executes them in platform-specific ways and emits events back to the SM so it
 * can update context. Neither implementation contains business logic — that lives
 * exclusively in the SM.
 *
 * Lifecycle:
 *   engine.bind(element)            -- web: bind <audio>; native: initialize player
 *   engine.load(src, options)       -- load a track by URL
 *   engine.play()                   -- begin playback (must call after load or seek)
 *   engine.pause()                  -- pause without unloading
 *   engine.seek(position)           -- seek to absolute position in seconds
 *   engine.stop()                   -- stop and release the track
 *
 * Volume (single authority — never set element.volume directly):
 *   engine.setUserVolume(level)     -- 0–1, persisted to platform storage
 *   engine.getUserVolume()          -- returns persisted level 0–1
 *
 * Gain / rate:
 *   engine.setTrackGain(gainDb)     -- per-track loudness normalization in dB
 *   engine.setPlaybackRate(rate)    -- 0.25–4.0; 1.0 = normal speed
 *
 * DSP effects (no-op on platforms that don't support them):
 *   engine.setSpaceMode(enabled)    -- stereo widening / reverb effect
 *   engine.setBassMode(enabled)     -- low-shelf bass boost
 *   engine.setAtmosphereLevel(n)    -- 0–5 atmosphere intensity
 *
 * Diagnostics:
 *   engine.getCurrentTime()         -- current position in seconds
 *   engine.getDuration()            -- total duration in seconds (0 if unknown)
 *   engine.getBufferedEnd()         -- furthest buffered position in seconds
 *   engine.isPlaying()              -- true when audio is actively producing sound
 *   engine.isLoaded()               -- true when a src is loaded and ready
 *
 * Events (engine → SM — use engine.on(event, handler)):
 *   "play"          — audio started        { currentTime: number }
 *   "pause"         — audio paused         { currentTime: number }
 *   "ended"         — track finished naturally
 *   "error"         — playback error       { code: number|null, message: string|null }
 *   "buffering"     — stall started (waiting for data)
 *   "buffered"      — stall resolved (playing event after waiting)
 *   "timeupdate"    — position tick        { currentTime: number, duration: number }
 *   "canplay"       — can start playing    (some data buffered)
 *   "canplaythrough"— sufficient data buffered to play through without stalling
 *   "seeked"        — seek complete        { currentTime: number }
 *   "durationchange"— duration available   { duration: number }
 *   "loadedmetadata"— metadata loaded      { duration: number }
 *   "emptied"       — src cleared (element unloaded)
 *   "stalled"       — browser stalled fetching data
 *   "volume"        — volume changed       { volume: number }
 *   "ratechange"    — rate changed         { playbackRate: number }
 */

export const AUDIO_ENGINE_EVENTS = Object.freeze({
  PLAY:           "play",
  PAUSE:          "pause",
  ENDED:          "ended",
  ERROR:          "error",
  BUFFERING:      "buffering",
  BUFFERED:       "buffered",
  TIMEUPDATE:     "timeupdate",
  CANPLAY:        "canplay",
  CANPLAYTHROUGH: "canplaythrough",
  SEEKED:         "seeked",
  DURATIONCHANGE: "durationchange",
  LOADEDMETADATA: "loadedmetadata",
  EMPTIED:        "emptied",
  STALLED:        "stalled",
  VOLUME:         "volume",
  RATE_CHANGE:    "ratechange",
});

/**
 * Minimal fault-isolated EventEmitter base.
 * Platform-agnostic: no DOM EventTarget, no Node EventEmitter.
 * Subclass this to get on() / off() / _emit() with per-handler fault isolation.
 */
export class AudioEngineBase {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
  }

  /**
   * Register an event handler.
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void} Unsubscribe function — call to remove the handler.
   */
  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Remove an event handler.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    this._handlers.get(event)?.delete(handler);
  }

  /**
   * Emit an event to all registered handlers with fault isolation.
   * @param {string} event
   * @param {*} [payload]
   */
  _emit(event, payload) {
    const handlers = this._handlers.get(event);
    if (!handlers) return;
    for (const fn of handlers) {
      try { fn(payload); } catch {}
    }
  }

  /**
   * Remove all handlers for all events — call on destroy/unmount.
   */
  removeAllListeners() {
    this._handlers.clear();
  }

  // ── Interface stubs — subclass MUST override these ─────────────────────────
  // Throwing here (not silently no-oping) surfaces missing implementations
  // during development rather than letting them fail silently.

  /**
   * Load a track src. On web, sets audio element src and calls load().
   * @param {string} src
   * @param {{ startTime?: number, gainDb?: number, playbackRate?: number }} [options]
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async load(src, options = {}) {
    throw new Error("AudioEngine.load() not implemented");
  }

  /**
   * Begin or resume playback. Must resume AudioContext on web first.
   * @returns {Promise<void>}
   */
  async play() {
    throw new Error("AudioEngine.play() not implemented");
  }

  /** Pause playback without unloading the track. */
  pause() {
    throw new Error("AudioEngine.pause() not implemented");
  }

  /**
   * Seek to an absolute position.
   * @param {number} position — seconds
   */
  // eslint-disable-next-line no-unused-vars
  seek(position) {
    throw new Error("AudioEngine.seek() not implemented");
  }

  /** Stop playback and release the current track src. */
  stop() {}

  // ── Volume (subclass should override for platform persistence) ─────────────

  /** @param {number} level — 0–1 inclusive */
  // eslint-disable-next-line no-unused-vars
  setUserVolume(level) {}

  /** @returns {number} — 0–1 */
  getUserVolume() { return 1; }

  // ── Gain / rate ────────────────────────────────────────────────────────────

  /** @param {number} gainDb — positive = louder, negative = quieter */
  // eslint-disable-next-line no-unused-vars
  setTrackGain(gainDb) {}

  /** @param {number} rate — 0.25–4.0 */
  // eslint-disable-next-line no-unused-vars
  setPlaybackRate(rate) {}

  // ── DSP effects (no-op default — web engine overrides) ────────────────────

  // eslint-disable-next-line no-unused-vars
  setSpaceMode(enabled) {}
  // eslint-disable-next-line no-unused-vars
  setBassMode(enabled) {}
  // eslint-disable-next-line no-unused-vars
  setAtmosphereLevel(level) {}

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /** @returns {number} — current position in seconds */
  getCurrentTime() { return 0; }

  /** @returns {number} — total duration in seconds (0 if unknown) */
  getDuration() { return 0; }

  /** @returns {number} — furthest buffered position in seconds */
  getBufferedEnd() { return 0; }

  /** @returns {boolean} */
  isPlaying() { return false; }

  /** @returns {boolean} */
  isLoaded() { return false; }
}
