import { getCanonicalReleaseBySlug, resolveEntityPreviewFolder } from "@/lib/media/canonical-catalog";
import { isStreamPlaybackPreferred } from "@/lib/feature-flags";
import { normalizePlaybackR2Key } from "@/lib/playback/normalize-r2-key";
import { normalizeEntityFolderPath, resolveAudio, resolvePreview } from "@/lib/media/entity-resolver";
import { resolvePreviewPath, resolveStoragePath, isEntityPreviewFolderPath } from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/normalize-release-type";
import { recordPlaybackResolverOutcome } from "@/lib/playback/playback-resolver-diagnostics";
import { tryResolveStreamPlaybackKey } from "@/lib/playback/resolve-stream-playback";

const PLAYBACK_KEY_TTL_MS = 60_000;
/** @type {Map<string, { expiresAt: number, value: object | null }>} */
const playbackKeyCache = new Map();
/** @type {Map<string, Promise<object | null>>} */
const playbackKeyInflight = new Map();

function playbackCacheKey(slug, trackSlug) {
  return trackSlug ? `${slug}:${trackSlug}` : slug;
}

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

async function resolveStoragePathFromProduct(admin, product, trackSlug) {
  if (product?.storage_path && trackSlug) {
    const { data: trackRow } = await admin
      .from("catalog_tracks")
      .select("storage_path")
      .eq("album_slug", product.slug)
      .eq("slug", String(trackSlug).trim())
      .maybeSingle();
    if (trackRow?.storage_path) return trackRow.storage_path;
  }

  if (product?.storage_path && !trackSlug) return product.storage_path;

  const slug = String(product?.slug || "").trim();
  if (trackSlug && slug) {
    const { data: trackRow } = await admin
      .from("catalog_tracks")
      .select("storage_path")
      .eq("album_slug", slug)
      .eq("slug", String(trackSlug).trim())
      .maybeSingle();
    if (trackRow?.storage_path) return trackRow.storage_path;
  }

  const contentId = product?.content_id;
  const contentType = String(product?.content_type || product?.metadata?.content_type || "").toLowerCase();

  if (!contentId) return null;

  if (contentType === "track") {
    return trackFullAudioPath(admin, contentId);
  }

  return releasePrimaryAudioPath(admin, contentId);
}

async function discoverAudioInFolder(folderKey, entityFolder) {
  return resolveAudio(folderKey || entityFolder);
}

/** Same release-type inference as storefront previews — features must not fall through to singles. */
function inferProductReleaseType(product) {
  const slug = String(product?.slug || "").trim();
  const fromRow =
    product?.metadata?.release_category ||
    product?.metadata?.release_type ||
    product?.product_type ||
    product?.content_type;
  if (fromRow) return normalizeReleaseType(fromRow);

  const canonical = slug ? getCanonicalReleaseBySlug(slug) : null;
  if (canonical?.release_type) return normalizeReleaseType(canonical.release_type);

  const storage = String(product?.storage_path || product?.metadata?.storage_path || "").replace(
    /^\//,
    ""
  );
  if (/(^|\/)features\//.test(storage)) return "features";
  if (/(^|\/)singles\//.test(storage)) return "singles";
  if (/(^|\/)albums\//.test(storage)) return "albums";
  if (/(^|\/)mixtapes-and-eps\//.test(storage)) return "mixtapes-and-eps";

  console.error("[resolvePlaybackKey] could not infer release_type", {
    slug: product?.slug,
    product_type: product?.product_type,
    content_type: product?.content_type,
  });
  return null;
}

/**
 * Resolve canonical R2 object key for entitled playback by storefront product slug.
 * Entity folder from DB → dynamic audio discovery in R2.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} productSlug
 * @param {{ trackSlug?: string }} [options]
 * @returns {Promise<{ key: string, source: string, entityFolder?: string } | null>}
 */
export async function resolvePlaybackKey(admin, productSlug, options = {}) {
  const slug = String(productSlug || "").trim();
  if (!slug) return null;

  const trackSlug = options.trackSlug ? String(options.trackSlug).trim() : null;
  const cacheKey = playbackCacheKey(slug, trackSlug);
  const now = Date.now();
  const hit = playbackKeyCache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.value;

  if (playbackKeyInflight.has(cacheKey)) return playbackKeyInflight.get(cacheKey);

  const promise = resolvePlaybackKeyUncached(admin, slug, trackSlug)
    .then((value) => {
      // Only cache successful results — a null (no audio key found) should not block
      // the next attempt. Transient R2 listing failures or DB misses shouldn't lock
      // users out for 60 seconds.
      if (value !== null) {
        playbackKeyCache.set(cacheKey, { value, expiresAt: now + PLAYBACK_KEY_TTL_MS });
      }
      playbackKeyInflight.delete(cacheKey);
      return value;
    })
    .catch((err) => {
      playbackKeyInflight.delete(cacheKey);
      throw err;
    });

  playbackKeyInflight.set(cacheKey, promise);
  return promise;
}

/** Clear in-memory playback key cache (tests / hot reload). */
export function clearPlaybackKeyCache() {
  playbackKeyCache.clear();
  playbackKeyInflight.clear();
}

async function resolvePlaybackKeyUncached(admin, slug, trackSlug) {
  const resolverStarted = performance.now();

  const { data: product, error } = await admin
    .from("products")
    .select(
      "id, slug, storage_path, preview_path, stream_path, stream_key, product_type, content_type, content_id, metadata"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("[resolvePlaybackKey] products lookup failed", { slug, message: error.message });
    return null;
  }
  if (!product) return null;

  const canonical = getCanonicalReleaseBySlug(slug);
  const releaseType = inferProductReleaseType(product);
  const mediaPath = await resolveStoragePathFromProduct(admin, product, trackSlug);
  let storagePath =
    mediaPath ||
    product.storage_path ||
    canonical?.storage_path ||
    (releaseType
      ? resolveStoragePath(releaseType, slug, trackSlug, trackSlug ? slug : null)
      : null);
  if (!storagePath) return null;

  const entityFolder = normalizeEntityFolderPath(storagePath);
  const folderKey = normalizePlaybackR2Key(entityFolder.replace(/\/$/, ""));
  let audioKey = await discoverAudioInFolder(folderKey, entityFolder);

  if (!audioKey && canonical?.storage_path) {
    const canonicalFolder = normalizePlaybackR2Key(
      normalizeEntityFolderPath(canonical.storage_path).replace(/\/$/, "")
    );
    if (canonicalFolder && canonicalFolder !== folderKey) {
      audioKey = await discoverAudioInFolder(canonicalFolder, canonical.storage_path);
    }
  }

  let playbackSource = "master";
  if (!audioKey) {
    const previewFolder =
      resolveEntityPreviewFolder(product.preview_path, slug) ||
      (releaseType
        ? resolvePreviewPath(releaseType, trackSlug || slug, trackSlug ? slug : null)
        : null) ||
      canonical?.preview_path;
    const legacyPreview =
      resolveEntityPreviewFolder(
        product.metadata?.preview_path || product.metadata?.preview_legacy,
        slug
      ) ||
      canonical?.preview_legacy ||
      (isEntityPreviewFolderPath(product.preview_path) ? null : product.preview_path) ||
      null;
    audioKey = await resolvePreview(previewFolder, legacyPreview).catch(() => null);
    if (audioKey) playbackSource = "preview";
  }

  if (!audioKey) return null;

  let resolverResult = playbackSource;
  let streamFallbackReason = null;
  let streamSource = null;

  if (playbackSource === "master" && isStreamPlaybackPreferred()) {
    const streamAttempt = await tryResolveStreamPlaybackKey(admin, product, trackSlug);
    if (streamAttempt.ok && streamAttempt.key) {
      audioKey = streamAttempt.key;
      playbackSource = "stream";
      resolverResult = "stream";
      streamSource = streamAttempt.source;
    } else {
      streamFallbackReason = streamAttempt.fallbackReason || "unknown";
      resolverResult = "master";
    }
  }

  const resolverDurationMs = Math.round((performance.now() - resolverStarted) * 10) / 10;
  recordPlaybackResolverOutcome({
    result: resolverResult,
    durationMs: resolverDurationMs,
    fallbackReason: streamFallbackReason,
  });

  const pathSource =
    playbackSource === "stream"
      ? streamSource || "stream_key"
      : playbackSource === "preview"
        ? "preview_folder"
        : mediaPath && mediaPath !== product.storage_path
          ? trackSlug
            ? "catalog_tracks"
            : "media_assets"
          : "products.storage_path";

  return {
    key: audioKey,
    source: pathSource,
    playbackSource,
    resolverResult,
    resolverDurationMs,
    streamFallbackReason: streamFallbackReason || undefined,
    entityFolder: entityFolder.replace(/\/$/, "") || folderKey,
    productId: product.id,
  };
}
