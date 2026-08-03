/**
 * HLSEngine — hls.js wrapper for 2MRRW adaptive bitrate streaming.
 *
 * Attaches to the existing singleton <audio> element that is already bound
 * to the Web Audio graph (MediaElementSourceNode). hls.js feeds segments
 * via the MSE API at the media layer — entirely below the Web Audio graph.
 * No additional MediaElementSourceNode is created; the existing audio processing
 * chain (mainGain → userGain → analyser → stereoPanner → bassFilter → limiter)
 * continues to work unchanged.
 *
 * Lifecycle:
 *   1. AudioContext.js calls HLSEngine.loadTrack(manifestUrl, audioEl)
 *   2. HLSEngine fetches master.m3u8 → hls.js picks a bitrate → buffers segments
 *   3. audioEl.play() resumes (called by AudioContext.js as usual)
 *   4. On 404 manifest → onFallback() fires → AudioContext falls back to progressive download
 *   5. On track change → HLSEngine.detach() destroys the hls.js instance cleanly
 *
 * Thread safety: all public methods are synchronous (hls.js is single-threaded).
 * The MSE decryption runs in a background Worker inside hls.js itself.
 */

let _Hls = null;

/**
 * Lazy-load hls.js (client-only). Safe to call multiple times.
 * Returns null in SSR, null if native HLS is sufficient (Safari).
 */
async function importHls() {
  if (typeof window === "undefined") return null;
  if (_Hls) return _Hls;
  try {
    const mod = await import("hls.js");
    _Hls = mod.default ?? mod;
    return _Hls;
  } catch (err) {
    console.error("[HLSEngine] hls.js import failed", err);
    return null;
  }
}

export class HLSEngine {
  constructor() {
    /** @type {import("hls.js").default|null} */
    this._hls = null;
    /** @type {HTMLAudioElement|null} */
    this._audioEl = null;
    /** @type {string|null} Currently loaded manifest URL */
    this._manifestUrl = null;
    /** @type {boolean} */
    this._destroyed = false;
    /** @type {(() => void)|null} Called when HLS manifest 404s — triggers progressive fallback */
    this.onFallback = null;
    /** @type {((err: Error) => void)|null} Called on fatal hls.js errors */
    this.onError = null;
    /** @type {number} Current bitrate index (0 = auto) */
    this._currentLevel = -1;
  }

  get isLoaded() {
    return Boolean(this._hls && this._manifestUrl);
  }

  get currentBitrateKbps() {
    if (!this._hls) return null;
    const lvl = this._hls.levels?.[this._hls.currentLevel];
    return lvl ? Math.round(lvl.bitrate / 1000) : null;
  }

  /**
   * Attach hls.js to the audio element and start loading the manifest.
   *
   * @param {string}           manifestUrl  /api/library/hls?slug=... (master m3u8)
   * @param {HTMLAudioElement} audioEl      The singleton playback element
   * @param {{ startPosition?: number }} opts
   * @returns {Promise<boolean>} true = HLS loaded, false = falls back to progressive
   */
  async loadTrack(manifestUrl, audioEl, { startPosition = 0 } = {}) {
    if (this._destroyed) return false;

    const Hls = await importHls();

    // Safari handles HLS natively via src= — no hls.js needed
    if (!Hls || !Hls.isSupported()) {
      // Assign the manifest URL directly — Safari's native HLS player takes over
      audioEl.src = manifestUrl;
      this._audioEl = audioEl;
      this._manifestUrl = manifestUrl;
      return true;
    }

    // Tear down any existing instance before reusing
    this._destroyHls();

    const hls = new Hls({
      // Playback robustness
      enableWorker:               true,
      lowLatencyMode:             false,

      // Buffer targets — music is VOD, prioritise uninterrupted playback over low latency
      maxBufferLength:            60,         // seconds of forward buffer
      maxMaxBufferLength:         120,
      maxBufferSize:              60 * 1000 * 1000, // 60 MB (3 × 20 MB per bitrate)
      backBufferLength:           30,

      // ABR — start at highest quality; network-quality module may override
      startLevel:                 0,          // 0 = first in master playlist (highest bitrate)
      abrEwmaDefaultEstimate:     3_000_000,  // 3 Mbps initial estimate (generous for music)
      abrBandWidthFactor:         0.95,
      abrBandWidthUpFactor:       0.7,

      // Retry policy
      manifestLoadingMaxRetry:    3,
      levelLoadingMaxRetry:       3,
      fragLoadingMaxRetry:        3,
      manifestLoadingRetryDelay:  1000,
      levelLoadingRetryDelay:     1000,
      fragLoadingRetryDelay:      1000,

      // Seek position for resume / direct-play-at-offset
      startPosition,

      // Debug (disable in production)
      debug: process.env.NODE_ENV === "development",
    });

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR &&
          data.response?.code === 404) {
        // Track not yet transcoded — fall back to progressive download
        this._destroyHls();
        this.onFallback?.();
        return;
      }

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        // Transient network issue — try to recover once
        hls.startLoad();
        return;
      }

      // Fatal non-network error — report up
      const err = new Error(
        `hls.js fatal error: ${data.type} / ${data.details}`
      );
      this._destroyHls();
      this.onError?.(err);
    });

    hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
      // Apply a network-quality override if one was set before load
      if (this._currentLevel >= 0 && this._currentLevel < data.levels.length) {
        hls.currentLevel = this._currentLevel;
      }
    });

    hls.loadSource(manifestUrl);
    hls.attachMedia(audioEl);

    this._hls       = hls;
    this._audioEl   = audioEl;
    this._manifestUrl = manifestUrl;

    return true;
  }

  /**
   * Set the ABR quality level.
   * -1 = full auto, 0 = highest, levels.length-1 = lowest.
   */
  setQualityLevel(levelIndex) {
    this._currentLevel = levelIndex;
    if (this._hls) {
      this._hls.currentLevel = levelIndex;
    }
  }

  /**
   * Seek within the current track (supplements audioEl.currentTime for HLS buffer management).
   */
  seekTo(seconds) {
    if (!this._hls || !this._audioEl) return;
    this._audioEl.currentTime = seconds;
    this._hls.startLoad(seconds);
  }

  /**
   * Detach from the audio element and destroy the hls.js instance.
   * Must be called before loading a new track or destroying the engine.
   */
  detach() {
    this._destroyHls();
    this._manifestUrl = null;
    this._audioEl     = null;
  }

  _destroyHls() {
    if (this._hls) {
      try { this._hls.detachMedia(); } catch {}
      try { this._hls.destroy();     } catch {}
      this._hls = null;
    }
  }

  destroy() {
    this._destroyed = true;
    this._destroyHls();
    this._audioEl     = null;
    this._manifestUrl = null;
    this.onFallback   = null;
    this.onError      = null;
  }
}

/** Module-level singleton for the currently playing track's HLS engine. */
let _activeEngine = null;

export function getHLSEngine() {
  if (!_activeEngine) _activeEngine = new HLSEngine();
  return _activeEngine;
}

export function replaceHLSEngine() {
  if (_activeEngine) _activeEngine.destroy();
  _activeEngine = new HLSEngine();
  return _activeEngine;
}
