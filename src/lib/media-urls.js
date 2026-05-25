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
  if (/^https?:\/\//i.test(normalized)) return normalized;
  const r2 = getPublicR2Url(normalized);
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
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return toCatalogCdnUrl(normalized);
}

/** Normalize cover_url for display (strip leading slash; prefer R2 public when configured). */
export function catalogCoverUrl(coverUrl) {
  if (!coverUrl) return "";
  const withoutLeading = String(coverUrl).replace(/^\//, "");
  return catalogPublicMediaUrl(withoutLeading) || `/${withoutLeading}`;
}

/** Preview audio: public R2 under previews/ or legacy /audio/previews/. */
export function catalogPreviewAudioUrl(previewPath) {
  if (!previewPath) return "";
  const normalized = String(previewPath).replace(/^\//, "");
  if (normalized.startsWith("audio/previews/")) {
    const r2Path = `previews/${normalized.replace(/^audio\/previews\//, "")}`;
    return toCatalogCdnUrl(r2Path);
  }
  return catalogPublicMediaUrl(normalized);
}

/** Motion loop video for singles. */
export function catalogMotionVideoUrl(videoPath) {
  if (!videoPath) return "";
  const normalized = String(videoPath).replace(/^\//, "");
  if (normalized.startsWith("videos/singles/")) {
    const r2 = getPublicR2Url(normalized);
    if (r2) return r2;
  }
  return catalogPublicMediaUrl(normalized);
}
