/**
 * Server-side catalog DB layer.
 *
 * Reads from the `products` and `catalog_tracks` Supabase tables to produce
 * the same enriched shape as canonical-catalog.js — so the rest of the
 * storefront can swap between hardcoded fallback and live DB data transparently.
 *
 * All functions return null on error so callers fall back to canonical-catalog.js.
 * Never throws — page.js cannot crash because catalog DB is unavailable.
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

const PRODUCT_COLS = [
  "id", "slug", "title", "product_type", "price_cents",
  "cover_url", "storage_path", "preview_path",
  "video_path", "image_path", "stream_path",
  "release_type", "release_date",
  "metadata", "active", "gifting_enabled",
  "content_type", "content_id",
].join(", ");

/** Map a raw products row to an enriched storefront release shape. */
function mapProductRow(row) {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};

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
  const hasVideo = isSingle || Boolean(legacyVideo || row.video_path);

  const visual = hasVideo
    ? visualDiscoveryUrl(releaseTypeFolder, row.slug, {
        legacyVideo: legacyVideo || undefined,
        legacyImage: legacyCover || undefined,
      })
    : legacyCover || "";

  return {
    // Identity
    slug: row.slug,
    title: row.title,
    display_title: row.title,
    type: releaseTypeShort,
    release_type: releaseTypeShort,
    release_category: meta.release_category || null,
    release_date: row.release_date || meta.release_date || null,

    // Commerce
    price_cents: row.price_cents || 0,
    price: (row.price_cents || 0) / 100,
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
    video: isSingle ? visual : (row.video_path || undefined),
    coverArtType: isSingle ? "video" : (row.video_path ? "video" : "image"),

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

    metadata: meta,
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

/** Fetch catalog_tracks for a product (by product_id). Returns [] on error. */
async function fetchTracksForProduct(admin, productId, albumSlug, releaseTypeFolder) {
  try {
    const { data, error } = await admin
      .from("catalog_tracks")
      .select("id, slug, title, position, storage_path, preview_path, stream_path, duration_seconds, metadata")
      .eq("product_id", productId)
      .order("position", { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => mapTrackRow(row, albumSlug, releaseTypeFolder));
  } catch (err) {
    console.error("[catalog-db] fetchTracksForProduct error", { productId, error: err?.message });
    return [];
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
      .select(PRODUCT_COLS)
      .in("product_type", ["single", "feature", "album"])
      .eq("active", true)
      .order("release_date", { ascending: false, nullsLast: true });

    if (error) throw error;
    if (!data?.length) return null;

    const singles = [];
    const features = [];
    const albums = [];
    const mixtapes = [];

    for (const row of data) {
      const enriched = mapProductRow(row);
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

        // Fetch tracks for this multi-track release
        const tracks = await fetchTracksForProduct(
          admin,
          row.id,
          row.slug,
          releaseTypeFolder || "mixtapes-and-eps"
        );

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

    return hasContent ? { singles, features, albums, mixtapes } : null;
  } catch (err) {
    console.error("[catalog-db] getStorefrontCatalogFromDB error", { error: err?.message });
    return null;
  }
}
