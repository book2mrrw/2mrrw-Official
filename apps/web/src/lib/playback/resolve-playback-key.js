import { getCanonicalReleaseBySlug, resolveEntityPreviewFolder } from "@/lib/media/canonical-catalog";
import { isStreamPlaybackPreferred } from "@/lib/feature-flags";
import { normalizePlaybackR2Key } from "@/lib/playback/normalize-r2-key";
import { normalizeEntityFolderPath, resolveAudio, resolvePreview, isConcreteMediaKey } from "@/lib/media/entity-resolver";
import { resolvePreviewPath, resolveStoragePath, isEntityPreviewFolderPath } from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/normalize-release-type";
import { recordPlaybackResolverOutcome } from "@/lib/playback/playback-resolver-diagnostics";
import { tryResolveStreamPlaybackKey } from "@/lib/playback/resolve-stream-playback";

const PLAYBACK_KEY_TTL_MS = 60_000;
// Unlike the master resolver (which never caches a miss — a track mid-upload
// shouldn't lock users out for 60s), a confirmed-missing preview IS cached,
// short-lived, so repeated plays of a track with no preview don't each pay a
// live R2 folder scan. Short enough that a freshly uploaded clip surfaces fast.
const PREVIEW_KEY_NEGATIVE_TTL_MS = 30_000;
/** @type {Map<string, { expiresAt: number, value: object | null }>} */
const playbackKeyCache = new Map();
/** @type {Map<string, Promise<object | null>>} */
const playbackKeyInflight = new Map();

function playbackCacheKey(slug, trackSlug) {
  return trackSlug ? `${slug}:${trackSlug}` : slug;
}

/**
 * Durable cache (survives cold serverless instances) for the discovered R2 key — separate
 * from the in-memory Map above, which only helps while a single instance stays warm.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} cacheKey
 */
async function loadPersistedKeyResolution(admin, cacheKey) {
  const { data, error } = await admin
    .from("playback_key_resolution_cache")
    .select("audio_key, source, playback_source, entity_folder, product_id")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (error || !data?.audio_key) return null;
  return {
    key: data.audio_key,
    source: data.source,
    playbackSource: data.playback_source,
    resolverResult: data.playback_source,
    resolverDurationMs: 0,
    entityFolder: data.entity_folder,
    productId: data.product_id,
  };
}

/** Fire-and-forget — never blocks the response on a write to the durable cache. */
function persistKeyResolution(admin, cacheKey, result) {
  if (!result?.key) return;
  admin
    .from("playback_key_resolution_cache")
    .upsert({
      cache_key: cacheKey,
      audio_key: result.key,
      source: result.source || null,
      playback_source: result.playbackSource || null,
      entity_folder: result.entityFolder || null,
      product_id: result.productId || null,
      resolved_at: new Date().toISOString(),
    })
    .then(({ error }) => {
      if (error) {
        console.warn("[resolvePlaybackKey] persist cache failed", { cacheKey, message: error.message });
      }
    });
}

/** Invalidate the durable cache entry — called on force-refresh (e.g. media re-upload). */
export async function clearPersistedPlaybackKey(admin, slug, trackSlug = null) {
  const cacheKey = playbackCacheKey(slug, trackSlug);
  const { error } = await admin
    .from("playback_key_resolution_cache")
    .delete()
    .eq("cache_key", cacheKey);
  if (error) {
    console.warn("[resolvePlaybackKey] clear persisted cache failed", { cacheKey, message: error.message });
  }
}

function previewCacheKey(slug, trackSlug) {
  return `preview:${playbackCacheKey(slug, trackSlug)}`;
}

/**
 * Invalidate both the in-memory and durable preview-key cache entries for a
 * slug (and, for a multi-track release, a specific track within it) —
 * called when a preview clip is (re)published for an already-live release,
 * so the new clip is discoverable immediately rather than waiting out
 * PLAYBACK_KEY_TTL_MS / PREVIEW_KEY_NEGATIVE_TTL_MS.
 */
export async function clearPersistedPreviewKey(admin, slug, trackSlug = null) {
  const cacheKey = previewCacheKey(String(slug || "").trim(), trackSlug);
  playbackKeyCache.delete(cacheKey);
  playbackKeyInflight.delete(cacheKey);
  const { error } = await admin
    .from("playback_key_resolution_cache")
    .delete()
    .eq("cache_key", cacheKey);
  if (error) {
    console.warn("[resolvePreviewKey] clear persisted cache failed", { cacheKey, message: error.message });
  }
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

async function resolveStoragePathFromProduct(admin, product, trackSlug, prefetchedTrackRow = undefined) {
  if (product?.storage_path && trackSlug) {
    const trackRow = prefetchedTrackRow !== undefined
      ? prefetchedTrackRow
      : (await admin.from("catalog_tracks").select("storage_path").eq("album_slug", product.slug).eq("slug", String(trackSlug).trim()).maybeSingle()).data;
    if (trackRow?.storage_path) return trackRow.storage_path;
  }

  if (product?.storage_path && !trackSlug) return product.storage_path;

  const slug = String(product?.slug || "").trim();
  if (trackSlug && slug) {
    const trackRow = prefetchedTrackRow !== undefined
      ? prefetchedTrackRow
      : (await admin.from("catalog_tracks").select("storage_path").eq("album_slug", slug).eq("slug", String(trackSlug).trim()).maybeSingle()).data;
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
  if (hit) {
    if (hit.expiresAt > now) return hit.value;
    playbackKeyCache.delete(cacheKey);
  }

  if (playbackKeyInflight.has(cacheKey)) return playbackKeyInflight.get(cacheKey);

  const promise = resolvePlaybackKeyUncached(admin, slug, trackSlug)
    .then((value) => {
      // Only cache successful results — a null (no audio key found) should not block
      // the next attempt. Transient R2 listing failures or DB misses shouldn't lock
      // users out for 60 seconds.
      if (value !== null) {
        if (playbackKeyCache.size >= 1000) {
          const oldest = playbackKeyCache.keys().next().value;
          if (oldest !== undefined) playbackKeyCache.delete(oldest);
        }
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
  const cacheKey = playbackCacheKey(slug, trackSlug);

  const persisted = await loadPersistedKeyResolution(admin, cacheKey);
  if (persisted) {
    recordPlaybackResolverOutcome({
      result: persisted.playbackSource || "master",
      durationMs: Math.round((performance.now() - resolverStarted) * 10) / 10,
      fallbackReason: null,
    });
    return persisted;
  }

  // When trackSlug is known, run catalog_tracks concurrently with the products query
  // to avoid a sequential round trip on the uncached hot path.
  const catalogTrackPrefetchPromise = trackSlug
    ? admin.from("catalog_tracks").select("storage_path").eq("album_slug", slug).eq("slug", trackSlug).maybeSingle()
    : null;

  const { data: product, error } = await admin
    .from("products")
    .select(
      "id, slug, storage_path, preview_path, stream_path, stream_key, product_type, content_type, content_id, metadata"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("[resolvePlaybackKey] products lookup failed", { slug, message: error.message });
    catalogTrackPrefetchPromise?.catch(() => {});
    return null;
  }
  if (!product) {
    catalogTrackPrefetchPromise?.catch(() => {});
    return null;
  }

  const prefetchedTrackRow = catalogTrackPrefetchPromise
    ? (await catalogTrackPrefetchPromise).data ?? null
    : undefined;

  const canonical = getCanonicalReleaseBySlug(slug);
  const releaseType = inferProductReleaseType(product);
  const mediaPath = await resolveStoragePathFromProduct(admin, product, trackSlug, prefetchedTrackRow);
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

  const result = {
    key: audioKey,
    source: pathSource,
    playbackSource,
    resolverResult,
    resolverDurationMs,
    streamFallbackReason: streamFallbackReason || undefined,
    entityFolder: entityFolder.replace(/\/$/, "") || folderKey,
    productId: product.id,
  };

  // Stream rendition keys are just as stable as master/preview — fixed at transcode time,
  // invalidated the same way (clearPersistedPlaybackKey on re-upload). Persisting all three
  // means the live R2 discovery + HEAD check below never reruns once an item is cached.
  persistKeyResolution(admin, cacheKey, result);

  return result;
}

/**
 * Resolve the R2 key for a product's preview audio file only — never returns a full audio key.
 * Used by the library stream endpoint to serve non-entitled users their 15-second preview
 * through the same authenticated pipeline as full streams.
 *
 * Cached with the same two-tier strategy (in-memory + durable cross-instance
 * table) as resolvePlaybackKey above, under a "preview:" cache-key prefix so
 * entries can never collide with a master resolution for the same slug. This
 * function alone decides preview caching policy — resolvePlaybackKey and
 * resolvePlaybackKeyUncached above are untouched.
 */
export async function resolvePreviewKey(admin, slug, options = {}) {
  const normalizedSlug = String(slug || "").trim();
  if (!normalizedSlug) return null;
  const trackSlug = options.trackSlug ? String(options.trackSlug).trim() : null;

  const cacheKey = previewCacheKey(normalizedSlug, trackSlug);
  const now = Date.now();
  const hit = playbackKeyCache.get(cacheKey);
  if (hit) {
    if (hit.expiresAt > now) return hit.value;
    playbackKeyCache.delete(cacheKey);
  }

  if (playbackKeyInflight.has(cacheKey)) return playbackKeyInflight.get(cacheKey);

  const promise = resolvePreviewKeyUncached(admin, normalizedSlug, trackSlug, cacheKey)
    .then((value) => {
      if (playbackKeyCache.size >= 1000) {
        const oldest = playbackKeyCache.keys().next().value;
        if (oldest !== undefined) playbackKeyCache.delete(oldest);
      }
      const ttl = value ? PLAYBACK_KEY_TTL_MS : PREVIEW_KEY_NEGATIVE_TTL_MS;
      playbackKeyCache.set(cacheKey, { value, expiresAt: now + ttl });
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

async function resolvePreviewKeyUncached(admin, normalizedSlug, trackSlug, cacheKey) {
  const persisted = await loadPersistedKeyResolution(admin, cacheKey);
  if (persisted) return persisted.key;

  const { data: product, error } = await admin
    .from("products")
    .select("id, slug, preview_path, storage_path, product_type, content_type, content_id, metadata")
    .eq("slug", normalizedSlug)
    .maybeSingle();

  if (error || !product) return null;

  // For a multi-track release, the per-track preview lives on catalog_tracks,
  // not the parent product row.
  let rawPreviewPath = product.preview_path;
  if (trackSlug) {
    const { data: trackRow } = await admin
      .from("catalog_tracks")
      .select("preview_path")
      .eq("album_slug", normalizedSlug)
      .eq("slug", trackSlug)
      .maybeSingle();
    if (trackRow?.preview_path) rawPreviewPath = trackRow.preview_path;
  }

  // Fast path: a preview we generated ourselves (PreviewTrimPicker, see
  // UploadWizard.js) is stored as the exact, deterministic object key at
  // publish time — no R2 discovery needed at all, just this one DB read.
  // Falls through to live folder discovery only for releases whose preview
  // predates this system (a bare folder convention, resolved by scanning).
  if (rawPreviewPath && isConcreteMediaKey(rawPreviewPath)) {
    const key = String(rawPreviewPath).replace(/^\//, "");
    persistKeyResolution(admin, cacheKey, {
      key,
      source: "preview_direct_key",
      playbackSource: "preview",
      productId: product.id,
    });
    return key;
  }

  const releaseType = inferProductReleaseType(product);
  const previewFolder =
    resolveEntityPreviewFolder(rawPreviewPath, product.slug) ||
    (releaseType ? resolvePreviewPath(releaseType, trackSlug || product.slug, trackSlug ? product.slug : null) : null);
  const legacyPreview =
    resolveEntityPreviewFolder(
      product.metadata?.preview_path || product.metadata?.preview_legacy,
      product.slug
    ) ||
    (isEntityPreviewFolderPath(rawPreviewPath) ? null : rawPreviewPath) ||
    null;

  const key = await resolvePreview(previewFolder, legacyPreview).catch(() => null);
  if (key) {
    persistKeyResolution(admin, cacheKey, {
      key,
      source: "preview_folder",
      playbackSource: "preview",
      entityFolder: previewFolder,
      productId: product.id,
    });
  }
  return key;
}
