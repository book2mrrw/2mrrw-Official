// Conservative performance-tier decision for the galaxy environment. Only
// ever turns visuals DOWN when uncertain — never competes with playback or
// interaction responsiveness.

const IMMERSIVE_MIN_WIDTH = 600;
const IMMERSIVE_MIN_HEIGHT = 600;

// Mirrors the dual-threshold already established in this codebase for "is
// this a big/unfolded screen" (globals.css .immersive-preview-sheet's
// @media (min-width: 600px) and (min-height: 600px) rule).
export function isImmersiveViewport(width, height) {
  return width >= IMMERSIVE_MIN_WIDTH && height >= IMMERSIVE_MIN_HEIGHT;
}

export function getPerformanceTier({ reducedMotion, pointerFine, width, height }) {
  if (reducedMotion) return "low";
  if (pointerFine || isImmersiveViewport(width, height)) return "high";
  return "medium";
}

export const TIER_PARAMS = {
  high: { starCount: 220, pointerParallax: true, scrollParallax: true, animate: true },
  medium: { starCount: 90, pointerParallax: false, scrollParallax: true, animate: true },
  low: { starCount: 30, pointerParallax: false, scrollParallax: false, animate: false },
};
