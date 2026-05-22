import { getPublicR2Url } from "@/lib/storage/r2";

/**
 * Map legacy public/ paths to R2 public CDN URLs when NEXT_PUBLIC_R2_PUBLIC_URL is set.
 * Falls back to site-relative paths for local dev without R2 public URL.
 */
export function catalogPublicMediaUrl(relativePath) {
  if (!relativePath) return "";
  const normalized = String(relativePath).replace(/^\//, "");
  const r2 = getPublicR2Url(normalized);
  if (r2) return r2;
  return relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
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
    const r2 = getPublicR2Url(r2Path);
    if (r2) return r2;
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
