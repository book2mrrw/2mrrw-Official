import { getCanonicalTracksForAlbum } from "@/lib/media/canonical-catalog";
import { RELEASE_PRODUCT_TYPES } from "@/lib/commerce/release-recording-index";

/**
 * A multi-track release (album / mixtape / EP) has no audio of its own — its
 * audio lives per track. Several surfaces (My Music rows and their hover hints,
 * the album-modal fallback) request a release by slug alone, which 404'd with
 * "no audio in entity folder" for owners. Resolving the release to its first
 * track at the stream boundary makes "play this release" mean "play it from the
 * top" for every caller, present and future.
 */

const DEFAULT_TRACK_TTL_MS = 5 * 60_000;
const _defaultTrackCache = new Map();

function trackOrder(track) {
  const n = Number(track?.track_number ?? track?.position);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** Pure: first track slug of a release, DB rows preferred over canonical entries. */
export function pickDefaultTrackSlug(dbTracks = [], canonicalTracks = []) {
  for (const list of [dbTracks, canonicalTracks]) {
    const ordered = (list || [])
      .filter((track) => track?.slug)
      .sort((a, b) => trackOrder(a) - trackOrder(b));
    if (ordered.length) return ordered[0].slug;
  }
  return null;
}

/** First track slug when `slug` names a multi-track release; null for singles/features/unknown. */
export async function resolveReleaseDefaultTrackSlug(admin, slug) {
  const key = String(slug || "").trim();
  if (!key) return null;
  const hit = _defaultTrackCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const canonicalTracks = getCanonicalTracksForAlbum(key);
  const { data: product } = await admin
    .from("products")
    .select("product_type")
    .eq("slug", key)
    .maybeSingle();

  let value = null;
  if (RELEASE_PRODUCT_TYPES.has(String(product?.product_type || "").toLowerCase()) || canonicalTracks.length) {
    const { data: dbTracks } = await admin
      .from("catalog_tracks")
      .select("slug, track_number, position")
      .eq("album_slug", key);
    value = pickDefaultTrackSlug(dbTracks || [], canonicalTracks);
  }

  if (_defaultTrackCache.size >= 500) {
    const oldest = _defaultTrackCache.keys().next().value;
    if (oldest !== undefined) _defaultTrackCache.delete(oldest);
  }
  _defaultTrackCache.set(key, { value, expiresAt: Date.now() + DEFAULT_TRACK_TTL_MS });
  return value;
}
