/**
 * Standalone Web Audio graph manager — lives entirely outside React.
 * Owns the AudioContext, MediaElementSourceNode, and all downstream nodes.
 * Survives React provider remounts and route changes; graph is built once and persists.
 *
 * Signal chain (Spotify-architecture):
 *   source → mainGain → userGain → transitionGain → analyser → stereoPanner → bassFilter → limiter → destination
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
    this._pendingReposition = null;
    this._basePresentations = new WeakMap();
    this._screwPlaybackRate = null;
    this._presentationElement = null;
    /** @type {MediaElementAudioSourceNode|null} */
    this.source = null;
    /** @type {GainNode|null} Per-track normalization + crossfade fader. */
    this.mainGain = null;
    this._transitionGain = null;
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
    this._effectRouting = null;
    this._effectChange = null;

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

    // A dedicated fader keeps seek smoothing independent of normalization,
    // user volume, and preview fades. Created only with the existing graph.
    const transitionGain = ctx.createGain();
    transitionGain.gain.value = 1;

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
    try { this._transitionGain?.disconnect(); } catch {}
    try { this.userGain?.disconnect(); } catch {}
    try { this.analyser?.disconnect(); } catch {}
    try { this.stereoPanner?.disconnect(); } catch {}
    try { this.bassFilter?.disconnect(); } catch {}
    try { this.limiter?.disconnect(); } catch {}
    try { source.disconnect(this.mainGain); } catch {}

    // Primary chain: source → mainGain → userGain → transitionGain → analyser → stereoPanner → bassFilter → limiter → destination
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

    userGain.connect(transitionGain);
    transitionGain.connect(analyser);
    analyser.connect(stereoPanner);
    stereoPanner.connect(bassFilter);
    this._applyChain(bassFilter, limiter);
    limiter.connect(ctx.destination);

    this.mainGain = mainGain;
    this._transitionGain = transitionGain;
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
    // Some browsers expose a sink change without suspending the context.
    // This is a reconciliation hint only, never proof of physical routing.
    this.ctx.addEventListener?.("sinkchange", () => this._onContextRunning?.());
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
      this.applyPlaybackPresentation(el, { playbackRate: options.playbackRate });
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
    this.cancelPendingReposition();
    this._boundElement?.pause();
  }

  /**
   * Seek to an absolute position in seconds.
   * @param {number} position
   */
  seek(position, { audio = this._boundElement, isCurrent = () => true, onSeek } = {}) {
    if (!audio || !Number.isFinite(position)) return;
    const pending = this.rampAcrossReposition(() => {
      audio.currentTime = Math.max(0, Math.min(position, Number.isFinite(audio.duration) ? audio.duration : position));
      onSeek?.(audio.currentTime);
    }, 0.02, { audio, isCurrent, allowMovingPosition: true, waitForSeek: true });
    if (pending) {
      pending.seekTarget = Math.max(0, Math.min(position, Number.isFinite(audio.duration) ? audio.duration : position));
    }
  }

  getSeekPosition(audio = this._boundElement) {
    const pending = this._pendingReposition;
    return pending?.audio === audio && pending.src === audio?.src && Number.isFinite(pending.seekTarget)
      ? pending.seekTarget : audio?.currentTime || 0;
  }

  /** Stop playback and release the track src, freeing network resources. */
  stop() {
    this.cancelPendingReposition();
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
    this.applyPlaybackPresentation(el, { ...this.getPlaybackPresentation(el), playbackRate: rate });
  }

  // The persistent engine resolves base presentation and live Screw intent.
  // Reapplying a source/CS presentation cannot silently clear the live effect.
  getPlaybackPresentation(audio = this._boundElement) {
    return this._basePresentations.get(audio) || {
      playbackRate: audio?.playbackRate ?? 1,
      preservesPitch: audio?.preservesPitch ?? true,
    };
  }

  applyPlaybackPresentation(audio, { playbackRate = 1, preservesPitch = true } = {}) {
    if (!audio || !Number.isFinite(playbackRate) || playbackRate <= 0) return;
    this._basePresentations.set(audio, { playbackRate, preservesPitch });
    this._presentationElement = audio;
    const rate = this._screwPlaybackRate ?? playbackRate;
    const pitch = this._screwPlaybackRate == null ? preservesPitch : false;
    // Avoid redundant native writes on healthy continuation/gesture callbacks.
    for (const key of ["preservesPitch", "mozPreservesPitch", "webkitPreservesPitch", "webkitPreservePitch"]) {
      if (key in audio && audio[key] !== pitch) audio[key] = pitch;
    }
    if (audio.playbackRate !== rate) audio.playbackRate = rate;
  }

  setScrewPlaybackRate(rate) {
    if (rate != null && (!Number.isFinite(rate) || rate <= 0)) return;
    const audio = this._boundElement || this._presentationElement;
    const base = this.getPlaybackPresentation(audio);
    this._screwPlaybackRate = rate;
    this.applyPlaybackPresentation(audio, base);
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
    clearTimeout(this._effectChange?.timer);
    this._effectChange = null;
    const previous = this._effectRouting;
    if (previous) {
      try { previous.dry.disconnect(); } catch {}
      try { previous.wet.disconnect(); } catch {}
      for (const node of previous.nodes) { try { node.disconnect(); } catch {} }
    }
    // Fixed dry/wet faders belong to this graph. Gestures never rebuild the
    // player or reconnect its primary path; only the silent wet input changes.
    try { bassFilter.disconnect(limiter); } catch {}
    const dry = this.ctx.createGain();
    const wet = this.ctx.createGain();
    dry.gain.value = this._chainExtensionNodes.length ? 0 : 1;
    wet.gain.value = this._chainExtensionNodes.length ? 1 : 0;
    bassFilter.connect(dry);
    dry.connect(limiter);
    wet.connect(limiter);
    const route = { ctx: this.ctx, bassFilter, limiter, dry, wet, nodes: [] };
    this._effectRouting = route;
    this._replaceWetNodes(route, this._chainExtensionNodes);
  }

  _replaceWetNodes(route, nodes) {
    if (route.nodes.length) {
      try { route.bassFilter.disconnect(route.nodes[0]); } catch {}
      for (const node of route.nodes) { try { node.disconnect(); } catch {} }
    }
    route.nodes = nodes;
    if (!nodes.length) return;
    route.bassFilter.connect(nodes[0]);
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    nodes[nodes.length - 1].connect(route.wet);
  }

  /** Change only the effect input, at zero wet gain, with complementary fades. */
  setChainExtension(nodes) {
    if (!this.bassFilter || !this.limiter || !this.ctx) return;
    const next = Array.isArray(nodes) ? nodes : [];
    if (!this._effectRouting || this._effectRouting.ctx !== this.ctx ||
        this._effectRouting.bassFilter !== this.bassFilter || this._effectRouting.limiter !== this.limiter) {
      this._applyChain(this.bassFilter, this.limiter);
    }
    if (next.length === this._chainExtensionNodes.length &&
        next.every((node, i) => node === this._chainExtensionNodes[i])) return;
    this._chainExtensionNodes = next;
    clearTimeout(this._effectChange?.timer);
    this._effectChange = null;
    const route = this._effectRouting;
    const ctx = route.ctx;
    const fadeSec = 0.01;
    const fade = (wetTarget, immediate = false) => {
      const now = ctx.currentTime;
      for (const [param, target] of [[route.wet.gain, wetTarget], [route.dry.gain, 1 - wetTarget]]) {
        if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
        else {
          const value = param.value;
          param.cancelScheduledValues(now);
          param.setValueAtTime(value, now);
        }
        if (immediate) param.setValueAtTime(target, now);
        else param.linearRampToValueAtTime(target, now + fadeSec);
      }
    };
    if (ctx.state !== "running") {
      this._replaceWetNodes(route, next);
      fade(next.length ? 1 : 0, true);
      return;
    }
    // Reversing a pending handoff to the still-wired owner needs no rewiring.
    if (next.length === route.nodes.length && next.every((node, i) => node === route.nodes[i])) {
      fade(next.length ? 1 : 0);
      return;
    }
    if (!route.nodes.length) {
      this._replaceWetNodes(route, next);
      fade(next.length ? 1 : 0);
      return;
    }
    // Fade back to dry before replacing or removing an audible effect.
    fade(0);
    const fadeEnd = ctx.currentTime + fadeSec;
    const pending = { timer: null };
    this._effectChange = pending;
    const replace = () => {
      if (this._effectChange !== pending || this._effectRouting !== route) return;
      if (ctx.state === "running" && ctx.currentTime + 1e-9 < fadeEnd) {
        pending.timer = setTimeout(replace, Math.max(1, Math.ceil((fadeEnd - ctx.currentTime) * 1000)));
        return;
      }
      this._effectChange = null;
      if (ctx.state !== "running") fade(0, true);
      this._replaceWetNodes(route, next);
      fade(next.length ? 1 : 0, ctx.state !== "running");
    };
    pending.timer = setTimeout(replace, Math.round(fadeSec * 1000));
  }

  /**
   * Set preservesPitch on the bound audio element (all cross-browser variants).
   * Pass false for real-time screw pitch shift; pass true to restore.
   * @param {boolean} value
   */
  setPreservesPitch(value) {
    const el = this._boundElement;
    if (!el) return;
    this.applyPlaybackPresentation(el, { ...this.getPlaybackPresentation(el), preservesPitch: Boolean(value) });
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

  /** Cancel the owned delayed reposition and restore its transition fader. */
  cancelPendingReposition() {
    this._pendingReposition?.finish();
  }

  /**
   * Fade the dedicated output fader, reposition at audio-clock silence, then
   * restore after seek readiness. Recovery keeps its strict stalled-position
   * guard; user seeks opt into advancing playback and current-intent guards.
   * With no live graph (or while paused), reposition immediately.
   */
  rampAcrossReposition(reposition, fadeSec = 0.02, {
    audio = this._boundElement, isCurrent = () => true,
    allowMovingPosition = false, waitForSeek = false,
  } = {}) {
    const previousTarget = this._pendingReposition?.restoreTo;
    this.cancelPendingReposition();
    if (!isCurrent()) return;
    const ctx = this.ctx;
    const gain = this._transitionGain || this.mainGain;
    if (!ctx || !gain || ctx.state !== "running" || audio?.paused || audio !== this._boundElement) {
      reposition();
      return;
    }
    const src = audio?.src;
    const position = audio?.currentTime;
    const now = ctx.currentTime;
    const restoreTo = this._transitionGain ? 1 : previousTarget ?? gain.gain.value;
    const ownsGraph = () => this.ctx === ctx && (this._transitionGain || this.mainGain) === gain;
    const ownsPosition = () => this._boundElement === audio && (!audio ||
      (audio.src === src && (allowMovingPosition || audio.currentTime === position) && !audio.paused && !audio.ended));
    const hold = () => {
      const t = ctx.currentTime;
      if (typeof gain.gain.cancelAndHoldAtTime === "function") gain.gain.cancelAndHoldAtTime(t);
      else {
        const current = gain.gain.value;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(current, t);
      }
      return t;
    };
    const events = [];
    const pending = {
      restoreTo, audio, src, timer: null, finished: false, seeking: false,
      finish: () => {
        if (pending.finished) return;
        pending.finished = true;
        clearTimeout(pending.timer);
        events.forEach(([event, fn]) => audio?.removeEventListener?.(event, fn));
        if (this._pendingReposition === pending) this._pendingReposition = null;
        // Restore only the owned transition fader; never alter normalization.
        if (ownsGraph() && ctx.state !== "closed") {
          const t = hold();
          gain.gain.linearRampToValueAtTime(restoreTo, t + fadeSec);
        }
      },
    };
    const listen = (event, fn) => {
      audio?.addEventListener?.(event, fn);
      events.push([event, fn]);
    };
    for (const event of ["pause", "ended", "emptied", "error"]) listen(event, pending.finish);
    if (waitForSeek) {
      const ready = () => {
        if (!isCurrent() || !ownsGraph() || !ownsPosition()) return pending.finish();
        if (pending.seeking && !audio.seeking && audio.readyState >= 2) pending.finish();
      };
      listen("seeked", ready);
      listen("canplay", ready);
      // A seek outside this owner supersedes the delayed operation as well.
      listen("seeking", () => { if (!pending.seeking) pending.finish(); });
    }
    this._pendingReposition = pending;
    hold();
    const fadeEnd = now + fadeSec;
    const fadeDeadline = Date.now() + 2000;
    gain.gain.linearRampToValueAtTime(0, fadeEnd);
    const perform = () => {
      if (this._pendingReposition !== pending) return;
      if (!isCurrent() || !ownsGraph() || !ownsPosition() || ctx.state !== "running" || Date.now() >= fadeDeadline) return pending.finish();
      // Wall-clock timers can run before the audio clock reaches silence.
      if (ctx.currentTime + 1e-9 < fadeEnd) {
        pending.timer = setTimeout(perform, Math.max(1, Math.ceil((fadeEnd - ctx.currentTime) * 1000)));
        return;
      }
      try {
        pending.seeking = true;
        reposition();
        if (pending.finished) return;
        if (waitForSeek && (audio.seeking || audio.readyState < 2)) {
          // Readiness is event-driven; timeout guarantees the fader cannot stay muted.
          pending.timer = setTimeout(pending.finish, 2000);
          return;
        }
      } catch {
        // Recovery remains best-effort; always restore the owned fader.
      }
      pending.finish();
    };
    pending.timer = setTimeout(perform, Math.round(fadeSec * 1000));
    return pending;
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
