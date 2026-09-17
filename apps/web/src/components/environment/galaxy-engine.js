// Small framework-independent math helpers for the galaxy environment.
// No React, no DOM assumptions — pure functions only.
//
// The canvas-drawn star field that used to live in this file (createStarField
// / resizeStarField / stepStarField / drawStarField) is retired: stars are
// now real video footage (.galaxy-environment__star-background in
// GalaxyEnvironment.js), not individually-simulated points.

export function lerp(current, target, factor) {
  return current + (target - current) * factor;
}
