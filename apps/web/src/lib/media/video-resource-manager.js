/**
 * VideoResourceManager — centralized decoder budget for all non-carousel animated artwork.
 *
 * Priority tiers (lower number = higher priority):
 *   PRIORITY_SYSTEM  1  Ambient background, GlobalAudioPlayerBar
 *   PRIORITY_HERO    2  HeroSection, immersive player full-screen
 *   PRIORITY_VISIBLE 3  CoverArt in viewport
 *   PRIORITY_NEAR    4  CoverArt within 150px rootMargin (preloading)
 *
 * Carousel videos (data-single-carousel) are EXCLUDED — they are managed by
 * storefront-persistent-media.js and must never be touched here.
 *
 * Budget is derived from navigator.deviceMemory / hardwareConcurrency on first call.
 * Tests can override with setBudgetForTesting().
 *
 * iOS gets its own fixed, conservative budget instead of falling through
 * this detection (see _isLikelyIOS below): Safari doesn't implement
 * navigator.deviceMemory at all, and hardwareConcurrency reflects CPU core
 * count, not concurrent hardware video decoder capacity -- those are
 * unrelated on iOS, where the real decoder ceiling is much lower and
 * roughly fixed regardless of core count. Without this check, every
 * iPhone (commonly hardwareConcurrency=6, matching neither the <=2 nor
 * <=4 branch below) fell through to the same budget=8 a powerful desktop
 * gets -- effectively no cap at all on the platform that needs one most.
 */

export const PRIORITY_SYSTEM = 1;
export const PRIORITY_HERO = 2;
export const PRIORITY_VISIBLE = 3;
export const PRIORITY_NEAR = 4;

// Map<HTMLVideoElement, { priority, wantsPlay, isGranted, onGranted, onRevoked }>
const _registry = new Map();
let _budget = 6;
let _budgetDetected = false;
let _rebalanceId = null;

// Local, minimal duplicate of lib/audio/audio-element-utils.js's
// isLikelyIOS() -- kept inline here (rather than importing an audio-domain
// util from a video-domain module) until platform detection gets a
// canonical shared home. Keep this logic in sync with that copy.
function _isLikelyIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  const hasTouchDocument = typeof document !== "undefined" && "ontouchend" in document;
  return /iP(hone|ad|od)/i.test(ua) || (/Macintosh/i.test(ua) && hasTouchDocument);
}

function _detectBudget() {
  if (_budgetDetected) return;
  _budgetDetected = true;
  try {
    if (_isLikelyIOS()) {
      _budget = 3;
      return;
    }
    const mem = typeof navigator !== "undefined" ? navigator.deviceMemory : undefined;
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined;
    if (mem !== undefined) {
      if (mem <= 2) { _budget = 3; return; }
      if (mem <= 4) { _budget = 5; return; }
      _budget = 8;
      return;
    }
    if (cores !== undefined) {
      if (cores <= 2) { _budget = 3; return; }
      if (cores <= 4) { _budget = 5; return; }
    }
    _budget = 8;
  } catch {
    _budget = 6;
  }
}

function _scheduleRebalance() {
  if (_rebalanceId) return;
  _rebalanceId = setTimeout(_rebalance, 0);
}

function _rebalance() {
  _rebalanceId = null;
  _detectBudget();

  const wantsPlay = Array.from(_registry.entries())
    .filter(([, e]) => e.wantsPlay)
    .sort(([, a], [, b]) => a.priority - b.priority);

  const granted = new Set();
  for (let i = 0; i < Math.min(wantsPlay.length, _budget); i++) {
    granted.add(wantsPlay[i][0]);
  }

  for (const [el, entry] of _registry.entries()) {
    if (!entry.wantsPlay) continue;
    if (granted.has(el)) {
      if (!entry.isGranted) {
        entry.isGranted = true;
        try { entry.onGranted?.(); } catch { /* never throw from budget callback */ }
      }
    } else {
      if (entry.isGranted) {
        entry.isGranted = false;
        try { entry.onRevoked?.(); } catch { /* never throw from budget callback */ }
      }
    }
  }
}

export const VRM = {
  PRIORITY_SYSTEM,
  PRIORITY_HERO,
  PRIORITY_VISIBLE,
  PRIORITY_NEAR,

  register(el, priority = PRIORITY_VISIBLE) {
    _registry.set(el, {
      priority,
      wantsPlay: false,
      isGranted: false,
      onGranted: null,
      onRevoked: null,
    });
  },

  unregister(el) {
    const entry = _registry.get(el);
    _registry.delete(el);
    if (entry?.isGranted || entry?.wantsPlay) _scheduleRebalance();
  },

  /**
   * Signal that this element wants to play.
   * onGranted fires when budget allows; onRevoked fires if evicted.
   */
  requestPlay(el, onGranted, onRevoked) {
    const entry = _registry.get(el);
    if (!entry) {
      // Not registered — grant unconditionally (safety for non-budget elements)
      try { onGranted?.(); } catch { /* */ }
      return;
    }
    entry.wantsPlay = true;
    entry.onGranted = onGranted;
    entry.onRevoked = onRevoked;
    _scheduleRebalance();
  },

  /** Signal that this element is done playing (scrolled away, src removed, etc.). */
  requestPause(el) {
    const entry = _registry.get(el);
    if (!entry) return;
    const wasGranted = entry.isGranted;
    entry.wantsPlay = false;
    entry.isGranted = false;
    entry.onGranted = null;
    entry.onRevoked = null;
    if (wasGranted) _scheduleRebalance();
  },

  /** Update priority and rebalance immediately. */
  setPriority(el, priority) {
    const entry = _registry.get(el);
    if (!entry || entry.priority === priority) return;
    entry.priority = priority;
    if (entry.wantsPlay) _scheduleRebalance();
  },

  getBudget() {
    _detectBudget();
    return _budget;
  },

  getActiveCount() {
    let n = 0;
    for (const [, e] of _registry.entries()) if (e.isGranted) n++;
    return n;
  },

  getRegisteredCount() {
    return _registry.size;
  },

  /** Test-only: override budget without device detection. */
  setBudgetForTesting(n) {
    _budget = n;
    _budgetDetected = true;
    _scheduleRebalance();
  },

  /** Test-only: reset all state. */
  _resetForTesting() {
    _registry.clear();
    _budget = 6;
    _budgetDetected = false;
    if (_rebalanceId) { clearTimeout(_rebalanceId); _rebalanceId = null; }
  },
};
