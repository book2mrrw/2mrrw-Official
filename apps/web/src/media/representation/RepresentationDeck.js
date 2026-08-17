/**
 * RepresentationDeck — the standby half of the two-deck DJ model.
 *
 * A deck owns one <audio> element + one HLSEngine instance and is wired into
 * the WebAudioEngine standby signal path (standbyGain → userGain).  The gain
 * starts at 0 and is only raised by RepresentationSwitcher's crossfade ramp.
 *
 * Lifecycle:
 *   new RepresentationDeck()  → shell, nothing allocated
 *   loadAndPosition()         → allocates element + HLS, starts buffering at targetSec
 *   waitForReadiness()        → resolves when canplay + buffered gate passes
 *   [crossfade via switcher]
 *   transferOwnership()       → caller takes element + HLS engine (becomes the new active)
 *   dispose()                 → clean release of element + HLS
 */

import { HLSEngine } from "@/lib/audio/HLSEngine";
import { getWebAudioEngine } from "@/lib/audio/WebAudioEngine";

// Overridable via env var for test environments (e.g. MRRW_READINESS_TIMEOUT_MS=200).
const READINESS_TIMEOUT_MS  = Number(typeof process !== "undefined" && process.env.MRRW_READINESS_TIMEOUT_MS) || 5000;
const READINESS_BUFFER_LEAD = 0.1;  // seconds buffered past targetSec required

export class RepresentationDeck {
  constructor() {
    /** @type {HTMLAudioElement|null} */
    this.audioEl = null;
    /** @type {HLSEngine|null} */
    this.hlsEngine = null;
    /** @type {number} Monotonic counter — stale async callbacks abort on mismatch. */
    this._loadSeq = 0;
  }

  _ensureAudioElement() {
    if (this.audioEl) return;
    if (typeof document === "undefined") return;

    const engine = getWebAudioEngine();

    // After the first deck swap, the former active element lives as engine._standbyElement
    // (already wired to standbyGain → userGain).  Reuse it rather than creating a new
    // element each time — prevents unbounded DOM accumulation across repeated swaps.
    const reuse = engine.getStandbyElement();
    if (reuse) {
      // Reset src so HLS loads fresh content; the WebAudio binding is already live.
      try { reuse.src = ""; reuse.load(); } catch {}
      this.audioEl = reuse;
      this.hlsEngine = new HLSEngine();
      return;
    }

    // First allocation or post-context-reset — create and bind a fresh element.
    const el = document.createElement("audio");
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    el.setAttribute("x-webkit-airplay", "allow");
    el.style.display = "none";
    document.body.appendChild(el);
    this.audioEl = el;

    // Wire into Web Audio standby path — gain starts at 0 (silent).
    engine.bindStandbyElement(el);

    this.hlsEngine = new HLSEngine();
  }

  /**
   * Load a manifest URL and position the deck at targetSec.
   * hls.js buffers from targetSec immediately — no play() call needed.
   *
   * @param {string} manifestUrl
   * @param {number} targetSec      Musical position to buffer from (pre-aligned by caller)
   * @param {{ playbackRate?: number }} [opts]
   * @returns {Promise<boolean>}  true if loaded and still current (not superseded)
   */
  async loadAndPosition(manifestUrl, targetSec, opts = {}) {
    this._ensureAudioElement();
    if (!this.audioEl || !this.hlsEngine) return false;

    const seq = ++this._loadSeq;

    // startPosition tells hls.js to buffer from this offset immediately.
    const ok = await this.hlsEngine.loadTrack(manifestUrl, this.audioEl, {
      startPosition: targetSec,
    });

    if (!ok || this._loadSeq !== seq) return false;

    // Sync element playhead to the HLS buffer position.
    if (targetSec > 0) {
      this.audioEl.currentTime = targetSec;
    }

    if (opts.playbackRate != null) {
      this.audioEl.playbackRate = opts.playbackRate;
    }

    return true;
  }

  /**
   * Wait until the deck has buffered enough data around targetSec to play without stutter.
   * Resolves true when ready, false on timeout (crossfade proceeds on best-effort basis).
   *
   * @param {number} targetSec
   * @returns {Promise<boolean>}
   */
  waitForReadiness(targetSec) {
    const el = this.audioEl;
    if (!el) return Promise.resolve(false);

    const isReady = () => {
      if (el.readyState < 2) return false;
      try {
        const buf = el.buffered;
        for (let i = 0; i < buf.length; i++) {
          if (buf.start(i) <= targetSec + 0.01 &&
              buf.end(i)   >= targetSec + READINESS_BUFFER_LEAD) {
            return true;
          }
        }
      } catch {}
      return false;
    };

    if (isReady()) return Promise.resolve(true);

    return new Promise((resolve) => {
      let tid = null;

      const check = () => { if (isReady()) { clear(); resolve(true); } };

      const clear = () => {
        el.removeEventListener("canplay",  check);
        el.removeEventListener("seeked",   check);
        el.removeEventListener("progress", check);
        if (tid !== null) { clearTimeout(tid); tid = null; }
      };

      el.addEventListener("canplay",  check);
      el.addEventListener("seeked",   check);
      el.addEventListener("progress", check);

      tid = setTimeout(() => {
        clear();
        // A timeout is NOT evidence of readiness.  If standby cannot prove it
        // can produce audio before this deadline, the active deck keeps playing.
        resolve(false);
      }, READINESS_TIMEOUT_MS);
    });
  }

  /**
   * Detach HLS without destroying the audio element or the WebAudio binding.
   * Called before disposing or recycling the deck as the new standby placeholder.
   */
  detachHls() {
    if (this.hlsEngine) {
      this.hlsEngine.detach();
      this.hlsEngine = null;
    }
  }

  /**
   * Transfer ownership of the audio element and HLS engine to the caller.
   * After this call the deck is empty — re-use via loadAndPosition() on the recycled element.
   *
   * @returns {{ audioEl: HTMLAudioElement, hlsEngine: HLSEngine }}
   */
  transferOwnership() {
    const audioEl   = this.audioEl;
    const hlsEngine = this.hlsEngine;
    this.audioEl    = null;
    this.hlsEngine  = null;
    return { audioEl, hlsEngine };
  }

  /**
   * Fully release resources — call when the deck will never be used again.
   */
  dispose() {
    this.detachHls();
    getWebAudioEngine().bindStandbyElement(null); // release standby WebAudio binding
    if (this.audioEl) {
      try { this.audioEl.src = ""; this.audioEl.load(); } catch {}
      try { this.audioEl.parentNode?.removeChild(this.audioEl); } catch {}
      this.audioEl = null;
    }
  }
}
