/**
 * Server-side catalog DB layer.
 *
 * Reads from the `products` and `catalog_tracks` Supabase tables to produce
 * the same enriched shape as canonical-catalog.js — so the rest of the
 * storefront can swap between hardcoded fallback and live DB data transparently.
 *
 * Full-catalog SSR reads return null on error so page.js can fall back without
 * crashing. Bounded API reads throw so their route can distinguish a database
 * outage from a healthy, legitimately empty catalog.
 * `getStorefrontCatalogFromDB()` never throws, so page.js cannot crash because
 * the catalog database is unavailable.
 */

import { getAdminClient } from "@/lib/supabase/admin";
import {
  previewDiscoveryUrl,
  resolveArtworkPath,
  resolvePreviewPath,
  resolveStoragePath,
  resolveVideoPath,
  visualDiscoveryUrl,
} from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/utils/normalize-release-type";
import { releaseAvailability } from "@/lib/releases/release-availability";

const PRODUCT_COLS = [
  "id", "release_id", "slug", "title", "product_type", "price_cents",
  "cover_url", "storage_path", "preview_path",
  "video_path", "image_path", "stream_path",
  "release_type", "release_date",
  "metadata", "active", "gifting_enabled",
  "content_type", "content_id",
].join(", ");

const RELEASE_LIFECYCLE_COLS = "id,status,scheduled_at,available_at,storefront_visible,upcoming_visible,preview_before_release,preorder_enabled,preorder_starts_at,preorder_price_cents,early_access_enabled,early_access_starts_at,early_access_scope,early_access_audiences,release_timezone,unavailable_at";

export function isConcreteVideoAssetPath(value) {
  const path = String(value || "").trim();
  return /\.(?:mp4|webm|mov)(?:$|[?#])/i.test(path);
}

/** Map a raw products row to the canonical enriched storefront release shape. */
export function mapProductRow(row) {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const lifecycleRow = Array.isArray(row.releases) ? row.releases[0] : row.releases;
  const availability = lifecycleRow ? releaseAvailability(lifecycleRow) : null;
  const artist = typeof meta.artist === "string"
    ? meta.artist
    : typeof meta.artist?.name === "string"
      ? meta.artist.name
      : typeof meta.artist_name === "string"
        ? meta.artist_name
        : "2MRRW";

  // Canonical release type (R2 folder segment): 'singles' | 'features' | 'albums' | 'mixtapes-and-eps'
  const releaseTypeFolder =
    row.release_type ||
    normalizeReleaseType(meta.release_type || meta.release_category || row.product_type) ||
    "singles";

  // Short release type for backward compat: 'single' | 'feature' | 'album' | 'ep' | 'mixtape'
  const releaseTypeShort = meta.release_category || row.product_type || "single";

  // Deterministic R2 paths from slug + release type
  const storage_path = row.storage_path || resolveStoragePath(releaseTypeFolder, row.slug);
  const artwork_path = resolveArtworkPath(releaseTypeFolder, row.slug);
  const preview_path = row.preview_path || resolvePreviewPath(releaseTypeFolder, row.slug);
  const video_path = row.video_path || resolveVideoPath(releaseTypeFolder, row.slug);

  // Cover: DB explicit cover, or fall back to legacy public path in metadata
  const legacyCover = row.cover_url || row.image_path || meta.legacy_cover || null;
  const legacyVideo = meta.legacy_video_stem
    ? `videos/${releaseTypeFolder}/${row.slug}/${meta.legacy_video_stem}.mp4`
    : null;

  const isSingle = releaseTypeFolder === "singles";
  // A folder is a discovery hint, not proof that a motion object exists.
  const hasVideo = isSingle || Boolean(legacyVideo || isConcreteVideoAssetPath(row.video_path));

  const visual = hasVideo
    ? visualDiscoveryUrl(releaseTypeFolder, row.slug, {
        legacyVideo: legacyVideo || undefined,
        legacyImage: legacyCover || undefined,
      })
    : legacyCover || "";

  return {
    // Identity
    id: row.id || row.slug,
    slug: row.slug,
    title: row.title,
    display_title: row.title,
    artist,
    type: releaseTypeShort,
    release_type: releaseTypeShort,
    release_category: meta.release_category || null,
    release_date: row.release_date || meta.release_date || null,
    releaseDate: row.release_date || meta.release_date || null,
    release_id: row.release_id || null,
    status: lifecycleRow?.status || (row.active ? "published" : "unavailable"),
    scheduled_publish_at: lifecycleRow?.available_at || lifecycleRow?.scheduled_at || null,
    availability,
    lifecycle: lifecycleRow || null,

    // Commerce
    price_cents: availability?.preorderPriceCents ?? row.price_cents ?? 0,
    price: (availability?.preorderPriceCents ?? row.price_cents ?? 0) / 100,
    gifting_enabled: row.gifting_enabled || false,
    product_type: row.product_type,
    content_type: row.content_type || null,
    content_id: row.content_id || null,

    // Canonical media paths (R2 folder keys)
    storage_path,
    artwork_path,
    preview_path,
    video_path,
    stream_path: row.stream_path || null,
    image_path: row.image_path || null,

    // Resolved display URLs
    visual,
    cover: visual || legacyCover || "",
    preview: previewDiscoveryUrl(preview_path),
    video: hasVideo
      ? (isConcreteVideoAssetPath(row.video_path) ? row.video_path : visual)
      : undefined,
    coverArtType: hasVideo ? "video" : "image",

    // Legacy cover for <img> fallback
    baseCover: legacyCover || null,
    legacy_cover: legacyCover || null,
    legacy_cover_stem: meta.legacy_cover_stem || null,
    legacy_video_stem: meta.legacy_video_stem || null,
    cover_url: legacyCover || null,

    // Control System (not set from DB catalog — control system is a separate layer)
    csAudio: null,
    csCover: null,
    hasCs: false,

    // CatalogRelease compatibility. Multi-track products replace this with
    // their set-based catalog_tracks projection below.
    tracks: [],
    metadata: meta,
  };
}

/**
 * Fetch one bounded, deterministic page of the public singles projection.
 *
 * `products.active` is the indexed storefront-listing projection maintained by
 * publication, scheduling, and archival transactions. The attached lifecycle
 * row remains the authority for request-time visibility and access semantics.
 * Database failures throw; a healthy catalog with zero rows returns an empty
 * page so API callers never confuse an outage with a legitimately empty store.
 * The no-throw fallback guarantee applies only to the full-catalog SSR reader.
 */
export async function getStorefrontSinglesPageFromDB({ offset = 0, limit = 20 } = {}) {
  const normalizedOffset = Math.max(0, Number.parseInt(String(offset), 10) || 0);
  const normalizedLimit = Math.min(
    100,
    Math.max(1, Number.parseInt(String(limit), 10) || 20)
  );
  const admin = getAdminClient();
  const { data, error, count } = await admin
    .from("products")
    .select(`${PRODUCT_COLS}, releases(${RELEASE_LIFECYCLE_COLS})`, { count: "exact" })
    .eq("product_type", "single")
    .eq("active", true)
    .order("release_date", { ascending: false, nullsLast: true })
    .order("id", { ascending: false })
    .range(normalizedOffset, normalizedOffset + normalizedLimit - 1);

  if (error) throw error;
  if (!Number.isInteger(count)) throw new Error("catalog_count_unavailable");

  const projected = (data || []).map(mapProductRow);
  const suppressed = projected.filter(
    (release) => release.availability && !release.availability.visible
  );
  if (suppressed.length > 0) {
    // Publication writes maintain `products.active` as the indexed listing
    // projection, including scheduled/upcoming cards. A cross-table mismatch
    // must fail closed for that row without taking every healthy release
    // offline. `total` becomes a conservative upper bound until the invariant
    // is repaired; `projectionTotal` keeps forward pagination deterministic.
    console.error("[catalog-db] suppressing active products that are not lifecycle-visible", {
      products: suppressed.map((release) => ({
        productId: release.id,
        releaseId: release.release_id,
        status: release.status,
      })),
    });
  }

  const releases = projected.filter(
    (release) => !release.availability || release.availability.visible
  );
  return {
    releases,
    total: Math.max(normalizedOffset + releases.length, count - suppressed.length),
    projectionTotal: count,
  };
}

/** Map a raw catalog_tracks row to enriched track shape. */
function mapTrackRow(trackRow, albumSlug, releaseTypeFolder) {
  const meta =
    trackRow.metadata && typeof trackRow.metadata === "object" ? trackRow.metadata : {};
  const preview_path =
    trackRow.preview_path ||
    resolvePreviewPath(releaseTypeFolder, trackRow.slug, albumSlug);

  return {
    id: trackRow.id,
    slug: trackRow.slug,
    title: trackRow.title,
    display_title: trackRow.title,
    track_number: trackRow.position,
    position: trackRow.position,
    album_slug: albumSlug,
    albumSlug,
    storage_path: trackRow.storage_path || resolveStoragePath(releaseTypeFolder, albumSlug, trackRow.slug),
    preview_path,
    stream_path: trackRow.stream_path || null,
    preview: previewDiscoveryUrl(preview_path),
    duration_seconds: trackRow.duration_seconds || null,
    metadata: meta,
  };
}

/**
 * Fetch every multi-track product in one indexed query and group it by product.
 * Catalog size therefore changes result volume, not database round-trip count.
 */
async function fetchTracksForProducts(admin, products) {
  const productIds = products.map((product) => product.id).filter(Boolean);
  if (productIds.length === 0) return new Map();
  try {
    const { data, error } = await admin
      .from("catalog_tracks")
      .select("id, product_id, slug, title, position, storage_path, preview_path, stream_path, duration_seconds, metadata")
      .in("product_id", productIds)
      .order("position", { ascending: true });
    if (error) throw error;

    const productById = new Map(products.map((product) => [product.id, product]));
    const tracksByProductId = new Map(productIds.map((id) => [id, []]));
    for (const row of data || []) {
      const product = productById.get(row.product_id);
      if (!product) continue;
      tracksByProductId.get(row.product_id).push(
        mapTrackRow(row, product.slug, product.releaseTypeFolder)
      );
    }
    return tracksByProductId;
  } catch (err) {
    console.error("[catalog-db] fetchTracksForProducts error", {
      productCount: productIds.length,
      error: err?.message,
    });
    return new Map();
  }
}

/**
 * Fetch all active digital products from the products table, grouped by type.
 * Returns null on DB error so callers fall back to canonical-catalog.js.
 *
 * @returns {Promise<{
 *   singles: object[],
 *   features: object[],
 *   albums: object[],
 *   mixtapes: object[],
 * } | null>}
 */
export async function getStorefrontCatalogFromDB() {
  try {
    const admin = getAdminClient();

    const { data, error } = await admin
      .from("products")
      .select(`${PRODUCT_COLS}, releases(${RELEASE_LIFECYCLE_COLS})`)
      .in("product_type", ["single", "feature", "album"])
      .order("release_date", { ascending: false, nullsLast: true });

    if (error) throw error;
    if (!data?.length) return null;

    const multiTrackProducts = data
      .filter((row) => row.product_type === "album")
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        releaseTypeFolder:
          row.release_type ||
          normalizeReleaseType(
            row.metadata?.release_type || row.metadata?.release_category || row.product_type
          ) ||
          "mixtapes-and-eps",
      }));
    const tracksByProductId = await fetchTracksForProducts(admin, multiTrackProducts);

    const singles = [];
    const features = [];
    const albums = [];
    const mixtapes = [];

    for (const row of data) {
      const enriched = mapProductRow(row);
      if (!enriched.lifecycle && !row.active) continue;
      if (enriched.availability && !enriched.availability.visible) continue;
      const releaseTypeFolder =
        row.release_type ||
        normalizeReleaseType(
          (row.metadata?.release_type || row.metadata?.release_category || row.product_type)
        );

      if (row.product_type === "single") {
        singles.push(enriched);
      } else if (row.product_type === "feature") {
        features.push(enriched);
      } else if (row.product_type === "album") {
        // Distinguish true albums from mixtapes/EPs using release_type folder
        const isMixtapeOrEp = releaseTypeFolder === "mixtapes-and-eps";

        const tracks = tracksByProductId.get(row.id) || [];

        const enrichedAlbum = {
          ...enriched,
          type: isMixtapeOrEp
            ? (enriched.release_category?.toLowerCase() === "ep" ? "ep" : "mixtape")
            : "album",
          date: enriched.release_date,
          vinyl: 47.99,
          tracks: tracks.length > 0 ? tracks : undefined,
          trackTitles: tracks.length > 0 ? tracks.map((t) => t.title) : undefined,
        };

        if (isMixtapeOrEp) {
          mixtapes.push(enrichedAlbum);
        } else {
          albums.push(enrichedAlbum);
        }
      }
    }

    // Only return if we actually got digital music products
    const hasContent =
      singles.length > 0 || features.length > 0 ||
      albums.length > 0 || mixtapes.length > 0;

    const lifecycleOrder = (a, b) => {
      const aUpcoming = a.availability && !a.availability.live;
      const bUpcoming = b.availability && !b.availability.live;
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
      const aTime = Date.parse(a.scheduled_publish_at || a.release_date || 0) || 0;
      const bTime = Date.parse(b.scheduled_publish_at || b.release_date || 0) || 0;
      return aUpcoming ? aTime - bTime : bTime - aTime;
    };
    [singles, features, albums, mixtapes].forEach((items) => items.sort(lifecycleOrder));
    return hasContent ? { singles, features, albums, mixtapes } : null;
  } catch (err) {
    console.error("[catalog-db] getStorefrontCatalogFromDB error", { error: err?.message });
    return null;
  }
}
