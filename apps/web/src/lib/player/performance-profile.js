/**
 * Performance Profile Resolver — per-track Screw profile authority.
 *
 * Resolution order:
 *   1. Track-specific authored profile (registered via registerAuthoredProfile)
 *   2. 2MRRW House Screw Profile (HOUSE_SCREW_RATE = 0.75×)
 *
 * Authored profiles are keyed by track slug. They are populated externally
 * (e.g. from catalog API, Yesterday analysis, or manual editorial overrides).
 * Future: Yesterday/analysis system will call registerAuthoredProfile() per track
 * when performance intelligence data is available.
 *
 * Rate ↔ ScrewEngine intensity mapping:
 *   intensityToRate(i) = 0.85 − 0.20 × i   (from ScrewEngine.js)
 *   → intensity = (0.85 − rate) / 0.20
 *   Valid rate range: [0.65, 0.85]  (ScrewEngine RATE_MIN / RATE_MAX)
 */

export const HOUSE_SCREW_RATE      = 0.75;
export const HOUSE_SCREW_INTENSITY = 0.50; // intensityToRate(0.50) = 0.75× ✓

const RATE_MIN = 0.65;
const RATE_MAX = 0.85;

/**
 * @typedef {{ screwRate: number, engageMs?: number, releaseMs?: number }} PerformanceProfile
 */

/** @type {Map<string, PerformanceProfile>} */
const _authoredProfiles = new Map();

/**
 * Register an authored Performance Profile for a track.
 * Called by catalog ingestion / Yesterday analysis when data is available.
 *
 * @param {string} slug — track slug
 * @param {PerformanceProfile} profile
 */
export function registerAuthoredProfile(slug, profile) {
  if (!slug || !profile || typeof profile !== "object") return;
  _authoredProfiles.set(slug, profile);
}

/**
 * Resolve Performance Profile for a track slug.
 * Returns the authored profile if present and valid, otherwise house defaults.
 *
 * @param {string|null|undefined} trackSlug
 * @returns {{ rate: number, intensity: number, engageMs: number, releaseMs: number, source: "authored"|"house" }}
 */
export function resolveTrackPerformanceProfile(trackSlug) {
  const authored = trackSlug ? _authoredProfiles.get(trackSlug) : null;

  if (authored && Number.isFinite(authored.screwRate)) {
    const rate      = Math.max(RATE_MIN, Math.min(RATE_MAX, authored.screwRate));
    const intensity = (RATE_MAX - rate) / 0.20;
    return {
      rate,
      intensity,
      engageMs:   Number.isFinite(authored.engageMs)   ? authored.engageMs   : 300,
      releaseMs:  Number.isFinite(authored.releaseMs)  ? authored.releaseMs  : 200,
      source: "authored",
    };
  }

  return {
    rate:      HOUSE_SCREW_RATE,
    intensity: HOUSE_SCREW_INTENSITY,
    engageMs:  300,
    releaseMs: 200,
    source: "house",
  };
}
