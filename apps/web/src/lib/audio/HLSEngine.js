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
let _prefetchLoaderClass = null;

/**
 * Lazy-load hls.js (client-only). Safe to call multiple times.
 * Returns null in SSR, null if native HLS is sufficient (Safari).
 */
import { isPlaybackTraceEnabled } from "@/lib/diagnostics/playback-trace";
import { logPlaybackResilience } from "@/lib/diagnostics/state-churn-log";
import { createPrefetchLoaderClass } from "./hls-prefetch-loader";
import {
  AUDIO_FORWARD_BUFFER_SECONDS,
  AUDIO_INITIAL_BANDWIDTH_ESTIMATE,
  AUDIO_MAX_BUFFER_BYTES,
  AUDIO_MAX_FORWARD_BUFFER_SECONDS,
} from "@/lib/hls/playback-quality-policy";

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

/**
 * Returns a singleton fLoader class (checked once after hls.js is loaded).
 * Falls back to null on any error — hls.js uses its default XHR loader.
 */
function _getPrefetchLoaderClass(Hls) {
  if (_prefetchLoaderClass) return _prefetchLoaderClass;
  try {
    _prefetchLoaderClass = createPrefetchLoaderClass(Hls.DefaultConfig.loader);
  } catch {
    return null;
  }
  return _prefetchLoaderClass;
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
    /** @type {(() => void)|null} Called on fatal segment error after manifest loaded (post-settle) */
    this.onSegmentFatalError = null;
    /** @type {number} Current bitrate index (0 = auto) */
    this._currentLevel = -1;
    /** @type {number} Per-track-load counter for HMAC-token renewal attempts (max 2) */
    this._renewalAttempts = 0;
    /**
     * Monotonic ownership lease for each manifest load attempt. Every detach,
     * replacement, and destroy invalidates the previous generation before a
     * successor can attach. Async callbacks must prove both generation and
     * hls-instance identity before touching the singleton engine.
     */
    this._loadGeneration = 0;
    /** @type {(() => void)|null} Settles an in-flight manifest promise as superseded. */
    this._pendingLoadCancel = null;
    /**
     * Monotonically increasing generation counter. Incremented by detach() whenever
     * a new track takes ownership of the engine. In-flight renewals capture this value
     * at launch and abort if it has changed by the time they reach _destroyHls() or
     * hls attachment — preventing a stale renewal from clobbering the successor track.
     */
    this._manifestVersion = 0;
  }

  get isLoaded() {
    return Boolean(this._hls && this._manifestUrl);
  }

  get currentBitrateKbps() {
    if (!this._hls) return null;
    const lvl = this._hls.levels?.[this._hls.currentLevel];
    return lvl ? Math.round(lvl.bitrate / 1000) : null;
  }

  _invalidateLoadAttempt() {
    this._loadGeneration++;
    const cancel = this._pendingLoadCancel;
    this._pendingLoadCancel = null;
    cancel?.();
  }

  _ownsLoadAttempt(hls, generation) {
    return !this._destroyed && this._loadGeneration === generation && this._hls === hls;
  }

  /**
   * Attach hls.js to the audio element and start loading the manifest.
   *
   * @param {string}           manifestUrl  /api/library/hls?slug=... (master m3u8)
   * @param {HTMLAudioElement} audioEl      The singleton playback element
   * @param {{ startPosition?: number, _version?: number }} opts
   *   _version: internal-only — renewal calls pass the manifestVersion they captured
   *   before _destroyHls(). If the version has advanced (detach() was called for a
   *   new track) the renewal aborts instead of clobbering the successor's hls.js.
   *   External callers omit _version (defaults to -1 = no guard).
   * @returns {Promise<boolean>} true = HLS loaded, false = falls back to progressive
   */
  async loadTrack(manifestUrl, audioEl, { startPosition = 0, _version = -1 } = {}) {
    if (this._destroyed) return false;
    const requestedManifestVersion = _version >= 0 ? _version : this._manifestVersion;
    // Stale-renewal guard (pre-await): if detach() was called between the renewal
    // firing and this point, abort immediately without touching any engine state.
    if (this._manifestVersion !== requestedManifestVersion) return false;

    const Hls = await importHls();

    // Safari handles HLS natively via src= — no hls.js needed
    if (!Hls || !Hls.isSupported()) {
      // Native HLS still owns the singleton media element. Invalidate any prior
      // hls.js attempt before handing that element to AVPlayer.
      this._destroyHls();
      // Assign the manifest URL directly — Safari's native HLS player takes over
      audioEl.src = manifestUrl;
      this._audioEl = audioEl;
      this._manifestUrl = manifestUrl;
      return true;
    }

    // Stale-renewal guard (post-await): importHls() is async; detach() may have
    // fired while we were awaiting. Abort before _destroyHls() so we never destroy
    // the successor track's hls.js instance.
    if (this._manifestVersion !== requestedManifestVersion) return false;

    // Tear down any existing instance before reusing
    this._destroyHls();
    const loadGeneration = this._loadGeneration;

    // Fragment loader: serves pre-fetched segment bytes from the in-memory cache
    // (hls-segment-cache) with zero CDN latency. Falls through to the default
    // XHR loader on cache miss — no behavioral change for uncached segments.
    const fLoader = _getPrefetchLoaderClass(Hls) ?? undefined;

    const hls = new Hls({
      // Playback robustness
      enableWorker:               true,
      lowLatencyMode:             false,

      // Buffer targets — music is VOD, prioritise uninterrupted playback over low latency
      maxBufferLength:            AUDIO_FORWARD_BUFFER_SECONDS,
      maxMaxBufferLength:         AUDIO_MAX_FORWARD_BUFFER_SECONDS,
      maxBufferSize:              AUDIO_MAX_BUFFER_BYTES,
      backBufferLength:           15,

      // ABR — let hls.js pick the starting level via its bandwidth estimate rather
      // than assuming index 0 = highest bitrate. Master playlist ordering is not
      // guaranteed; startLevel: -1 is ordering-independent. The MANIFEST_PARSED
      // handler below remaps _currentLevel by actual bitrate after the manifest lands.
      startLevel:                 -1,
      // Conservative middle-rendition start: hls.js measures the first fragment
      // and upgrades quickly without making the largest fragment a prerequisite.
      abrEwmaDefaultEstimate:     AUDIO_INITIAL_BANDWIDTH_ESTIMATE,
      abrBandWidthFactor:         0.95,
      abrBandWidthUpFactor:       0.7,

      // Manifest loading — fail fast, zero retries.
      // The manifest is ~200 bytes. Any failure (404 = not transcoded, 401, timeout,
      // cold Vercel function) means fall back to progressive download immediately.
      // Retrying the manifest just compounds latency: 3 retries × up to 10 s each
      // was the root cause of 30-second first-play delays. Segment/level loading
      // keeps its own retry budget because those fail for transient reasons mid-stream.
      manifestLoadingMaxRetry:    0,
      manifestLoadingTimeOut:     3000,       // 3 s max — manifests are tiny; slow = broken
      levelLoadingMaxRetry:       3,
      fragLoadingMaxRetry:        3,
      levelLoadingRetryDelay:     1000,
      fragLoadingRetryDelay:      1000,

      // Seek position for resume / direct-play-at-offset
      startPosition,

      // Custom fragment loader: serves pre-fetched segment bytes from memory.
      // undefined = default XHR loader (when createPrefetchLoaderClass fails or SSR).
      fLoader,

      // Debug (disable in production)
      debug: process.env.NODE_ENV === "development",
    });

    // Wrap manifest load in a Promise — settle only when manifest is confirmed
    // (MANIFEST_PARSED) or definitively failed. A 5-second safety timeout is the
    // last-resort guard: if hls.js events are suppressed (browser tab backgrounded,
    // WebWorker suspended) the promise still settles and falls back to progressive.
    return new Promise((resolve) => {
      let settled = false;
      let safetyTimerId = null;
      let networkRecoveryAttempted = false;
      let cancelLoad = null;

      const ownsLoad = () => this._ownsLoadAttempt(hls, loadGeneration);

      const settle = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimerId);
        if (this._pendingLoadCancel === cancelLoad) {
          this._pendingLoadCancel = null;
        }
        resolve(value);
      };

      cancelLoad = () => settle(false);
      this._pendingLoadCancel = cancelLoad;

      // 5 s hard cap — belt-and-suspenders in case hls.js events are suppressed.
      safetyTimerId = setTimeout(() => {
        if (settled) return;
        if (!ownsLoad()) {
          settle(false);
          return;
        }
        this._destroyHls();
        this.onFallback?.();
        settle(false);
      }, 5000);

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!ownsLoad()) {
          settle(false);
          return;
        }
        if (isPlaybackTraceEnabled()) {
          console.log("[PLAY-CHAIN] hls.js error", {
            fatal: data.fatal,
            type: data.type,
            details: data.details,
            settled,
            url: data.url ? data.url.slice(0, 100) : null,
            response: data.response ? { code: data.response.code, text: data.response.text } : null,
          });
        }
        if (!data.fatal) return;

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR &&
            data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
          // Any manifest load failure (404 = not transcoded, 401 = auth, timeout, etc.)
          // → fall back to progressive download immediately. manifestLoadingMaxRetry: 0
          // ensures hls.js does not retry before marking fatal, so this fires in < 3 s.
          this._destroyHls();
          this.onFallback?.();
          settle(false);
          return;
        }

        // ── HMAC token expiry (KEY_LOAD_ERROR 401/403) ───────────────────────
        // Fired mid-stream when the HMAC-signed segment key URL returns 401/403
        // because the 8-hour session token expired. We save the playback position,
        // destroy the stale hls.js instance, and re-call loadTrack with the same
        // manifest URL — the next /api/library/hls request issues fresh tokens.
        // Bounded to 2 attempts: if renewal fails twice, escalate to onSegmentFatalError.
        if (
          settled &&
          this._renewalAttempts < 2 &&
          data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          data.details === Hls.ErrorDetails.KEY_LOAD_ERROR &&
          (data.response?.code === 403 || data.response?.code === 401)
        ) {
          this._renewalAttempts++;
          const currentTime    = this._audioEl?.currentTime ?? 0;
          const capturedVersion = this._manifestVersion;
          const capturedUrl    = this._manifestUrl;
          const capturedEl     = this._audioEl;
          logPlaybackResilience("hls-token-renewal", {
            source:  "HLSEngine",
            detail:  Hls.ErrorDetails.KEY_LOAD_ERROR,
            attempt: this._renewalAttempts,
            slug:    capturedUrl ? new URL(capturedUrl, "http://x").searchParams.get("slug") : null,
          });
          this._destroyHls();
          this.loadTrack(capturedUrl, capturedEl, { startPosition: currentTime, _version: capturedVersion })
            .then((ok) => {
              if (ok) this._renewalAttempts = 0;
              if (!ok) this.onSegmentFatalError?.();
            })
            .catch(() => { this.onSegmentFatalError?.(); });
          return;
        }

        // ── AES-128 decryption failure (FRAG_DECRYPT_ERROR) ──────────────────
        // Fired when HLS_MASTER_SECRET was rotated mid-session: the segment
        // was encrypted with a key the current token can no longer decrypt.
        // Same renewal flow as KEY_LOAD_ERROR — re-load the manifest to pick
        // up fresh key URLs signed with the new secret.
        if (
          settled &&
          this._renewalAttempts < 2 &&
          data.details === Hls.ErrorDetails.FRAG_DECRYPT_ERROR
        ) {
          this._renewalAttempts++;
          const currentTime     = this._audioEl?.currentTime ?? 0;
          const capturedVersion = this._manifestVersion;
          const capturedUrl     = this._manifestUrl;
          const capturedEl      = this._audioEl;
          logPlaybackResilience("hls-token-renewal", {
            source:  "HLSEngine",
            detail:  Hls.ErrorDetails.FRAG_DECRYPT_ERROR,
            attempt: this._renewalAttempts,
            slug:    capturedUrl ? new URL(capturedUrl, "http://x").searchParams.get("slug") : null,
          });
          this._destroyHls();
          this.loadTrack(capturedUrl, capturedEl, { startPosition: currentTime, _version: capturedVersion })
            .then((ok) => {
              if (ok) this._renewalAttempts = 0;
              if (!ok) this.onError?.(new Error("FRAG_DECRYPT_ERROR: unrecoverable after renewal"));
            })
            .catch(() => { this.onError?.(new Error("FRAG_DECRYPT_ERROR: renewal error")); });
          return;
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (!settled) {
            // Fatal segment/level error before manifest resolved — fall back.
            this._destroyHls();
            this.onFallback?.();
            settle(false);
          } else if (!networkRecoveryAttempted) {
            // Manifest loaded, first mid-stream segment failure — attempt one recovery.
            // This handles transient CDN hiccups without falling back unnecessarily.
            networkRecoveryAttempted = true;
            hls.startLoad();
          } else {
            // Second fatal segment failure after recovery — segments are not recoverable
            // (likely CORS, auth, or CDN failure on iOS). Notify for progressive fallback.
            this._destroyHls();
            this.onSegmentFatalError?.();
          }
          return;
        }

        // Fatal non-network error (MSE, decode, etc.) — report up and fall back
        const err = new Error(
          `hls.js fatal error: ${data.type} / ${data.details}`
        );
        this._destroyHls();
        this.onError?.(err);
        settle(false);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        if (!ownsLoad()) {
          settle(false);
          return;
        }
        const levels = data.levels || [];
        if (isPlaybackTraceEnabled()) {
          console.log("[PLAY-CHAIN] hls.js MANIFEST_PARSED", {
            levels: levels.map((l) => ({ bitrate: l.bitrate, audioCodec: l.audioCodec })),
            startPosition,
          });
        }
        if (levels.length > 0 && this._currentLevel >= 0) {
          // The master playlist does not guarantee a level ordering. Sort by
          // descending bitrate to produce a stable tier index regardless of how
          // the server emits the manifest. Tier 0 = highest bitrate, tier N-1 = lowest.
          const byBitrate = levels
            .map((lvl, i) => ({ bitrate: lvl.bitrate ?? 0, i }))
            .sort((a, b) => b.bitrate - a.bitrate);
          // Map the caller's quality tier index (0 = highest) to the manifest's
          // actual hls.js level index so quality always corresponds to bitrate,
          // not to manifest insertion order.
          if (this._currentLevel < byBitrate.length) {
            hls.currentLevel = byBitrate[this._currentLevel].i;
          }
          // If _currentLevel is out of range, leave ABR in control.
        }
        // _currentLevel < 0 means full auto — no override needed.
        settle(true);
      });

      // Production: observe ABR quality switches for observability. hls.js handles
      // the actual adaptation automatically (abrBandWidthFactor: 0.95); this listener
      // logs the event so bandwidth degradation is visible in production diagnostics.
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        if (!ownsLoad()) return;
        const levels = hls.levels || [];
        const level = levels[data.level];
        const bitrateKbps = level ? Math.round(level.bitrate / 1000) : null;
        if (bitrateKbps !== null && bitrateKbps < 192) {
          console.warn("[HLSEngine] ABR downgraded to low bitrate", {
            level: data.level,
            bitrateKbps,
            levels: levels.length,
          });
        } else if (isPlaybackTraceEnabled()) {
          console.log("[PLAY-CHAIN] hls.js LEVEL_SWITCHED", {
            level: data.level,
            bitrateKbps,
          });
        }
      });

      if (isPlaybackTraceEnabled()) {
        hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
          if (!ownsLoad()) return;
          console.log("[PLAY-CHAIN] hls.js FRAG_LOADED", {
            sn: data.frag?.sn,
            duration: data.frag?.duration,
            byteLength: data.networkDetails?.responseURL ? "ok" : "?",
            level: data.frag?.level,
          });
        });
        hls.on(Hls.Events.BUFFER_APPENDED, (_, data) => {
          if (!ownsLoad()) return;
          const buf = audioEl.buffered;
          const bufferedEnd = buf?.length ? buf.end(buf.length - 1).toFixed(2) : "0";
          console.log("[PLAY-CHAIN] hls.js BUFFER_APPENDED", {
            type: data.type,
            readyState: audioEl.readyState,
            bufferedEnd,
          });
        });
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          if (!ownsLoad()) return;
          console.log("[PLAY-CHAIN] hls.js MEDIA_ATTACHED", {
            readyState: audioEl.readyState,
            src: audioEl.src ? audioEl.src.slice(0, 60) : null,
          });
        });
      }

      this._hls         = hls;
      this._audioEl     = audioEl;
      this._manifestUrl = manifestUrl;

      hls.loadSource(manifestUrl);
      hls.attachMedia(audioEl);
    });
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
    this._manifestUrl      = null;
    this._audioEl          = null;
    this._renewalAttempts  = 0;
    this._manifestVersion++;  // invalidates any in-flight renewal for the previous track
  }

  _destroyHls() {
    // Invalidate ownership before destroying the media attachment. Any queued
    // timeout/event from the old instance then becomes observational only.
    this._invalidateLoadAttempt();
    if (this._hls) {
      try { this._hls.detachMedia(); } catch {}
      try { this._hls.destroy();     } catch {}
      this._hls = null;
    }
  }

  destroy() {
    this._destroyed          = true;
    this._destroyHls();
    this._audioEl            = null;
    this._manifestUrl        = null;
    this._renewalAttempts    = 0;
    this._manifestVersion    = 0;
    this._pendingLoadCancel  = null;
    this.onFallback          = null;
    this.onError             = null;
    this.onSegmentFatalError = null;
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

/**
 * Update the module singleton after a representation deck swap.
 * RepresentationSwitcher calls this after completeCrossfade() so getHLSEngine()
 * always returns the engine bound to the current active audio element.
 * @param {HLSEngine} engine
 */
export function setActiveHLSEngine(engine) {
  _activeEngine = engine;
}

/**
 * Returns true when hls.js is the active decoder for this browser session.
 *
 * Safari uses native HLS (AVPlayer via src= assignment) even when MSE is
 * present. On Safari, hls.js is never constructed and the in-memory segment
 * cache / fLoader pipeline is never consulted — calling prefetchHlsSegments
 * on Safari wastes one authenticated API call, two playlist fetches, and
 * ~500 KB of CDN bandwidth per queued track with zero latency benefit.
 *
 * Returns false until importHls() has resolved (safe to call before prewarm).
 * Returns false on Safari (Hls.isSupported() = false due to native HLS).
 */
export function isHlsJsActive() {
  return Boolean(_Hls && _Hls.isSupported());
}

/**
 * Fire-and-forget: import hls.js before the user taps play so there is no
 * main-thread parse/compile freeze on the first HLS track.
 * Safe to call many times — importHls() caches the module after first load.
 */
export function prewarmHLS() {
  importHls().catch(() => {});
}
