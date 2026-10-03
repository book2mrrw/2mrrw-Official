import { CANONICAL_ALBUMS, getCanonicalTracksForAlbum } from "@/lib/media/canonical-catalog";

/**
 * Release → recording ownership.
 *
 * Owning a multi-track release (album, mixtape, EP) means owning every
 * recording on it. Some of those recordings are ALSO sold as their own
 * standalone product (a single or a feature). Before this module, ownership was
 * product-scoped only, so the owner of an album heard a preview the moment they
 * played one of its songs from that song's single card.
 *
 * The rule is one-directional by design:
 *   release (album / mixtape / EP)  → unlocks the standalone products of its tracks
 *   standalone (single / feature)   → unlocks nothing else
 *
 * This index is the single authority both the server stream gate
 * (userCanStreamProduct) and the client entitlement payload (/api/account/state
 * ownedSlugs) read, so the two can never disagree about which songs a release
 * covers.
 */

export const RELEASE_PRODUCT_TYPES = new Set(["album", "ep", "mixtape"]);
export const STANDALONE_PRODUCT_TYPES = new Set(["single", "feature"]);

const INDEX_TTL_MS = 5 * 60_000;

let _cached = null;
let _inflight = null;

/** Normalize a slug or title into a comparable recording key ("02-w-2-d" → "w2d"). */
export function recordingKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Track slugs carry their position ("09-hour-glass"); strip only that exact prefix. */
function trackSlugKey(track) {
  const slug = String(track?.slug || "");
  const n = Number(track?.track_number ?? track?.position);
  if (Number.isFinite(n) && n > 0) {
    const stripped = slug.replace(new RegExp(`^0*${n}[\\s._-]+`), "");
    return recordingKey(stripped);
  }
  return recordingKey(slug);
}

function explicitStandaloneSlug(track) {
  return (
    track?.standalone_slug ||
    track?.metadata?.standalone_slug ||
    null
  );
}

function addLink(map, from, to) {
  if (!map.has(from)) map.set(from, new Set());
  map.get(from).add(to);
}

/**
 * Pure index builder.
 *
 * A release track links to a standalone product when:
 *   1. the track names it explicitly (`standalone_slug`), or
 *   2. the track's slug (minus its position prefix) or title matches the
 *      product's slug or title after normalization.
 *
 * @param {{
 *   releaseSlugs: Iterable<string>,
 *   tracks: Array<{ album_slug: string, slug: string, title?: string, track_number?: number, standalone_slug?: string, metadata?: object }>,
 *   standaloneProducts: Array<{ slug: string, title?: string }>,
 * }} input
 */
export function buildReleaseRecordingIndex({ releaseSlugs = [], tracks = [], standaloneProducts = [] } = {}) {
  const releases = new Set([...releaseSlugs].filter(Boolean));
  const standaloneSlugs = new Set();
  const standaloneByKey = new Map();
  for (const product of standaloneProducts || []) {
    if (!product?.slug) continue;
    standaloneSlugs.add(product.slug);
    for (const key of [recordingKey(product.slug), recordingKey(product.title)]) {
      if (key) addLink(standaloneByKey, key, product.slug);
    }
  }

  const releaseToStandalone = new Map();
  const standaloneToReleases = new Map();

  for (const track of tracks || []) {
    const releaseSlug = track?.album_slug;
    if (!releaseSlug || !releases.has(releaseSlug)) continue;

    const matches = new Set();
    const explicit = explicitStandaloneSlug(track);
    if (explicit && standaloneSlugs.has(explicit)) matches.add(explicit);
    for (const key of [trackSlugKey(track), recordingKey(track.title)]) {
      if (!key) continue;
      for (const slug of standaloneByKey.get(key) || []) matches.add(slug);
    }

    for (const standaloneSlug of matches) {
      if (standaloneSlug === releaseSlug) continue;
      addLink(releaseToStandalone, releaseSlug, standaloneSlug);
      addLink(standaloneToReleases, standaloneSlug, releaseSlug);
    }
  }

  return { releaseToStandalone, standaloneToReleases };
}

/** Standalone product slugs unlocked by the releases in `ownedSlugs` (excluding ones already owned). */
export function standaloneSlugsUnlockedByReleases(index, ownedSlugs = []) {
  const owned = new Set((ownedSlugs || []).filter(Boolean));
  const unlocked = new Set();
  for (const slug of owned) {
    for (const standalone of index?.releaseToStandalone?.get(slug) || []) {
      if (!owned.has(standalone)) unlocked.add(standalone);
    }
  }
  return [...unlocked];
}

/** Release slugs whose ownership unlocks this standalone product. */
export function releasesContainingStandalone(index, slug) {
  return [...(index?.standaloneToReleases?.get(slug) || [])];
}

async function loadIndexUncached(admin) {
  const [releaseResult, standaloneResult] = await Promise.all([
    admin.from("products").select("slug, product_type").in("product_type", [...RELEASE_PRODUCT_TYPES]),
    admin.from("products").select("slug, title, product_type").in("product_type", [...STANDALONE_PRODUCT_TYPES]),
  ]);
  if (releaseResult.error) throw releaseResult.error;
  if (standaloneResult.error) throw standaloneResult.error;

  const releaseSlugs = new Set((releaseResult.data || []).map((row) => row.slug).filter(Boolean));
  for (const album of CANONICAL_ALBUMS) {
    if (album?.slug) releaseSlugs.add(album.slug);
  }

  let dbTracks = [];
  if (releaseSlugs.size) {
    const { data, error } = await admin
      .from("catalog_tracks")
      .select("album_slug, slug, title, track_number, metadata")
      .in("album_slug", [...releaseSlugs]);
    if (error) throw error;
    dbTracks = data || [];
  }

  // Canonical entries carry the durable explicit links (admin re-publish rewrites
  // catalog_tracks.metadata, so an explicit link stored only there would not last).
  const canonicalTracks = [...releaseSlugs].flatMap((slug) =>
    getCanonicalTracksForAlbum(slug).map((track) => ({ ...track, album_slug: slug }))
  );

  return buildReleaseRecordingIndex({
    releaseSlugs,
    tracks: [...dbTracks, ...canonicalTracks],
    standaloneProducts: standaloneResult.data || [],
  });
}

/** Cached (5 min, per instance) release → recording index. */
export async function loadReleaseRecordingIndex(admin) {
  const now = Date.now();
  if (_cached && _cached.expiresAt > now) return _cached.value;
  if (_inflight) return _inflight;
  _inflight = loadIndexUncached(admin)
    .then((value) => {
      _cached = { value, expiresAt: Date.now() + INDEX_TTL_MS };
      return value;
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

export function clearReleaseRecordingIndexCache() {
  _cached = null;
  _inflight = null;
}
