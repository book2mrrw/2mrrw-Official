import {
  ensureRelativeSiteApiPath,
  isSiteApiMediaPath,
  repairMisboundR2ApiUrl,
} from "@/lib/media/site-api-url";
import { previewDiscoveryUrl } from "@/lib/media/canonical-paths";
import { getCanonicalReleaseBySlug, resolveEntityPreviewFolder } from "@/lib/media/canonical-catalog";
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

/** Preview audio: folder discovery API, public R2, or legacy /audio/previews/. */
export function catalogPreviewAudioUrl(previewPath) {
  if (!previewPath) return "";
  const normalized = String(previewPath).replace(/^\//, "");
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (isSiteApiMediaPath(normalized)) {
    return ensureRelativeSiteApiPath(normalized);
  }
  if (normalized.startsWith("audio/previews/")) {
    const flatKey = normalized.replace(/^audio\/previews\//, "");
    const entityFolder = resolveEntityPreviewFolder(flatKey) || resolveEntityPreviewFolder(`previews/${flatKey}`);
    if (entityFolder) {
      const canonical = getCanonicalReleaseBySlug(
        flatKey.match(/^(.+)-preview\.(mp3|wav|m4a|flac)$/i)?.[1] || ""
      );
      return previewDiscoveryUrl(entityFolder, canonical?.preview_legacy || `previews/${flatKey}`);
    }
    return previewDiscoveryUrl(null, `previews/${flatKey}`);
  }
  if (normalized.startsWith("previews/")) {
    const entityFolder = resolveEntityPreviewFolder(normalized);
    if (entityFolder) {
      const canonical = getCanonicalReleaseBySlug(
        normalized.match(/^previews\/(.+)-preview\.(mp3|wav|m4a|flac)$/i)?.[1] || ""
      );
      return previewDiscoveryUrl(
        entityFolder,
        canonical?.preview_legacy || (entityFolder === normalized ? null : normalized)
      );
    }
    return previewDiscoveryUrl(null, normalized);
  }
  const entityFolder = resolveEntityPreviewFolder(normalized);
  if (entityFolder) {
    const canonical = getCanonicalReleaseBySlug(
      normalized.match(/^(.+)-preview\.(mp3|wav|m4a|flac)$/i)?.[1] || ""
    );
    return previewDiscoveryUrl(entityFolder, canonical?.preview_legacy || null);
  }
  return catalogPublicMediaUrl(normalized);
}

/** Motion loop video — folder discovery API or public R2. */
export function catalogMotionVideoUrl(videoPath) {
  if (!videoPath) return "";
  const normalized = String(videoPath).replace(/^\//, "");
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (isSiteApiMediaPath(normalized)) {
    return ensureRelativeSiteApiPath(normalized);
  }
  if (normalized.startsWith("videos/")) {
    const r2 = getPublicR2Url(normalized);
    if (r2) return r2;
  }
  return catalogPublicMediaUrl(normalized);
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
