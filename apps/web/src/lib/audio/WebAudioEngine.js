/**
 * Standalone Web Audio graph manager — lives entirely outside React.
 * Owns the AudioContext, MediaElementSourceNode, and all downstream nodes.
 * Survives React provider remounts and route changes; graph is built once and persists.
 *
 * Signal chain (Spotify-architecture):
 *   source → mainGain → userGain → analyser → stereoPanner → bassFilter → limiter → destination
 *
 * mainGain  — per-track loudness normalization (gain.value = loudness-normalized linear gain)
 * userGain  — user volume preference (0–1, persisted to localStorage)
 *             This is the single volume authority. HTMLAudioElement.volume is locked at 1.0.
 *
 * Implements AudioEngineBase (apps/web/src/lib/audio/AudioEngineInterface.js) so it
 * satisfies the same contract as NativeAudioEngine on the mobile app, enabling
 * PlaybackStateMachine to be shared across platforms.
 */

import { AudioEngineBase, AUDIO_ENGINE_EVENTS } from "@/lib/audio/AudioEngineInterface";

const MRRW_SOURCE_BOUND = Symbol.for("2mrrw.mediaElementSourceBound");
const VOL_KEY = "2mrrw-vol";

export class WebAudioEngine extends AudioEngineBase {
  constructor() {
    super();

    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {MediaElementAudioSourceNode|null} */
    this.source = null;
    /** @type {GainNode|null} Per-track normalization + crossfade fader. */
    this.mainGain = null;
    /** @type {GainNode|null} Single user-volume authority. Element volume stays at 1.0. */
    this.userGain = null;
    /** @type {AnalyserNode|null} */
    this.analyser = null;
    /** @type {StereoPannerNode|null} */
    this.stereoPanner = null;
    /** @type {BiquadFilterNode|null} */
    this.bassFilter = null;
    /** @type {DynamicsCompressorNode|null} */
    this.limiter = null;
    /** @type {HTMLAudioElement|null} */
    this._boundElement = null;
    this._userVolume = this._readStoredVolume();
    /** @type {(() => void)|null} Fired when AudioContext transitions back to "running". */
    this._onContextRunning = null;

    // Element event listener tracking for _attachAudioElementListeners / _detachAudioElementListeners
    /** @type {Array<[string, Function]>|null} */
    this._elListeners = null;
    /** @type {HTMLAudioElement|null} The element whose events are currently forwarded. */
    this._listenerElement = null;
  }

  // ── Volume ─────────────────────────────────────────────────────────────────

  _readStoredVolume() {
    if (typeof window === "undefined") return 1;
    try {
      const v = parseFloat(localStorage.getItem(VOL_KEY) ?? "");
      return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
    } catch { return 1; }
  }

  getUserVolume() {
    return this._userVolume;
  }

  /**
   * Set user volume through the GainNode — the single volume authority.
   * HTMLAudioElement.volume stays permanently locked at 1.0.
   * Falls back to element.volume only when Web Audio is unavailable.
   * @param {number} level  0–1 inclusive
   */
  setUserVolume(level) {
    const v = Math.max(0, Math.min(1, Number(level)));
    if (!Number.isFinite(v)) return;
    this._userVolume = v;
    if (this.userGain) {
      // Primary path: Web Audio GainNode controls user volume.
      // Smooth the ramp over 15 ms to eliminate zipper noise on rapid changes.
      if (this.ctx && this.ctx.state === "running") {
        const now = this.ctx.currentTime;
        this.userGain.gain.cancelScheduledValues(now);
        this.userGain.gain.setValueAtTime(this.userGain.gain.value, now);
        this.userGain.gain.linearRampToValueAtTime(v, now + 0.015);
      } else {
        this.userGain.gain.value = v;
      }
      // Ensure element stays locked — belt-and-suspenders.
      if (this._boundElement) this._boundElement.volume = 1;
    } else if (this._boundElement) {
      // Fallback: no Web Audio graph yet — use element volume directly.
      this._boundElement.volume = v;
    }
    try { localStorage.setItem(VOL_KEY, String(v)); } catch {}
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  /**
   * Create (or verify) the AudioContext and MediaElementSourceNode.
   * Safe to call multiple times — idempotent; only creates what is missing.
   *
   * @param {HTMLAudioElement} audioEl
   * @returns {{ ok: boolean }}  ok=false → Web Audio permanently unavailable for this element
   */
  createContextAndSource(audioEl) {
    const Ctx =
      typeof window !== "undefined"
        ? window.AudioContext || window.webkitAudioContext
        : null;
    if (!Ctx) return { ok: false };

    if (!this.ctx || this.ctx.state === "closed") {
      // AudioContext was closed (recoverAudioHard → teardownWebAudioGraph). The old
      // MediaElementSourceNode belongs to the dead context and cannot be wired into a
      // new one. Clear source + MRRW_SOURCE_BOUND so the element can be re-bound to
      // the fresh context — without this, MRRW_SOURCE_BOUND blocks re-creation and the
      // engine returns {ok:false} permanently, causing permanent silence after recovery.
      if (this._boundElement) {
        try { this._boundElement[MRRW_SOURCE_BOUND] = false; } catch {}
      }
      this.source        = null;
      this._boundElement = null;
      this.ctx = new Ctx();
      this._attachStateChange();
    }

    if (!this.source || this._boundElement !== audioEl) {
      if (!audioEl[MRRW_SOURCE_BOUND]) {
        this.source = this.ctx.createMediaElementSource(audioEl);
        audioEl[MRRW_SOURCE_BOUND] = true;
        this._boundElement = audioEl;
      } else if (!this.source) {
        // MRRW_SOURCE_BOUND is set but source is null — the symbol is stale from a
        // previous engine instance whose source was GC'd. Clear the flag and retry;
        // the browser releases the internal binding once the old MediaElementSourceNode
        // is no longer referenced. A try/catch guards the one case where the browser
        // still refuses (element genuinely has a live source in another context).
        try {
          audioEl[MRRW_SOURCE_BOUND] = false;
          this.source = this.ctx.createMediaElementSource(audioEl);
          audioEl[MRRW_SOURCE_BOUND] = true;
          this._boundElement = audioEl;
        } catch (e) {
          console.error("[WebAudioEngine] Stale bind recovery failed — audio element has a live source in another context", e);
          return { ok: false };
        }
      }
    }

    return { ok: true };
  }

  // ── Graph ───────────────────────────────────────────────────────────────────

  /**
   * Build or rebuild the downstream processing chain.
   * Disconnects stale nodes before connecting fresh ones to prevent fan-out accumulation.
   * After this call, HTMLAudioElement.volume is locked at 1.0.
   */
  buildGraph() {
    const ctx = this.ctx;
    const source = this.source;
    if (!ctx || !source) return;

    const mainGain = ctx.createGain();
    mainGain.gain.value = 1;

    const userGain = ctx.createGain();
    userGain.gain.value = this._userVolume;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const stereoPanner = ctx.createStereoPanner();
    stereoPanner.pan.value = 0;

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = "lowshelf";
    bassFilter.frequency.value = 200;
    bassFilter.gain.value = 0;

    // Transparent limiter — activates only above −1 dBFS, preserves the artist's master.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;

    // Tear down stale nodes before connecting.
    try { this.mainGain?.disconnect(); } catch {}
    try { this.userGain?.disconnect(); } catch {}
    try { this.analyser?.disconnect(); } catch {}
    try { this.stereoPanner?.disconnect(); } catch {}
    try { this.bassFilter?.disconnect(); } catch {}
    try { this.limiter?.disconnect(); } catch {}
    try { source.disconnect(this.mainGain); } catch {}

    // Primary chain: source → mainGain → userGain → analyser → stereoPanner → bassFilter → limiter → destination
    source.connect(mainGain);
    mainGain.connect(userGain);
    userGain.connect(analyser);
    analyser.connect(stereoPanner);
    stereoPanner.connect(bassFilter);
    bassFilter.connect(limiter);
    limiter.connect(ctx.destination);

    this.mainGain = mainGain;
    this.userGain = userGain;
    this.analyser = analyser;
    this.stereoPanner = stereoPanner;
    this.bassFilter = bassFilter;
    this.limiter = limiter;

    // Lock element volume at 1.0. All user volume control flows through userGain.
    if (this._boundElement) this._boundElement.volume = 1;
  }

  // ── AudioContext lifecycle ──────────────────────────────────────────────────

  /**
   * Register a callback to fire when AudioContext transitions back to "running".
   * Used for Bluetooth/headphone reconnect detection — caller checks if audio
   * element is stalled and restarts it.
   * @param {(() => void)|null} fn
   */
  registerContextRunningCallback(fn) {
    this._onContextRunning = typeof fn === "function" ? fn : null;
  }

  _attachStateChange() {
    if (!this.ctx) return;
    this.ctx.onstatechange = () => {
      const state = this.ctx?.state;
      if (state === "suspended" || state === "interrupted") {
        // Resume silently — no user gesture required for re-entrant resume.
        void this.ctx.resume().catch(() => {});
      } else if (state === "running") {
        // Notify AudioContext.js so it can detect stalled audio elements
        // (Bluetooth reconnect, headphone plug-in, tab re-focus on iOS).
        this._onContextRunning?.();
      }
    };
  }

  /**
   * Synchronous resume — call inside a user gesture handler before any await.
   * @returns {boolean} true if a resume was initiated
   */
  resumeSync() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "running" || ctx.state === "closed") return false;
    try { void ctx.resume(); return true; } catch { return false; }
  }

  /** Async resume — safe to await outside gesture handlers. */
  async resume() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
    try { await ctx.resume(); } catch {}
  }

  // ── AudioEngineBase transport API ──────────────────────────────────────────
  // Implements the platform-agnostic interface so PlaybackStateMachine can drive
  // this engine and NativeAudioEngine with identical dispatch calls.

  /**
   * Load a track src into the bound audio element.
   * Applies gain normalization and playback rate before the element begins fetching.
   *
   * @param {string} src
   * @param {{ startTime?: number, gainDb?: number, playbackRate?: number }} [options]
   * @returns {Promise<void>}
   */
  async load(src, options = {}) {
    const el = this._boundElement;
    if (!el) {
      throw new Error("[WebAudioEngine] No audio element bound — call createContextAndSource() first");
    }

    // Apply per-track gain normalization via mainGain before buffering starts.
    if (this.mainGain) {
      const linearGain = options.gainDb != null
        ? Math.max(0.01, Math.min(4, Math.pow(10, options.gainDb / 20)))
        : 1;
      this.mainGain.gain.value = linearGain;
    }

    if (options.playbackRate != null) {
      el.playbackRate = options.playbackRate;
    }

    el.src = src;
    el.load();

    const startTime = options.startTime;
    if (startTime != null && startTime > 0) {
      // Seek once metadata is available — cannot seek before the browser knows the duration.
      const applySeek = () => {
        el.currentTime = startTime;
        el.removeEventListener("loadedmetadata", applySeek);
      };
      el.addEventListener("loadedmetadata", applySeek);
    }
  }

  /**
   * Begin playback. Ensures AudioContext is running before attempting play()
   * to avoid DOMException on iOS and Chrome autoplay-policy browsers.
   * @returns {Promise<void>}
   */
  async play() {
    const el = this._boundElement;
    if (!el) return;
    await this.resume();
    await el.play();
  }

  /** Pause playback without unloading the track src. */
  pause() {
    this._boundElement?.pause();
  }

  /**
   * Seek to an absolute position in seconds.
   * @param {number} position
   */
  seek(position) {
    const el = this._boundElement;
    if (!el) return;
    el.currentTime = position;
  }

  /** Stop playback and release the track src, freeing network resources. */
  stop() {
    const el = this._boundElement;
    if (!el) return;
    el.pause();
    try { el.src = ""; el.load(); } catch {}
  }

  /**
   * Apply per-track loudness normalization through mainGain.
   * @param {number} gainDb — positive = louder, negative = quieter
   */
  setTrackGain(gainDb) {
    if (!this.mainGain) return;
    const linearGain = gainDb != null
      ? Math.max(0.01, Math.min(4, Math.pow(10, gainDb / 20)))
      : 1;
    this.mainGain.gain.value = linearGain;
  }

  /**
   * Set playback rate on the audio element.
   * @param {number} rate — 0.25–4.0
   */
  setPlaybackRate(rate) {
    const el = this._boundElement;
    if (!el) return;
    el.playbackRate = rate;
  }

  // ── DSP effects ────────────────────────────────────────────────────────────

  /** @param {boolean} enabled */
  setSpaceMode(enabled) {
    if (this.stereoPanner) this.stereoPanner.pan.value = enabled ? 0.3 : 0;
  }

  /** @param {boolean} enabled */
  setBassMode(enabled) {
    if (this.bassFilter) this.bassFilter.gain.value = enabled ? 6 : 0;
  }

  /** @param {number} level — 0–5 */
  setAtmosphereLevel(level) {
    if (this.analyser) this.analyser.smoothingTimeConstant = Math.max(0, Math.min(1, level / 5));
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /** @returns {number} */
  getCurrentTime() {
    return this._boundElement?.currentTime ?? 0;
  }

  /** @returns {number} */
  getDuration() {
    const d = this._boundElement?.duration;
    return d != null && Number.isFinite(d) ? d : 0;
  }

  /** @returns {number} */
  getBufferedEnd() {
    const el = this._boundElement;
    if (!el) return 0;
    try {
      const buf = el.buffered;
      if (buf && buf.length > 0) return buf.end(buf.length - 1);
    } catch {}
    return 0;
  }

  /** @returns {boolean} */
  isPlaying() {
    const el = this._boundElement;
    return Boolean(el && !el.paused && !el.ended && el.readyState >= 2);
  }

  /** @returns {boolean} */
  isLoaded() {
    return Boolean(this._boundElement?.src);
  }

  // ── Audio element event forwarding ─────────────────────────────────────────
  // Attach these listeners to delegate audio element events to engine.on() subscribers.
  // AudioContext.js calls _attachAudioElementListeners() during Phase B-2 migration,
  // at which point it removes its own direct element event handlers and subscribes
  // to the engine's event system instead.

  /**
   * Forward audio element DOM events to this engine's event emitter.
   * Safe to call multiple times — detaches previous listeners first.
   * @param {HTMLAudioElement} el
   */
  _attachAudioElementListeners(el) {
    this._detachAudioElementListeners();
    const E = AUDIO_ENGINE_EVENTS;

    this._elListeners = [
      ["play",           () => this._emit(E.PLAY,           { currentTime: el.currentTime })],
      ["pause",          () => this._emit(E.PAUSE,          { currentTime: el.currentTime })],
      ["ended",          () => this._emit(E.ENDED)],
      ["waiting",        () => this._emit(E.BUFFERING)],
      ["stalled",        () => this._emit(E.STALLED)],
      ["playing",        () => this._emit(E.BUFFERED)],
      ["canplay",        () => this._emit(E.CANPLAY)],
      ["canplaythrough", () => this._emit(E.CANPLAYTHROUGH)],
      ["seeked",         () => this._emit(E.SEEKED,         { currentTime: el.currentTime })],
      ["timeupdate",     () => this._emit(E.TIMEUPDATE,     { currentTime: el.currentTime, duration: el.duration || 0 })],
      ["durationchange", () => this._emit(E.DURATIONCHANGE, { duration: Number.isFinite(el.duration) ? el.duration : 0 })],
      ["loadedmetadata", () => this._emit(E.LOADEDMETADATA, { duration: Number.isFinite(el.duration) ? el.duration : 0 })],
      ["emptied",        () => this._emit(E.EMPTIED)],
      ["error",          () => {
        const err = el.error;
        this._emit(E.ERROR, { code: err?.code ?? null, message: err?.message ?? null });
      }],
      ["volumechange",   () => this._emit(E.VOLUME,         { volume: el.volume })],
      ["ratechange",     () => this._emit(E.RATE_CHANGE,    { playbackRate: el.playbackRate })],
    ];

    for (const [evt, fn] of this._elListeners) {
      el.addEventListener(evt, fn);
    }
    this._listenerElement = el;
  }

  /**
   * Remove all previously attached audio element event listeners.
   * Safe to call even if no listeners are attached.
   */
  _detachAudioElementListeners() {
    if (!this._listenerElement || !this._elListeners) return;
    for (const [evt, fn] of this._elListeners) {
      try { this._listenerElement.removeEventListener(evt, fn); } catch {}
    }
    this._elListeners = null;
    this._listenerElement = null;
  }
}

/** @type {WebAudioEngine|null} */
let _engine = null;

/**
 * Module-level singleton — one engine per tab, survives React tree tears.
 * @returns {WebAudioEngine}
 */
export function getWebAudioEngine() {
  if (!_engine) _engine = new WebAudioEngine();
  return _engine;
}
