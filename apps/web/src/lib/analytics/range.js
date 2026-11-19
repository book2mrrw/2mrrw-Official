/**
 * Date range for every analytics route. Lifetime is the default: analytics
 * are the artist's permanent career record.
 *
 *   ?range=7d | 30d | 90d | 365d | all     preset (default all)
 *   ?since=ISO&until=ISO                    custom window; either side optional
 *
 * Returns ISO strings (or null for an open side) ready for the SQL functions'
 * p_from / p_to parameters, which treat null as "no bound".
 */
export const RANGE_PRESETS = Object.freeze({ "7d": 7, "30d": 30, "90d": 90, "365d": 365, all: null });
export const DEFAULT_RANGE = "all";
export const ARTIST_TIME_ZONE = "America/Chicago";
const DAY_MS = 24 * 60 * 60 * 1000;

function iso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function analyticsRange(searchParams, now = Date.now()) {
  const since = iso(searchParams?.get?.("since"));
  const until = iso(searchParams?.get?.("until"));
  if (since || until) return { key: "custom", from: since, to: until };
  const requested = searchParams?.get?.("range");
  const key = Object.prototype.hasOwnProperty.call(RANGE_PRESETS, requested) ? requested : DEFAULT_RANGE;
  const days = RANGE_PRESETS[key];
  return { key, from: days ? new Date(now - days * DAY_MS).toISOString() : null, to: null };
}

/** For older SQL functions whose `since` cannot be null: lifetime = the epoch. */
export function sinceOrEpoch(range) {
  return range.from || "1970-01-01T00:00:00.000Z";
}
