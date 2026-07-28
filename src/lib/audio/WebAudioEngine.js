/**
 * Standalone Web Audio graph manager — lives entirely outside React.
 * Owns the AudioContext, MediaElementSourceNode, and all downstream nodes.
 * Survives React provider remounts and route changes; graph is built once and persists.
 *
 * Chain: source → mainGain → analyser → stereoPanner → bassFilter → limiter → destination
 */

const MRRW_SOURCE_BOUND = Symbol.for("2mrrw.mediaElementSourceBound");
const VOL_KEY = "2mrrw-vol";

export class WebAudioEngine {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {MediaElementAudioSourceNode|null} */
    this.source = null;
    /** @type {GainNode|null} mainGain — normalization + crossfade fader. Never set el.volume here. */
    this.mainGain = null;
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
   * @param {number} level  0–1 inclusive
   */
  setUserVolume(level) {
    const v = Math.max(0, Math.min(1, Number(level)));
    if (!Number.isFinite(v)) return;
    this._userVolume = v;
    if (this._boundElement) this._boundElement.volume = v;
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
      this.ctx = new Ctx();
      this._attachStateChange();
    }

    if (!this.source || this._boundElement !== audioEl) {
      if (!audioEl[MRRW_SOURCE_BOUND]) {
        this.source = this.ctx.createMediaElementSource(audioEl);
        audioEl[MRRW_SOURCE_BOUND] = true;
        this._boundElement = audioEl;
      } else if (!this.source) {
        // Source was created for this element in a prior session but the node reference
        // was lost. A MediaElementSourceNode can only be created once per element.
        return { ok: false };
      }
      // else: source exists and element matches — nothing to create
    }

    return { ok: true };
  }

  // ── Graph ───────────────────────────────────────────────────────────────────

  /**
   * Build or rebuild the downstream processing chain.
   * Disconnects stale nodes before connecting fresh ones to prevent fan-out accumulation.
   *
   * @param {GainNode|null} crossfadeGain  Existing crossfade gain to re-wire into new graph.
   */
  buildGraph(crossfadeGain = null) {
    const ctx = this.ctx;
    const source = this.source;
    if (!ctx || !source) return;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const stereoPanner = ctx.createStereoPanner();
    stereoPanner.pan.value = 0;

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = "lowshelf";
    bassFilter.frequency.value = 200;
    bassFilter.gain.value = 0;

    const mainGain = ctx.createGain();
    mainGain.gain.value = 1;

    // Transparent limiter — only activates above −1 dBFS, preserves the artist's master.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;

    try { this.mainGain?.disconnect(); } catch {}
    try { this.analyser?.disconnect(); } catch {}
    try { this.stereoPanner?.disconnect(); } catch {}
    try { this.bassFilter?.disconnect(); } catch {}
    try { this.limiter?.disconnect(); } catch {}
    try { crossfadeGain?.disconnect(); } catch {}
    try { source.disconnect(this.mainGain); } catch {}

    source.connect(mainGain);
    mainGain.connect(analyser);
    analyser.connect(stereoPanner);
    stereoPanner.connect(bassFilter);
    bassFilter.connect(limiter);
    limiter.connect(ctx.destination);

    // Re-wire crossfade channel into the new analyser so it passes through
    // stereoPanner → bassFilter → limiter → destination (not direct to destination).
    if (crossfadeGain) {
      try { crossfadeGain.connect(analyser); } catch {}
    }

    this.mainGain = mainGain;
    this.analyser = analyser;
    this.stereoPanner = stereoPanner;
    this.bassFilter = bassFilter;
    this.limiter = limiter;
  }

  // ── AudioContext lifecycle ──────────────────────────────────────────────────

  _attachStateChange() {
    if (!this.ctx) return;
    this.ctx.onstatechange = () => {
      if (this.ctx.state === "suspended" || this.ctx.state === "interrupted") {
        void this.ctx.resume().catch(() => {});
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
