/**
 * HLSVideoEngine — hls.js wrapper for vault long-form video.
 *
 * Designed to attach to a dedicated <video> element owned by VaultVideoPlayer.
 * NOT a singleton — each VaultVideoPlayer instance owns its own engine and calls
 * new HLSVideoEngine(). Mirrors the architecture of HLSEngine (audio) but is
 * independent: no Web Audio graph, no shared element, no prefetch loader.
 *
 * Error model (mirrors HLSEngine):
 *   MANIFEST_LOAD_ERROR (any) → onFallback()  (player uses content_url directly)
 *   KEY_LOAD_ERROR 401/403    → automatic HMAC token renewal (max 2 attempts)
 *   FRAG_DECRYPT_ERROR        → same renewal flow
 *   First NETWORK_ERROR post-settle → hls.startLoad() recovery attempt
 *   Second NETWORK_ERROR      → onSegmentFatalError()
 *   Fatal non-network         → onError(err)
 *
 * VRM: the caller (VaultVideoPlayer) registers the <video> element with VRM
 * at PRIORITY_SYSTEM before calling loadContent. The engine does not touch VRM.
 */

let _Hls = null;

async function importHls() {
  if (typeof window === "undefined") return null;
  if (_Hls) return _Hls;
  try {
    const mod = await import("hls.js");
    _Hls = mod.default ?? mod;
    return _Hls;
  } catch (err) {
    console.error("[HLSVideoEngine] hls.js import failed", err);
    return null;
  }
}

export class HLSVideoEngine {
  constructor() {
    /** @type {import("hls.js").default|null} */
    this._hls = null;
    /** @type {HTMLVideoElement|null} */
    this._videoEl = null;
    /** @type {string|null} */
    this._manifestUrl = null;
    /** @type {boolean} */
    this._destroyed = false;
    /** @type {number} Monotonic version — incremented on detach() to abort stale renewals */
    this._manifestVersion = 0;
    /** @type {number} */
    this._renewalAttempts = 0;

    // ── Callbacks ─────────────────────────────────────────────────────────────
    /** Fires on manifest 404 / load error → player should use content_url directly */
    this.onFallback = null;
    /** Fires on fatal non-network hls.js error */
    this.onError = null;
    /** Fires on unrecoverable mid-stream error (post-manifest-settled) */
    this.onSegmentFatalError = null;
    /** Fires when manifest is parsed and duration is known: (durationSeconds: number) => void */
    this.onDurationKnown = null;
  }

  get isLoaded() {
    return Boolean(this._hls && this._manifestUrl);
  }

  /**
   * Attach hls.js to the video element and begin loading the manifest.
   *
   * @param {string}           manifestUrl  /api/vault/video/manifest?slug=...
   * @param {HTMLVideoElement} videoEl      Dedicated vault video element
   * @param {{ startPosition?: number, _version?: number }} opts
   * @returns {Promise<boolean>} true = HLS attached, false = fall back to direct URL
   */
  async loadContent(manifestUrl, videoEl, { startPosition = 0, _version = -1 } = {}) {
    if (this._destroyed) return false;
    if (_version >= 0 && this._manifestVersion !== _version) return false;

    const Hls = await importHls();

    // Safari: native HLS via src= assignment
    if (!Hls || !Hls.isSupported()) {
      videoEl.src = manifestUrl;
      this._videoEl    = videoEl;
      this._manifestUrl = manifestUrl;
      return true;
    }

    if (_version >= 0 && this._manifestVersion !== _version) return false;

    this._destroyHls();

    const hls = new Hls({
      enableWorker:            true,
      lowLatencyMode:          false,

      // Buffer — video segments are larger than audio; 30 s forward is ample
      maxBufferLength:         30,
      maxMaxBufferLength:      90,
      maxBufferSize:           50 * 1000 * 1000, // 50 MB
      backBufferLength:        10,

      // ABR — same conservative 500 Kbps cold-start as audio engine
      startLevel:              -1,
      abrEwmaDefaultEstimate:  500_000,
      abrBandWidthFactor:      0.95,
      abrBandWidthUpFactor:    0.7,

      // Manifest: fail fast on any error → onFallback → direct content_url
      manifestLoadingMaxRetry: 0,
      manifestLoadingTimeOut:  3000,
      levelLoadingMaxRetry:    3,
      fragLoadingMaxRetry:     3,
      levelLoadingRetryDelay:  1000,
      fragLoadingRetryDelay:   1000,

      startPosition,

      debug: process.env.NODE_ENV === "development",
    });

    return new Promise((resolve) => {
      let settled = false;
      let safetyTimerId = null;
      let networkRecoveryAttempted = false;

      const settle = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimerId);
        resolve(value);
      };

      // 5 s safety cap — belt-and-suspenders against backgrounded-tab stalls
      safetyTimerId = setTimeout(() => {
        if (settled) return;
        this._destroyHls();
        this.onFallback?.();
        settle(false);
      }, 5000);

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;

        // ── Manifest 404 / load error → direct fallback ───────────────────────
        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR
        ) {
          this._destroyHls();
          this.onFallback?.();
          settle(false);
          return;
        }

        // ── HMAC token expiry (KEY_LOAD_ERROR 401/403) ────────────────────────
        if (
          settled &&
          this._renewalAttempts < 2 &&
          data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          data.details === Hls.ErrorDetails.KEY_LOAD_ERROR &&
          (data.response?.code === 403 || data.response?.code === 401)
        ) {
          this._renewalAttempts++;
          const pos             = this._videoEl?.currentTime ?? 0;
          const capturedVersion = this._manifestVersion;
          const capturedUrl     = this._manifestUrl;
          const capturedEl      = this._videoEl;
          console.warn("[HLSVideoEngine] HMAC renewal attempt", { attempt: this._renewalAttempts });
          this._destroyHls();
          this.loadContent(capturedUrl, capturedEl, { startPosition: pos, _version: capturedVersion })
            .then((ok) => {
              if (ok) this._renewalAttempts = 0;
              else this.onSegmentFatalError?.();
            })
            .catch(() => { this.onSegmentFatalError?.(); });
          return;
        }

        // ── AES-128 key rotation (FRAG_DECRYPT_ERROR) ─────────────────────────
        if (
          settled &&
          this._renewalAttempts < 2 &&
          data.details === Hls.ErrorDetails.FRAG_DECRYPT_ERROR
        ) {
          this._renewalAttempts++;
          const pos             = this._videoEl?.currentTime ?? 0;
          const capturedVersion = this._manifestVersion;
          const capturedUrl     = this._manifestUrl;
          const capturedEl      = this._videoEl;
          this._destroyHls();
          this.loadContent(capturedUrl, capturedEl, { startPosition: pos, _version: capturedVersion })
            .then((ok) => {
              if (ok) this._renewalAttempts = 0;
              else this.onError?.(new Error("FRAG_DECRYPT_ERROR: unrecoverable after renewal"));
            })
            .catch(() => { this.onError?.(new Error("FRAG_DECRYPT_ERROR: renewal error")); });
          return;
        }

        // ── Mid-stream network errors ──────────────────────────────────────────
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (!settled) {
            this._destroyHls();
            this.onFallback?.();
            settle(false);
          } else if (!networkRecoveryAttempted) {
            networkRecoveryAttempted = true;
            hls.startLoad();
          } else {
            this._destroyHls();
            this.onSegmentFatalError?.();
          }
          return;
        }

        // Fatal non-network (MSE, decode, etc.)
        const err = new Error(`hls.js fatal: ${data.type} / ${data.details}`);
        this._destroyHls();
        this.onError?.(err);
        settle(false);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const levels = data.levels || [];
        // Notify caller of the stream duration so the player can show a progress bar
        // immediately, without waiting for the video element's durationchange event
        // (which fires later, after the first segment is demuxed).
        if (levels[0]?.details?.totalduration) {
          this.onDurationKnown?.(levels[0].details.totalduration);
        }
        settle(true);
      });

      hls.loadSource(manifestUrl);
      hls.attachMedia(videoEl);

      this._hls         = hls;
      this._videoEl     = videoEl;
      this._manifestUrl = manifestUrl;
    });
  }

  /**
   * Seek within the current content (supplements videoEl.currentTime).
   */
  seekTo(seconds) {
    if (!this._videoEl) return;
    this._videoEl.currentTime = seconds;
    if (this._hls) this._hls.startLoad(seconds);
  }

  /**
   * Detach from the video element — must be called before loading a new slug.
   */
  detach() {
    this._destroyHls();
    this._manifestUrl     = null;
    this._videoEl         = null;
    this._renewalAttempts = 0;
    this._manifestVersion++;
  }

  _destroyHls() {
    if (this._hls) {
      try { this._hls.detachMedia(); } catch {}
      try { this._hls.destroy();    } catch {}
      this._hls = null;
    }
  }

  destroy() {
    this._destroyed          = true;
    this._destroyHls();
    this._videoEl            = null;
    this._manifestUrl        = null;
    this._renewalAttempts    = 0;
    this._manifestVersion    = 0;
    this.onFallback          = null;
    this.onError             = null;
    this.onSegmentFatalError = null;
    this.onDurationKnown     = null;
  }
}
