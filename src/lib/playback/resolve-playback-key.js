import { normalizePlaybackR2Key } from "@/lib/playback/normalize-r2-key";

const FULL_AUDIO_ROLES = ["full_audio", "master_audio", "audio", "audio_full_song", "track_audio"];

function pickAssetPath(assetRow) {
  const nested = assetRow?.media_assets;
  const asset = Array.isArray(nested) ? nested[0] : nested;
  return asset?.storage_path || assetRow?.storage_path || null;
}

async function trackFullAudioPath(admin, trackId) {
  if (!trackId) return null;

  const { data: linked } = await admin
    .from("release_media")
    .select("media_assets(storage_path, bucket)")
    .eq("track_id", trackId)
    .eq("is_active", true)
    .in("asset_role", FULL_AUDIO_ROLES)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromLink = pickAssetPath(linked);
  if (fromLink) return fromLink;

  const { data: owned } = await admin
    .from("media_assets")
    .select("storage_path, bucket")
    .eq("owner_type", "track")
    .eq("owner_id", trackId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return owned?.storage_path || null;
}

async function releasePrimaryAudioPath(admin, releaseId) {
  if (!releaseId) return null;

  const { data: tracks } = await admin
    .from("tracks")
    .select("id")
    .eq("release_id", releaseId)
    .order("position", { ascending: true })
    .limit(1);

  const trackId = tracks?.[0]?.id;
  if (!trackId) return null;
  return trackFullAudioPath(admin, trackId);
}

async function resolveStoragePathFromProduct(admin, product) {
  if (product?.storage_path) return product.storage_path;

  const contentId = product?.content_id;
  const contentType = String(product?.content_type || product?.metadata?.content_type || "").toLowerCase();

  if (!contentId) return null;

  if (contentType === "track") {
    return trackFullAudioPath(admin, contentId);
  }

  return releasePrimaryAudioPath(admin, contentId);
}

/**
 * Resolve canonical R2 key for entitled playback by storefront product slug.
 * @returns {Promise<{ key: string, source: string } | null>}
 */
export async function resolvePlaybackKey(admin, productSlug) {
  const slug = String(productSlug || "").trim();
  if (!slug) return null;

  const { data: product, error } = await admin
    .from("products")
    .select("id, slug, storage_path, content_type, content_id, metadata")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  if (!product) return null;

  const mediaPath = await resolveStoragePathFromProduct(admin, product);
  const storagePath = mediaPath || product.storage_path;
  if (!storagePath) return null;

  const key = normalizePlaybackR2Key(storagePath);
  if (!key) return null;

  return {
    key,
    source: mediaPath && mediaPath !== product.storage_path ? "media_assets" : "products.storage_path",
  };
}
