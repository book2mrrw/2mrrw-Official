import {
  ensureRelativeSiteApiPath,
  isSiteApiMediaPath,
  repairMisboundR2ApiUrl,
} from "@/lib/media/site-api-url";
import {
  extractSlugFromFlatPreviewKey,
  isEntityPreviewFolderPath,
  previewDiscoveryUrl,
} from "@/lib/media/canonical-paths";
import { getCanonicalReleaseBySlug, resolveEntityPreviewFolder } from "@/lib/media/canonical-catalog";
import { isDirectPreviewCdnEnabled } from "@/lib/feature-flags/direct-preview";
import {
  isEligibleDirectPreviewR2Key,
  resolveCanonicalSlugFromFlatPreviewKey,
  resolveConcretePreviewR2Key,
} from "@/lib/media/resolve-concrete-preview-key";
import { resolveConcreteVideoR2Key } from "@/lib/media/resolve-concrete-video-key";
import { getPublicR2Url } from "@/lib/storage/r2";
import { getPublicCdnBase, R2_PUBLIC_CDN_FALLBACK } from "@/lib/storage/r2-public-cdn";

/** @deprecated Use R2_PUBLIC_CDN_FALLBACK from r2-public-cdn.js */
export const R2_CDN_FALLBACK = R2_PUBLIC_CDN_FALLBACK;

function catalogCdnBase() {
  return getPublicCdnBase();
}

function toCatalogCdnUrl(relativePath) {
  const normalized = String(relativePath || "").replace(/^\//, "");
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) {
    return repairMisboundR2ApiUrl(normalized);
  }
  if (isSiteApiMediaPath(normalized)) {
    return ensureRelativeSiteApiPath(normalized);
  }
  const r2 = getPublicR2Url(normalized);
  if (r2 && isSiteApiMediaPath(r2)) return ensureRelativeSiteApiPath(r2);
  if (r2) return r2;
  return `${catalogCdnBase()}/${normalized}`;
}

/**
 * Map legacy public/ paths to R2 public CDN URLs when NEXT_PUBLIC_R2_PUBLIC_URL is set.
 * Falls back to the production R2 CDN base when env is unset.
 */
export function catalogPublicMediaUrl(relativePath) {
  if (!relativePath) return "";
  const normalized = String(relativePath).replace(/^\//, "");
  if (/^https?:\/\//i.test(normalized)) {
    return repairMisboundR2ApiUrl(normalized);
  }
  if (isSiteApiMediaPath(normalized)) {
    return ensureRelativeSiteApiPath(normalized);
  }
  return toCatalogCdnUrl(normalized);
}

/** Normalize cover_url for display (strip leading slash; prefer R2 public when configured). */
export function catalogCoverUrl(coverUrl) {
  if (!coverUrl) return "";
  const raw = String(coverUrl).trim();
  if (isSiteApiMediaPath(raw)) {
    return ensureRelativeSiteApiPath(raw);
  }
  const withoutLeading = raw.replace(/^\//, "");
  return catalogPublicMediaUrl(withoutLeading) || `/${withoutLeading}`;
}

const FLAT_PREVIEW_FILE_RE = /^(.+)-preview\.(wav|mp3|m4a|flac)$/i;

function flatPreviewLegacyKey(previewPath) {
  const normalized = String(previewPath || "").replace(/^\//, "");
  if (normalized.startsWith("audio/previews/")) {
    return `previews/${normalized.replace(/^audio\/previews\//, "")}`;
  }
  if (normalized.startsWith("previews/") && FLAT_PREVIEW_FILE_RE.test(normalized.replace(/^previews\//, ""))) {
    return normalized;
  }
  if (FLAT_PREVIEW_FILE_RE.test(normalized)) {
    return `previews/${normalized}`;
  }
  return null;
}

function slugFromFlatPreviewPath(previewPath) {
  const flatLegacy = flatPreviewLegacyKey(previewPath);
  if (!flatLegacy) return null;
  return extractSlugFromFlatPreviewKey(flatLegacy);
}

/** Direct public CDN when flag on and a concrete nested preview key exists; else discovery API. */
function resolvePreviewPlaybackUrl(entityFolder, legacyKey, slug) {
  if (isDirectPreviewCdnEnabled()) {
    const key = resolveConcretePreviewR2Key({
      entityFolder,
      legacyKey,
      slug,
    });
    if (key) {
      const url = getPublicR2Url(key);
      if (url && !isSiteApiMediaPath(url)) return url;
    }
  }
  return previewDiscoveryUrl(entityFolder, legacyKey);
}

/** Preview audio: folder discovery API, public R2, or legacy /audio/previews/. */
export function catalogPreviewAudioUrl(previewPath) {
  if (!previewPath) return "";
  const normalized = String(previewPath).replace(/^\//, "");
  if (/^https?:\/\//i.test(normalized)) {
    const repaired = repairMisboundR2ApiUrl(normalized);
    if (isSiteApiMediaPath(repaired)) return ensureRelativeSiteApiPath(repaired);
    const slug = slugFromFlatPreviewPath(normalized);
    if (slug) return catalogPreviewAudioUrl(flatPreviewLegacyKey(normalized) || normalized);
    return repaired;
  }
  if (isSiteApiMediaPath(normalized)) {
    return ensureRelativeSiteApiPath(normalized);
  }
  if (isEntityPreviewFolderPath(normalized)) {
    const slug =
      normalized.match(/\/(singles|features|albums|mixtapes-and-eps)\/([^/]+)\/?$/)?.[2] || "";
    const canonical = getCanonicalReleaseBySlug(slug);
    return resolvePreviewPlaybackUrl(normalized, canonical?.preview_legacy || null, slug);
  }
  const flatLegacy = flatPreviewLegacyKey(normalized);
  const stemSlug = slugFromFlatPreviewPath(normalized);
  const slug =
    (stemSlug && getCanonicalReleaseBySlug(stemSlug) ? stemSlug : null) ||
    resolveCanonicalSlugFromFlatPreviewKey(flatLegacy || normalized) ||
    stemSlug;
  const canonical = slug ? getCanonicalReleaseBySlug(slug) : null;
  const entityFolder =
    resolveEntityPreviewFolder(normalized, slug) || canonical?.preview_path || null;
  if (entityFolder || flatLegacy) {
    const legacyForDiscovery = canonical?.preview_legacy || flatLegacy || null;
    return resolvePreviewPlaybackUrl(entityFolder, legacyForDiscovery, slug);
  }
  if (FLAT_PREVIEW_FILE_RE.test(normalized)) {
    return resolvePreviewPlaybackUrl(null, `previews/${normalized}`, slug);
  }
  if (isDirectPreviewCdnEnabled() && isEligibleDirectPreviewR2Key(normalized)) {
    const url = getPublicR2Url(normalized);
    if (url && !isSiteApiMediaPath(url)) return url;
  }
  return catalogPublicMediaUrl(normalized);
}

/** Motion loop video — folder discovery API or public R2. */
export function catalogMotionVideoUrl(videoPath, options = {}) {
  if (!videoPath) return "";
  const normalized = String(videoPath).replace(/^\//, "");
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (isSiteApiMediaPath(normalized)) {
    return ensureRelativeSiteApiPath(normalized);
  }
  const concrete = resolveConcreteVideoR2Key({
    videoPath: normalized,
    slug: options.slug || null,
    legacyKey: options.legacyKey || null,
  });
  const pathToUse = concrete || normalized;
  if (pathToUse.startsWith("videos/")) {
    const r2 = getPublicR2Url(pathToUse);
    if (r2) return r2;
  }
  return catalogPublicMediaUrl(pathToUse);
}

/** Unified visual (video → image fallback) discovery API. */
export function catalogVisualMediaUrl(visualPath) {
  if (!visualPath) return "";
  const normalized = String(visualPath).replace(/^\//, "");
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (isSiteApiMediaPath(normalized)) {
    return ensureRelativeSiteApiPath(normalized);
  }
  return catalogPublicMediaUrl(normalized);
}
