import {
  catalogCoverUrl,
  catalogMotionVideoUrl,
  catalogPreviewAudioUrl,
  catalogPublicMediaUrl,
} from "@/lib/media-urls";

/** Resolve storefront catalog media to R2 public URLs when configured. */
export function withR2CatalogMedia(item) {
  if (!item) return item;
  const next = { ...item };
  if (next.cover) next.cover = catalogCoverUrl(String(next.cover).replace(/^\//, ""));
  if (next.video) next.video = catalogMotionVideoUrl(String(next.video).replace(/^\//, ""));
  if (next.preview) next.preview = catalogPreviewAudioUrl(String(next.preview).replace(/^\//, ""));
  if (next.csAudio) next.csAudio = catalogPublicMediaUrl(String(next.csAudio).replace(/^\//, ""));
  if (next.csCover) next.csCover = catalogCoverUrl(String(next.csCover).replace(/^\//, ""));
  if (!next.coverArtType) next.coverArtType = next.video ? "video" : "image";
  return next;
}

export function catalogCoverDisplay(item) {
  const resolved = withR2CatalogMedia(item);
  const type = resolved.coverArtType || "image";
  const src = type === "video" && resolved.video ? resolved.video : resolved.cover;
  return { src, type };
}

export function isUpcomingReleaseDate(dateStr) {
  if (!dateStr) return false;
  const parsed = Date.parse(dateStr);
  if (!Number.isNaN(parsed)) return parsed > Date.now();
  const yearMatch = String(dateStr).match(/\b(20\d{2})\b/);
  if (!yearMatch) return false;
  return Number(yearMatch[1]) >= new Date().getFullYear();
}
