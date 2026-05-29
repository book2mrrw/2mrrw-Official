/** Canonical R2 folder segments for release categories — no imports (layer 1). */

export const RELEASE_TYPES = ["singles", "features", "albums", "mixtapes-and-eps"];

export const RELEASE_TYPE_ALIASES = {
  single: "singles",
  singles: "singles",
  feature: "features",
  features: "features",
  album: "albums",
  albums: "albums",
  ep: "mixtapes-and-eps",
  mixtape: "mixtapes-and-eps",
  mixtapes: "mixtapes-and-eps",
  "mixtapes-and-eps": "mixtapes-and-eps",
};

/** @deprecated Prefer normalizeReleaseType — kept for callers that still read alias keys. */
export const RELEASE_FOLDER = {
  single: "singles",
  singles: "singles",
  feature: "features",
  features: "features",
  ep: "mixtapes-and-eps",
  mixtape: "mixtapes-and-eps",
  "mixtapes-and-eps": "mixtapes-and-eps",
  album: "albums",
  albums: "albums",
};
