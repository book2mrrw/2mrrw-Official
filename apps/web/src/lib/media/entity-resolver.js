import {
  discoverFileByExtensions,
  headR2ObjectKey,
  listR2Objects,
  getPublicR2Url,
} from "@/lib/storage/r2";
import {
  getArtworkPlaceholderUrl,
  normalizeToEntityFolder,
  resolveArtworkPath,
  resolveVideoPath,
} from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/normalize-release-type";
import { catalogCoverUrl } from "@/lib/media-urls";
import { getCanonicalReleaseBySlug } from "@/lib/media/canonical-catalog";
import { resolveConcreteVideoR2Key } from "@/lib/media/resolve-concrete-video-key";

export const AUDIO_EXTENSIONS = [".wav", ".flac", ".m4a", ".mp3"];
export const ARTWORK_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
export const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"];
export const WAVEFORM_EXTENSIONS = [".json", ".dat", ".peak"];

// Visual media keys are stable; 5-minute TTL reduces ListObjects calls across cold-start instances.
const CACHE_TTL_MS = 300_000;
/** @type {Map<string, { expiresAt: number, value: string | null }>} */
const discoveryCache = new Map();
/** @type {Map<string, Promise<string | null>>} */
const discoveryInflight = new Map();

function cacheKey(prefix, kind) {
  return `${kind}:${normalizeToEntityFolder(prefix)}`;
}

function readCache(key) {
  const hit = discoveryCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    discoveryCache.delete(key);
    return undefined;
  }
  return hit.value;
}

function writeCache(key, value) {
  discoveryCache.set(key, { value: value ?? null, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Normalize any DB/catalog path to an entity folder (trailing slash, no filename). */
export function normalizeEntityFolderPath(path) {
  return normalizeToEntityFolder(path);
}

/** True when path looks like a concrete file key (has known media extension). */
export function isConcreteMediaKey(path) {
  const normalized = String(path || "").replace(/^\//, "");
  return /\.(wav|flac|m4a|mp3|jpg|jpeg|png|webp|mp4|webm|mov)$/i.test(normalized);
}

async function discoverInFolder(folder, extensions, kind) {
  const entityFolder = normalizeEntityFolderPath(folder);
  if (!entityFolder) return null;

  const key = cacheKey(entityFolder, kind);
  const cached = readCache(key);
  if (cached !== undefined) return cached;

  if (discoveryInflight.has(key)) return discoveryInflight.get(key);

  const promise = discoverFileByExtensions(entityFolder, extensions)
    .then((discovered) => {
      writeCache(key, discovered);
      discoveryInflight.delete(key);
      return discovered;
    })
    .catch((err) => {
      discoveryInflight.delete(key);
      throw err;
    });

  discoveryInflight.set(key, promise);
  return promise;
}

/**
 * Resolve full audio object key inside an entity folder.
 * @param {string} entityFolder
 * @returns {Promise<string | null>}
 */
export async function resolveAudioFile(entityFolder) {
  const folder = normalizeEntityFolderPath(entityFolder);
  if (!folder) return null;
  if (isConcreteMediaKey(entityFolder)) {
    return String(entityFolder).replace(/^\//, "");
  }
  return discoverInFolder(folder, AUDIO_EXTENSIONS, "audio");
}

/**
 * Resolve preview audio inside preview entity folder.
 * @param {string} entityFolder
 * @returns {Promise<string | null>}
 */
export async function resolvePreviewFile(entityFolder) {
  const folder = normalizeEntityFolderPath(entityFolder);
  if (!folder) return null;
  if (isConcreteMediaKey(entityFolder)) {
    return String(entityFolder).replace(/^\//, "");
  }
  return discoverInFolder(folder, AUDIO_EXTENSIONS, "preview");
}

/**
 * Resolve artwork image inside entity folder.
 * @param {string} entityFolder
 * @returns {Promise<string | null>}
 */
export async function resolveArtworkFile(entityFolder) {
  const folder = normalizeEntityFolderPath(entityFolder);
  if (!folder) return null;
  if (isConcreteMediaKey(entityFolder)) {
    return String(entityFolder).replace(/^\//, "");
  }
  return discoverInFolder(folder, ARTWORK_EXTENSIONS, "artwork");
}

/**
 * Resolve motion loop video inside entity folder.
 * @param {string} entityFolder
 * @returns {Promise<string | null>}
 */
export async function resolveVideoFile(entityFolder) {
  const folder = normalizeEntityFolderPath(entityFolder);
  if (!folder) return null;
  if (isConcreteMediaKey(entityFolder)) {
    return String(entityFolder).replace(/^\//, "");
  }
  return discoverInFolder(folder, VIDEO_EXTENSIONS, "video");
}

/**
 * Resolve waveform data file inside entity folder (optional — never blocks playback).
 * @param {string} entityFolder
 * @returns {Promise<string | null>}
 */
export async function resolveWaveformFile(entityFolder) {
  const folder = normalizeEntityFolderPath(entityFolder);
  if (!folder) return null;
  return discoverInFolder(folder, WAVEFORM_EXTENSIONS, "waveform");
}

/**
 * Try canonical folder discovery first, then a legacy flat file key.
 * @param {string} canonicalFolder
 * @param {string | null | undefined} legacyKey
 * @param {(folder: string) => Promise<string | null>} resolver
 */
export async function resolveWithLegacyFallback(canonicalFolder, legacyKey, resolver) {
  const discovered = await resolver(canonicalFolder);
  if (discovered) return { key: discovered, source: "canonical_folder" };

  const candidates = Array.isArray(legacyKey)
    ? legacyKey
    : legacyKey
      ? [legacyKey]
      : [];
  for (const raw of candidates) {
    const legacy = String(raw || "").replace(/^\//, "");
    if (!legacy || !isConcreteMediaKey(legacy)) continue;
    if (await headR2ObjectKey(legacy)) {
      return { key: legacy, source: "legacy_flat" };
    }
  }

  return { key: null, source: "missing" };
}

/** List object keys directly under entity folder (for diagnostics; non-recursive). */
export async function listEntityFolderObjects(entityFolder) {
  const folder = normalizeEntityFolderPath(entityFolder);
  if (!folder) return [];
  const objects = await listR2Objects(folder, { recursive: false });
  return objects.map((item) => item.Key).filter(Boolean);
}

/** Clear in-memory discovery cache (tests / hot reload). */
export function clearEntityResolverCache() {
  discoveryCache.clear();
  discoveryInflight.clear();
}

/** @alias clearEntityResolverCache — plural form for centralized invalidation. */
export const clearEntityResolverCaches = clearEntityResolverCache;

/**
 * Resolve a registered stream object key when it exists in R2.
 * Returns null on missing/invalid keys — never throws.
 *
 * @param {string | null | undefined} streamKey
 * @returns {Promise<string | null>}
 */
export async function resolveStreamAssetKey(streamKey) {
  const key = String(streamKey || "").replace(/^\//, "").trim();
  if (!key || key.endsWith("/")) return null;
  try {
    if (await headR2ObjectKey(key)) return key;
  } catch {
    /* master fallback — stream miss must not interrupt playback */
  }
  return null;
}

/** @alias resolveAudioFile */
export const resolveAudio = resolveAudioFile;

/** @alias resolveArtworkFile */
export const resolveArtwork = resolveArtworkFile;

/** @alias resolveVideoFile */
export const resolveVideo = resolveVideoFile;

/** @alias resolveWaveformFile */
export const resolveWaveform = resolveWaveformFile;

/**
 * Resolve preview audio in entity folder, then optional legacy flat key.
 * @param {string} entityFolder
 * @param {string | null | undefined} [legacyFallback]
 * @returns {Promise<string | null>}
 */
export async function resolvePreview(entityFolder, legacyFallback) {
  const { key } = await resolveWithLegacyFallback(
    normalizeEntityFolderPath(entityFolder),
    legacyFallback,
    resolvePreviewFile
  );
  return key;
}

/**
 * Video-first visual media with image fallback (never returns before both are tried).
 * @param {ReleaseCategory | string} releaseType
 * @param {string} slug
 * @param {string} [trackSlug]
 * @param {{ albumSlug?: string, legacyVideo?: string, legacyImage?: string, videoFolder?: string, imageFolder?: string }} [options]
 * @returns {Promise<{ type: 'video' | 'image', url: string | null, key: string | null, source?: string }>}
 */
export async function resolveVisualMedia(releaseType, slug, trackSlug, options = {}) {
  const { albumSlug, legacyVideo, legacyImage, videoFolder, imageFolder } = options;
  const normalizedType = normalizeReleaseType(releaseType);
  if (!normalizedType) {
    return { type: "image", key: null, url: getArtworkPlaceholderUrl("single", slug || "placeholder"), source: "placeholder" };
  }

  // Canonical fast-path: known releases have deterministic R2 keys — zero ListObjectsV2 calls.
  // Falls through to discovery only when slug is unknown or no concrete key is derivable.
  if (slug && !trackSlug && !videoFolder && !imageFolder) {
    const canonical = getCanonicalReleaseBySlug(slug);
    if (canonical) {
      const rType = normalizeReleaseType(canonical.release_type || "single") || normalizedType;
      // Build the expected nested video key from legacy stem or explicit video field.
      const legacyVideoKey = canonical.legacy_video_stem
        ? `videos/${rType}/${canonical.slug}/${canonical.legacy_video_stem}.mp4`
        : canonical.video
          ? String(canonical.video).replace(/^\//, "")
          : null;
      if (legacyVideoKey) {
        const concreteKey = resolveConcreteVideoR2Key({ videoPath: legacyVideoKey, slug: canonical.slug });
        if (concreteKey) {
          const url = getPublicR2Url(concreteKey);
          if (url) return { type: "video", key: concreteKey, url, source: "canonical_direct" };
        }
      }
      // No video for this release — resolve cover image.
      // If legacy_cover (a public/ path) is set, use it directly — the JPEG has not yet been
      // uploaded to R2 at the entity-folder key. Once uploaded, remove legacy_cover from the
      // catalog entry and R2 takes over via legacy_cover_stem.
      if (canonical.legacy_cover) {
        const publicUrl = String(canonical.legacy_cover).startsWith("/")
          ? canonical.legacy_cover
          : `/${canonical.legacy_cover}`;
        return { type: "image", key: null, url: publicUrl, source: "canonical_public_fallback" };
      }
      if (canonical.legacy_cover_stem) {
        const imageKey = `images/${rType}/${canonical.slug}/${canonical.legacy_cover_stem}.jpeg`;
        const url = getPublicR2Url(imageKey);
        if (url) return { type: "image", key: imageKey, url, source: "canonical_direct" };
      }
      // Slug is known but has no concrete keys derivable — fall through to discovery.
    }
  }

  const videoEntity =
    normalizeEntityFolderPath(videoFolder) ||
    resolveVideoPath(normalizedType, slug, trackSlug, albumSlug);
  const imageEntity =
    normalizeEntityFolderPath(imageFolder) ||
    resolveArtworkPath(normalizedType, slug, trackSlug, albumSlug);

  const videoResult = await resolveWithLegacyFallback(
    videoEntity,
    legacyVideo,
    resolveVideoFile
  );
  if (videoResult.key) {
    return {
      type: "video",
      key: videoResult.key,
      url: getPublicR2Url(videoResult.key),
      source: videoResult.source,
    };
  }

  const imageResult = await resolveWithLegacyFallback(
    imageEntity,
    legacyImage,
    resolveArtworkFile
  );
  if (imageResult.key) {
    return {
      type: "image",
      key: imageResult.key,
      url: getPublicR2Url(imageResult.key),
      source: imageResult.source,
    };
  }

  const placeholderUrl =
    catalogCoverUrl(getArtworkPlaceholderUrl(normalizedType, slug).replace(/^\//, "")) ||
    getArtworkPlaceholderUrl(normalizedType, slug);
  return { type: "image", key: null, url: placeholderUrl, source: "placeholder" };
}
