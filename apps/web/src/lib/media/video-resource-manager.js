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

function _detectBudget() {
  if (_budgetDetected) return;
  _budgetDetected = true;
  try {
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
