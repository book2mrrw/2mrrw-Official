/** Canonical R2 key builders — lowercase, URL-safe; paths end at release/track folders (flat media inside). */

import { RELEASE_FOLDER } from "@/lib/media/constants/release-types";
import {
  AUDIO_ROOT,
  IMAGE_ROOT,
  PREVIEW_ROOT,
  VIDEO_ROOT,
} from "@/lib/media/constants/storage-domains";
import { normalizeReleaseType } from "@/lib/media/utils/normalize-release-type";

export { RELEASE_FOLDER };

function releaseFolder(releaseType) {
  return normalizeReleaseType(releaseType);
}

const KNOWN_MEDIA_EXTENSIONS =
  /\.(wav|flac|m4a|mp3|jpg|jpeg|png|webp|mp4|webm|mov)$/i;

/** Wrong nested layout — media files belong directly in entity folders, not under these. */
const WRONG_NESTED_MEDIA_DIR_NAMES = new Set(["audio", "artwork", "video", "videos", "waveform"]);

function cleanSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[''']/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Strip wrong nested media-type dirs (audio/, artwork/, etc.) from DB paths. */
function stripWrongNestedMediaDirs(path) {
  const segments = String(path || "")
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .split("/")
    .filter(Boolean);
  while (
    segments.length > 1 &&
    WRONG_NESTED_MEDIA_DIR_NAMES.has(segments[segments.length - 1].toLowerCase())
  ) {
    segments.pop();
  }
  return segments.join("/");
}

/** Strip trailing filename from a path — entity folder is authoritative. */
export function normalizeToEntityFolder(path) {
  let normalized = String(path || "").replace(/^\//, "").replace(/\/$/, "");
  if (!normalized) return "";
  if (KNOWN_MEDIA_EXTENSIONS.test(normalized)) {
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash >= 0 ? `${normalized.slice(0, lastSlash)}/` : "";
  }
  normalized = stripWrongNestedMediaDirs(normalized);
  return normalized ? `${normalized}/` : "";
}

/**
 * @param {ReleaseCategory | string} releaseType
 * @param {string} releaseSlug
 * @param {string} [trackSlug]
 */
export function resolveStoragePath(releaseType, releaseSlug, trackSlug, albumSlug) {
  const folder = releaseFolder(releaseType);
  const release = cleanSegment(releaseSlug);
  if (!release) return "";

  if (folder === "mixtapes-and-eps" || folder === "albums") {
    const project = cleanSegment(albumSlug || releaseSlug);
    const track = albumSlug ? release : cleanSegment(trackSlug);
    if (track) {
      return `${AUDIO_ROOT}/${folder}/${project}/${track}/`;
    }
    return `${AUDIO_ROOT}/${folder}/${project}/`;
  }

  return `${AUDIO_ROOT}/${folder}/${release}/`;
}

function nestedCollectionFolder(folder, slug, trackSlug, albumSlug) {
  const release = cleanSegment(slug);
  if (!release) return "";
  if (folder === "mixtapes-and-eps" || folder === "albums") {
    const project = cleanSegment(albumSlug || slug);
    const track = albumSlug ? release : cleanSegment(trackSlug);
    if (track) {
      return `${project}/${track}/`;
    }
    return `${project}/`;
  }
  return `${release}/`;
}

/**
 * @param {ReleaseCategory | string} releaseType
 * @param {string} slug — release slug (single/feature) or album slug for collections
 * @param {string} [trackSlug]
 * @param {string} [albumSlug]
 */
export function resolveArtworkPath(releaseType, slug, trackSlug, albumSlug) {
  const folder = releaseFolder(releaseType);
  const nested = nestedCollectionFolder(folder, slug, trackSlug, albumSlug);
  if (!nested) return "";
  return `${IMAGE_ROOT}/${folder}/${nested}`;
}

/**
 * Canonical preview entity folder.
 * @param {ReleaseCategory | string} releaseType
 * @param {string} slug — release slug or track slug for album tracks
 * @param {string} [albumSlug] — required for album track previews
 */
export function resolvePreviewPath(releaseType, slug, albumSlug) {
  const folder = releaseFolder(releaseType);
  const release = cleanSegment(slug);
  if (!release) return "";

  if (folder === "mixtapes-and-eps" || folder === "albums") {
    const project = cleanSegment(albumSlug || slug);
    const track = albumSlug ? release : null;
    if (albumSlug && track) {
      return `${PREVIEW_ROOT}/${folder}/${project}/${track}/`;
    }
    return `${PREVIEW_ROOT}/${folder}/${project}/`;
  }

  return `${PREVIEW_ROOT}/${folder}/${release}/`;
}

/**
 * Motion loop entity folder — videos/{folder}/{slug}/ or nested track path.
 * @param {ReleaseCategory | string} releaseType
 * @param {string} slug
 * @param {string} [trackSlug]
 * @param {string} [albumSlug]
 */
export function resolveVideoPath(releaseType, slug, trackSlug, albumSlug) {
  const folder = releaseFolder(releaseType);
  const nested = nestedCollectionFolder(folder, slug, trackSlug, albumSlug);
  if (!nested) return "";
  return `${VIDEO_ROOT}/${folder}/${nested}`;
}

/** @deprecated Use resolveVideoPath(releaseType, slug) */
export function resolveVideoPathForSingle(slug) {
  return resolveVideoPath("single", slug);
}

/** @deprecated Use resolvePreviewPath(releaseType, slug) — kept for legacy flat keys. */
export function resolveLegacyFlatPreviewPath(slug, ext = "mp3") {
  const safe = cleanSegment(slug);
  if (!safe) return "";
  return `${PREVIEW_ROOT}/${safe}.${ext}`;
}

/** Strip digital-assets/ prefix for normalizePlaybackR2Key compatibility. */
export function storagePathForProductRow(fullPath) {
  let normalized = normalizeToEntityFolder(fullPath).replace(/^\//, "");
  if (normalized.startsWith(`${AUDIO_ROOT}/`)) {
    normalized = normalized.slice(`${AUDIO_ROOT}/`.length);
  }
  return normalized;
}

const DEFAULT_PREVIEW_EXT = {
  singles: "mp3",
  features: "wav",
  albums: "mp3",
  "mixtapes-and-eps": "mp3",
};

const FLAT_PREVIEW_KEY_RE = /^(?:previews\/|audio\/previews\/)?(.+)-preview\.(wav|mp3|m4a|flac)$/i;
const ENTITY_PREVIEW_FOLDER_RE =
  /^previews\/(singles|features|albums|mixtapes-and-eps)\/[^/]+\/?$/;

/** Slug from flat legacy keys like `previews/i-dont-believe-you-preview.wav`. */
export function extractSlugFromFlatPreviewKey(previewPath) {
  const normalized = String(previewPath || "").replace(/^\//, "");
  if (ENTITY_PREVIEW_FOLDER_RE.test(normalized.replace(/\/$/, ""))) return null;
  const match = normalized.match(FLAT_PREVIEW_KEY_RE);
  return match?.[1] || null;
}

/** True when path is already a release-type entity folder (not a flat filename). */
export function isEntityPreviewFolderPath(previewPath) {
  const normalized = String(previewPath || "").replace(/^\//, "").replace(/\/$/, "");
  return ENTITY_PREVIEW_FOLDER_RE.test(`${normalized}/`);
}

/** Legacy public/ path for storefront cover display (resolved via catalogCoverUrl). */
export function legacyCoverPublicPath(releaseType, slug, legacyStem, ext = "jpg") {
  const folder = releaseFolder(releaseType);
  const release = cleanSegment(slug);
  if (!release) return "";
  const stem = cleanSegment(legacyStem || release.replace(/-/g, ""));
  return `/images/${folder}/${release}/${stem}.${ext}`;
}

/** R2 preview legacy key — entity folder `previews/{releaseType}/{releaseSlug}/{stem}-preview.{ext}`. */
export function legacyPreviewPublicPath(releaseType, slug, legacyStem, ext) {
  const folder = releaseFolder(releaseType);
  const release = cleanSegment(slug);
  if (!release) return "";
  const stem = cleanSegment(legacyStem || release.replace(/-/g, ""));
  const resolvedExt = ext ?? DEFAULT_PREVIEW_EXT[folder] ?? "mp3";
  return `${PREVIEW_ROOT}/${folder}/${release}/${stem}-preview.${resolvedExt}`;
}

/** Normalize stored preview keys for CDN fallback. */
export function normalizeLegacyPreviewPath(previewR2Key) {
  const normalized = String(previewR2Key || "").replace(/^\//, "");
  if (normalized.startsWith("audio/previews/")) {
    const flatKey = normalized.replace(/^audio\/previews\//, "");
    return `/previews/${flatKey}`;
  }
  if (normalized.startsWith(`${PREVIEW_ROOT}/`)) {
    return `/${normalized}`;
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

/** Client/API preview resolution URL for folder-based discovery. */
export function previewDiscoveryUrl(previewFolder, legacyKey = null) {
  const folder = normalizeToEntityFolder(previewFolder);
  if (!folder) return legacyKey ? normalizeLegacyPreviewPath(legacyKey) : "";
  const params = new URLSearchParams({ folder });
  if (legacyKey) params.set("legacy", String(legacyKey).replace(/^\//, ""));
  return `/api/media/preview?${params.toString()}`;
}

const ARTWORK_PLACEHOLDER_PUBLIC = "/images/placeholder/artwork.jpg";

/** Public URL for missing cover/loop art — never null. */
export function getArtworkPlaceholderUrl(releaseType = "single", slug = "placeholder") {
  const legacy = legacyCoverPublicPath(releaseType, slug);
  const path = legacy ? legacy.replace(/^\//, "") : ARTWORK_PLACEHOLDER_PUBLIC.replace(/^\//, "");
  return path.startsWith("/") ? path : `/${path}`;
}

/** Legacy motion video public path — entity folder + legacy filename stem. */
export function legacyVideoPublicPath(releaseType, slug, legacyStem, ext = "mp4") {
  const folder = releaseFolder(releaseType);
  const release = cleanSegment(slug);
  if (!release) return "";
  const stem = cleanSegment(legacyStem || release.replace(/-/g, ""));
  return `/videos/${folder}/${release}/${stem}.${ext}`;
}

/** Client/API video resolution URL for folder-based discovery. */
export function videoDiscoveryUrl(videoFolder, legacyPath = null) {
  const folder = normalizeToEntityFolder(videoFolder);
  if (!folder) return legacyPath || "";
  const params = new URLSearchParams({ folder, type: "video" });
  if (legacyPath) params.set("legacy", String(legacyPath).replace(/^\//, ""));
  return `/api/media/preview?${params.toString()}`;
}

/**
 * Unified visual discovery (video → image fallback).
 * @param {ReleaseCategory | string} releaseType
 * @param {string} slug
 * @param {{ trackSlug?: string, albumSlug?: string, legacyVideo?: string, legacyImage?: string }} [options]
 */
export function visualDiscoveryUrl(releaseType, slug, options = {}) {
  const safeType = normalizeReleaseType(releaseType || "single");
  const safeSlug = cleanSegment(slug);
  if (!safeSlug) return "";
  const params = new URLSearchParams({ releaseType: safeType, slug: safeSlug });
  if (options.trackSlug) params.set("trackSlug", cleanSegment(options.trackSlug));
  if (options.albumSlug) params.set("albumSlug", cleanSegment(options.albumSlug));
  if (options.legacyVideo) params.set("legacyVideo", String(options.legacyVideo).replace(/^\//, ""));
  if (options.legacyImage) params.set("legacyImage", String(options.legacyImage).replace(/^\//, ""));
  return `/api/media/visual?${params.toString()}`;
}

/** Visual discovery from a known entity folder (DB video_path / artwork_path). */
export function visualDiscoveryUrlFromFolder(videoFolder, imageFolder, legacy = {}) {
  const video = normalizeToEntityFolder(videoFolder);
  const image = normalizeToEntityFolder(imageFolder);
  if (!video && !image) return "";
  const params = new URLSearchParams();
  if (video) params.set("videoFolder", video);
  if (image) params.set("imageFolder", image);
  if (legacy.legacyVideo) params.set("legacyVideo", String(legacy.legacyVideo).replace(/^\//, ""));
  if (legacy.legacyImage) params.set("legacyImage", String(legacy.legacyImage).replace(/^\//, ""));
  return `/api/media/visual?${params.toString()}`;
}
