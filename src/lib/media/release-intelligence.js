/**
 * Release Intelligence Engine.
 *
 * Each release carries artistic metadata beyond what the catalog needs for
 * commerce or playback URL resolution: track sequencing intent, gapless policy,
 * transition data, credits, format versions, and collector content flags.
 *
 * This data feeds:
 *  - Queue Engine: album play → continuous artist experience
 *  - Crossfade Engine: when gaplessEnabled, crossfade window is 0 (immediate cut or
 *    pre-scheduled bridging from the release's transitionMs value)
 *  - Artist Intent Preservation: never break sequencing declared here
 *  - AI Recommendations: credits + versions feed the feature store
 *
 * Add new releases here alongside adding them to canonical-catalog.js.
 */

/**
 * @typedef {object} ReleaseIntelligence
 * @property {boolean} gaplessEnabled        True when tracks play without silence gap (album flow).
 * @property {number}  transitionMs          Milliseconds of crossfade between tracks (0 = instant cut).
 * @property {"album"|"custom"} trackOrder   Canonical track ordering intent.
 * @property {object}  credits               Artist and production credits.
 * @property {string}  credits.artist        Primary artist name.
 * @property {string[]} credits.producers    Producer names.
 * @property {string[]} credits.features     Featured artist names.
 * @property {string[]} versions             Available format versions for this release.
 * @property {boolean} collectorContent      True if release includes exclusive collector bonus content.
 * @property {string}  [artworkNote]         Art direction note — not displayed to users.
 */

/** @type {Record<string, ReleaseIntelligence>} */
const RELEASE_INTELLIGENCE_MAP = {
  // ── Singles ─────────────────────────────────────────────────────────────────
  "hour-glass": {
    gaplessEnabled: false,
    transitionMs: 0,
    trackOrder: "album",
    credits: { artist: "2MRRW", producers: [], features: [] },
    versions: ["standard"],
    collectorContent: false,
  },
  "turnt-me-2-dis": {
    gaplessEnabled: false,
    transitionMs: 0,
    trackOrder: "album",
    credits: { artist: "2MRRW", producers: [], features: [] },
    versions: ["standard"],
    collectorContent: false,
  },
  "w2d": {
    gaplessEnabled: false,
    transitionMs: 0,
    trackOrder: "album",
    credits: { artist: "2MRRW", producers: [], features: [] },
    versions: ["standard"],
    collectorContent: false,
  },
  "artificial": {
    gaplessEnabled: false,
    transitionMs: 0,
    trackOrder: "album",
    credits: { artist: "2MRRW", producers: [], features: [] },
    versions: ["standard"],
    collectorContent: false,
  },

  // ── Features ─────────────────────────────────────────────────────────────────
  "i-dont-believe-you": {
    gaplessEnabled: false,
    transitionMs: 0,
    trackOrder: "album",
    credits: { artist: "2MRRW", producers: [], features: [] },
    versions: ["standard"],
    collectorContent: false,
  },
  "2-heavy": {
    gaplessEnabled: false,
    transitionMs: 0,
    trackOrder: "album",
    credits: { artist: "2MRRW", producers: [], features: [] },
    versions: ["standard"],
    collectorContent: false,
  },

  // ── EP: Love Hz Vol. 1 ───────────────────────────────────────────────────────
  "love-hz-vol-1": {
    gaplessEnabled: true,
    transitionMs: 2000,
    trackOrder: "album",
    credits: {
      artist: "2MRRW",
      producers: [],
      features: [],
    },
    versions: ["standard"],
    collectorContent: false,
    artworkNote: "EP with continuous sonic flow — gapless play preserves artistic intent",
  },

  // ── Mixtape: (A.D) ──────────────────────────────────────────────────────────
  "ad": {
    gaplessEnabled: true,
    transitionMs: 1500,
    trackOrder: "album",
    credits: {
      artist: "2MRRW",
      producers: [],
      features: ["Gwendolyn"],
    },
    versions: ["standard"],
    collectorContent: false,
  },

  // ── Mixtape: T.B.H ──────────────────────────────────────────────────────────
  "tbh": {
    gaplessEnabled: true,
    transitionMs: 1500,
    trackOrder: "album",
    credits: {
      artist: "2MRRW",
      producers: [],
      features: [],
    },
    versions: ["standard"],
    collectorContent: false,
  },
};

/** Default intelligence for unknown / unconfigured releases. */
const DEFAULT_INTELLIGENCE = {
  gaplessEnabled: false,
  transitionMs: 0,
  trackOrder: "album",
  credits: { artist: "2MRRW", producers: [], features: [] },
  versions: ["standard"],
  collectorContent: false,
};

/**
 * Resolve the release intelligence object for a slug.
 * Always returns a valid object — falls back to sensible defaults.
 *
 * @param {string} slug  Canonical release slug (e.g. "love-hz-vol-1", "w2d").
 * @returns {ReleaseIntelligence}
 */
export function resolveReleaseIntelligence(slug) {
  if (!slug) return { ...DEFAULT_INTELLIGENCE };
  return RELEASE_INTELLIGENCE_MAP[slug] ?? { ...DEFAULT_INTELLIGENCE };
}

/**
 * True when the release is configured for gapless playback.
 * The Queue Engine uses this to schedule zero-gap track transitions.
 *
 * @param {string} slug
 * @returns {boolean}
 */
export function isGaplessRelease(slug) {
  return resolveReleaseIntelligence(slug).gaplessEnabled;
}

/**
 * Returns the crossfade transition window for a release in milliseconds.
 * 0 means an instant cut (or system-default crossfade).
 * Values > 0 mean the release has an intentional audible transition.
 *
 * @param {string} slug
 * @returns {number}
 */
export function releaseTransitionMs(slug) {
  return resolveReleaseIntelligence(slug).transitionMs;
}

/**
 * Returns all feature artists credited on a release.
 * Used by artist intent preservation to prevent incorrect attribution.
 *
 * @param {string} slug
 * @returns {string[]}
 */
export function releaseFeatureArtists(slug) {
  return resolveReleaseIntelligence(slug).credits.features;
}

/** All entries — for admin dashboards and catalog completeness checks. */
export function getAllReleaseIntelligence() {
  return { ...RELEASE_INTELLIGENCE_MAP };
}
