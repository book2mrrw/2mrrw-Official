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
import { playAudioIfNotPaused } from "@/lib/audio/audio-element-utils";

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
    /** @type {AudioNode[]} Nodes inserted between bassFilter and limiter by effect engines. */
    this._chainExtensionNodes = [];

    // ── Two-deck representation handoff ──────────────────────────────────────
    /** @type {GainNode|null} Standby deck fader — parallel to mainGain, permanently wired to userGain, normally gain=0. */
    this._standbyGain = null;
    /** @type {MediaElementAudioSourceNode|null} Standby deck audio source. */
    this._standbySource = null;
    /** @type {HTMLAudioElement|null} Standby deck audio element. */
    this._standbyElement = null;

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
      // Clear standby bindings — nodes belong to the dead context.
      if (this._standbyElement) {
        try { this._standbyElement[MRRW_SOURCE_BOUND] = false; } catch {}
      }
      this.source          = null;
      this._boundElement   = null;
      this._standbyGain    = null;
      this._standbySource  = null;
      this._standbyElement = null;
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

    // Standby deck fader — parallel input to userGain, starts silent.
    // Reused across buildGraph() calls (same ctx); fresh node if context changed.
    let sGain;
    if (this._standbyGain && this._standbyGain.context === ctx) {
      sGain = this._standbyGain;
      try { sGain.disconnect(); } catch {}  // detach from old userGain
    } else {
      sGain = ctx.createGain();
      sGain.gain.value = 0;
    }
    sGain.connect(userGain);
    this._standbyGain = sGain;

    // Reconnect standby source to the (possibly new) standby gain node.
    if (this._standbySource && this._standbySource.context === ctx) {
      try { this._standbySource.disconnect(); } catch {}
      this._standbySource.connect(sGain);
    } else if (this._standbySource) {
      // Stale source from a dead context — release the element binding.
      if (this._standbyElement) {
        try { this._standbyElement[MRRW_SOURCE_BOUND] = false; } catch {}
      }
      this._standbySource  = null;
      this._standbyElement = null;
    }

    userGain.connect(analyser);
    analyser.connect(stereoPanner);
    stereoPanner.connect(bassFilter);
    this._applyChain(bassFilter, limiter);
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
  async play(effectContext = {}) {
    const el = this._boundElement;
    if (!el) return;
    await this.resume();
    return playAudioIfNotPaused(el, true, {
      command: "WEB_AUDIO_ENGINE_PLAY",
      ...effectContext,
    });
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

  // ── Chain extension (effect engines) ──────────────────────────────────────

  /**
   * Internal: connect bassFilter → (extension nodes) → limiter.
   * Called from buildGraph() and setChainExtension().
   */
  _applyChain(bassFilter, limiter) {
    const nodes = this._chainExtensionNodes;
    if (!nodes || nodes.length === 0) {
      bassFilter.connect(limiter);
    } else {
      bassFilter.connect(nodes[0]);
      for (let i = 0; i < nodes.length - 1; i++) {
        nodes[i].connect(nodes[i + 1]);
      }
      nodes[nodes.length - 1].connect(limiter);
    }
  }

  /**
   * Insert AudioNodes between bassFilter and limiter.
   * Pass an empty array to remove extensions and restore direct connection.
   * Effect engines call this to activate / deactivate themselves.
   * @param {AudioNode[]} nodes
   */
  setChainExtension(nodes) {
    if (!this.bassFilter || !this.limiter) return;
    // Tear down current chain from bassFilter outward.
    try { this.bassFilter.disconnect(); } catch {}
    const prev = this._chainExtensionNodes;
    if (prev && prev.length) {
      for (const n of prev) { try { n.disconnect(); } catch {} }
    }
    this._chainExtensionNodes = Array.isArray(nodes) ? nodes : [];
    this._applyChain(this.bassFilter, this.limiter);
  }

  /**
   * Set preservesPitch on the bound audio element (all cross-browser variants).
   * Pass false for real-time screw pitch shift; pass true to restore.
   * @param {boolean} value
   */
  setPreservesPitch(value) {
    const el = this._boundElement;
    if (!el) return;
    const v = Boolean(value);
    if ("preservesPitch"        in el) el.preservesPitch        = v;
    if ("mozPreservesPitch"     in el) el.mozPreservesPitch     = v;
    if ("webkitPreservesPitch"  in el) el.webkitPreservesPitch  = v;
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

  // ── Two-deck representation handoff API ────────────────────────────────────

  /**
   * Bind a standby audio element into the Web Audio graph via the standby gain node.
   * The standby gain is permanently wired to userGain and starts at 0 — no audible output
   * until startCrossfade() raises it. Safe to call multiple times (idempotent per element).
   *
   * @param {HTMLAudioElement|null} el  Pass null to release the current standby binding.
   * @returns {{ ok: boolean }}
   */
  bindStandbyElement(el) {
    if (!this.ctx || !this._standbyGain) return { ok: false };
    if (this._standbyElement === el && el !== null) return { ok: true };

    // Release previous binding.
    if (this._standbyElement) {
      try { this._standbyElement[MRRW_SOURCE_BOUND] = false; } catch {}
    }
    if (this._standbySource) {
      try { this._standbySource.disconnect(); } catch {}
      this._standbySource = null;
    }
    this._standbyElement = null;

    if (!el) return { ok: true };

    if (!el[MRRW_SOURCE_BOUND]) {
      try {
        this._standbySource = this.ctx.createMediaElementSource(el);
        el[MRRW_SOURCE_BOUND] = true;
        this._standbyElement = el;
        this._standbySource.connect(this._standbyGain);
        el.volume = 1;
        return { ok: true };
      } catch (e) {
        console.error("[WebAudioEngine] bindStandbyElement failed", e);
        return { ok: false };
      }
    }

    return { ok: false };
  }

  /**
   * Schedule an equal-power crossfade from the active deck (mainGain) to the standby deck
   * (_standbyGain). All automation runs against AudioContext.currentTime — no React timing.
   *
   * @param {number} durationSec      Crossfade duration in seconds (~0.03)
   * @param {number} standbyNormGain  Target gain for standby (loudness-normalized linear)
   * @param {number} [activeNormGain] Active gain snapshot (reads mainGain.gain.value if omitted)
   */
  startCrossfade(durationSec, standbyNormGain, activeNormGain) {
    if (!this.ctx || !this.mainGain || !this._standbyGain) return;
    const now  = this.ctx.currentTime;
    const end  = now + durationSec;
    const from = activeNormGain ?? this.mainGain.gain.value;

    this.mainGain.gain.cancelScheduledValues(now);
    this.mainGain.gain.setValueAtTime(from, now);
    this.mainGain.gain.linearRampToValueAtTime(0, end);

    this._standbyGain.gain.cancelScheduledValues(now);
    this._standbyGain.gain.setValueAtTime(this._standbyGain.gain.value, now);
    this._standbyGain.gain.linearRampToValueAtTime(standbyNormGain, end);
  }

  /**
   * Cancel a crossfade in progress — smoothly return to stable single-deck state.
   * Call on rapid reversal or abort. Uses a 20ms return ramp to avoid clicks.
   *
   * @param {number} restoreGain  Active deck's normalization gain to restore
   */
  cancelCrossfade(restoreGain) {
    if (!this.ctx || !this.mainGain || !this._standbyGain) return;
    const now = this.ctx.currentTime;
    const end = now + 0.02;

    this.mainGain.gain.cancelScheduledValues(now);
    this.mainGain.gain.setValueAtTime(this.mainGain.gain.value, now);
    this.mainGain.gain.linearRampToValueAtTime(restoreGain, end);

    this._standbyGain.gain.cancelScheduledValues(now);
    this._standbyGain.gain.setValueAtTime(this._standbyGain.gain.value, now);
    this._standbyGain.gain.linearRampToValueAtTime(0, end);
  }

  /** @returns {HTMLAudioElement|null} Active (playing) audio element — public read accessor. */
  getActiveBoundElement() { return this._boundElement; }

  /** @returns {HTMLAudioElement|null} Standby element wired to the silent standby gain. */
  getStandbyElement() { return this._standbyElement; }

  /**
   * Complete a crossfade: swap active and standby deck identities in the JS layer.
   * The Web Audio graph topology is unchanged — both gains remain wired to userGain.
   * Only the role labels (mainGain / _standbyGain, source / _standbySource, etc.) flip.
   *
   * After this call:
   *   this._boundElement  → former standby element (now active)
   *   this._standbyElement → former active element (now recycled standby)
   *   this.mainGain        → former _standbyGain (gain = standbyNormGain)
   *   this._standbyGain    → former mainGain    (gain ≈ 0)
   *
   * Audio element event listeners are re-wired to the new active element automatically.
   *
   * @param {number} standbyNormGain  Final normalization gain of the new active deck
   * @returns {HTMLAudioElement|null}  Former active element (caller updates audioRef.current)
   */
  completeCrossfade(standbyNormGain) {
    if (!this.mainGain || !this._standbyGain || !this._standbyElement) return null;

    // Snap to exact final values — eliminates residual AudioParam ramp error.
    if (this.ctx) {
      const now = this.ctx.currentTime;
      this.mainGain.gain.cancelScheduledValues(now);
      this.mainGain.gain.setValueAtTime(0, now);
      this._standbyGain.gain.cancelScheduledValues(now);
      this._standbyGain.gain.setValueAtTime(standbyNormGain, now);
    }

    // Swap GainNode roles — graph topology unchanged, only JS references flip.
    [this.mainGain, this._standbyGain] = [this._standbyGain, this.mainGain];

    // Swap source + element roles.
    [this.source, this._standbySource] = [this._standbySource, this.source];
    const oldActive = this._boundElement;
    [this._boundElement, this._standbyElement] = [this._standbyElement, this._boundElement];

    // Re-wire DOM event forwarding to the new active element.
    if (this._boundElement) {
      this._attachAudioElementListeners(this._boundElement);
      this._boundElement.volume = 1;
    }

    return oldActive;
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
