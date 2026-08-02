/**
 * Standalone Web Audio graph manager — lives entirely outside React.
 * Owns the AudioContext, MediaElementSourceNode, and all downstream nodes.
 * Survives React provider remounts and route changes; graph is built once and persists.
 *
 * Signal chain (Spotify-architecture):
 *   source → mainGain → userGain → analyser → stereoPanner → bassFilter → limiter → destination
 *
 * mainGain  — per-track loudness normalization + crossfade amplitude (managed by crossfade engine)
 * userGain  — user volume preference (0–1, persisted to localStorage)
 *             This is the single volume authority. HTMLAudioElement.volume is locked at 1.0.
 *
 * crossfadeGain (caller-owned) wires into userGain so both the fading-out track and the
 * fading-in track pass through the same user-volume GainNode. Changing volume during a
 * crossfade affects both tracks equally.
 */

const MRRW_SOURCE_BOUND = Symbol.for("2mrrw.mediaElementSourceBound");
const VOL_KEY = "2mrrw-vol";

export class WebAudioEngine {
  constructor() {
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
    /** @type {ReturnType<typeof setInterval>|null} Active-playback context guardian handle. */
    this._guardId = null;
  }

  // ── Playback guardian ───────────────────────────────────────────────────────

  /**
   * Start the active-playback AudioContext guardian.
   *
   * During playback the AudioContext must stay in "running" state — iOS Safari
   * can auto-suspend it on audio.load(), phone interruptions, or background
   * transitions. The guardian polls every 250 ms and calls resume() the instant
   * it detects a suspension, so the context is always running before the next
   * audio frame is rendered. Spotify's engine applies the same invariant: the
   * playback engine owns the context lifecycle, not individual call sites.
   *
   * Call startPlaybackGuard() when audio starts playing (onPlay element event).
   * Call stopPlaybackGuard() when audio pauses or stops (onPause / onEnded).
   */
  startPlaybackGuard() {
    if (this._guardId !== null) return; // already running
    let _guardTick = 0;
    this._guardId = setInterval(() => {
      _guardTick += 1;
      const state = this.ctx?.state ?? "no-ctx";
      if (_guardTick <= 8 || state !== "running") {
        console.warn("[AUDIO-DIAG] guardian tick #" + _guardTick + " ctx.state=" + state);
      }
      if (!this.ctx || this.ctx.state === "running" || this.ctx.state === "closed") return;
      void this.ctx.resume()
        .then(() => console.warn("[AUDIO-DIAG] guardian resume() RESOLVED ctx.state=", this.ctx?.state))
        .catch((err) => console.warn("[AUDIO-DIAG] guardian resume() REJECTED", err?.message ?? err));
    }, 250);
  }

  stopPlaybackGuard() {
    if (this._guardId === null) return;
    clearInterval(this._guardId);
    this._guardId = null;
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
      this.ctx = new Ctx();
      this._attachStateChange();
    }

    if (!this.source || this._boundElement !== audioEl) {
      if (!audioEl[MRRW_SOURCE_BOUND]) {
        this.source = this.ctx.createMediaElementSource(audioEl);
        audioEl[MRRW_SOURCE_BOUND] = true;
        this._boundElement = audioEl;
      } else if (!this.source) {
        return { ok: false };
      }
    }

    return { ok: true };
  }

  // ── Graph ───────────────────────────────────────────────────────────────────

  /**
   * Build or rebuild the downstream processing chain.
   * Disconnects stale nodes before connecting fresh ones to prevent fan-out accumulation.
   * After this call, HTMLAudioElement.volume is locked at 1.0.
   *
   * @param {GainNode|null} crossfadeGain  Existing crossfade gain to re-wire through userGain.
   */
  buildGraph(crossfadeGain = null) {
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
    try { crossfadeGain?.disconnect(); } catch {}
    try { source.disconnect(this.mainGain); } catch {}

    // Primary chain: source → mainGain → userGain → analyser → stereoPanner → bassFilter → limiter → destination
    source.connect(mainGain);
    mainGain.connect(userGain);
    userGain.connect(analyser);
    analyser.connect(stereoPanner);
    stereoPanner.connect(bassFilter);
    bassFilter.connect(limiter);
    limiter.connect(ctx.destination);

    // Crossfade channel routes through userGain so both tracks respect user volume equally.
    if (crossfadeGain) {
      try { crossfadeGain.connect(userGain); } catch {}
    }

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
