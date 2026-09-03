import { CITY_COORDS } from "@/lib/geo/city-coords";

const MAPBOX_GEOCODING_TOKEN = process.env.MAPBOX_GEOCODING_TOKEN || null;
const MAPBOX_TIMEOUT_MS = 5000;

function cityKey(city, state, country) {
  return `${(city || "").trim()}|${(state || "").trim()}|${(country || "").trim()}`;
}

/** Free, zero-network first tier — the same table the map's fallback uses. */
export function resolveCuratedCityCoordinates(city, state, country) {
  const coords = CITY_COORDS[cityKey(city, state, country)];
  if (!coords) return null;
  const [lng, lat] = coords; // CITY_COORDS is [lng, lat], GeoJSON order
  return { lat, lng, source: "curated" };
}

/**
 * Real geocoding tier, only active when a provider token is configured.
 * Absent one, resolveCityCoordinates() simply returns null past the curated
 * table — profiles fall back to the map's existing country-centroid behavior,
 * exactly as before this module existed. No key required to ship this safely.
 */
async function resolveViaMapbox(city, state, country) {
  if (!MAPBOX_GEOCODING_TOKEN) return null;
  const query = [city, state, country].filter(Boolean).join(", ");
  if (!query) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAPBOX_TIMEOUT_MS);
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?limit=1&types=place&access_token=${MAPBOX_GEOCODING_TOKEN}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const body = await res.json();
    const [lng, lat] = body?.features?.[0]?.center || [];
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return { lat, lng, source: "mapbox" };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveCityCoordinates({ city, state, country }) {
  return resolveCuratedCityCoordinates(city, state, country) || resolveViaMapbox(city, state, country);
}

/**
 * Best-effort profile enrichment — resolves and persists geo_lat/geo_lng once
 * so every later analytics query reads a plain column instead of re-deriving
 * position from free text. Never throws: a failed or skipped geocode leaves
 * the profile exactly as it was, and the map's existing country-centroid
 * fallback covers it until a later call (this one, or /api/admin/geo/backfill)
 * succeeds.
 */
export async function geocodeProfileIfNeeded(admin, { userId, city, state, country }) {
  if (!userId || !city || !country) return { resolved: false };
  try {
    const resolved = await resolveCityCoordinates({ city, state, country });
    if (!resolved) return { resolved: false };
    const { error } = await admin
      .from("profiles")
      .update({
        geo_lat: resolved.lat,
        geo_lng: resolved.lng,
        geo_source: resolved.source,
        geo_resolved_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (error) return { resolved: false };
    return { resolved: true, source: resolved.source };
  } catch {
    return { resolved: false };
  }
}
