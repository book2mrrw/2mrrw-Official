import { mergeCanonicalMetadata } from "@/lib/media/canonical-catalog";
import {
  catalogCoverUrl,
  catalogMotionVideoUrl,
  catalogPreviewAudioUrl,
  catalogPublicMediaUrl,
  catalogVisualMediaUrl,
} from "@/lib/media-urls";

/** Resolve storefront catalog media to R2 public URLs when configured. */
export function withR2CatalogMedia(item) {
  if (!item) return item;
  const next = mergeCanonicalMetadata({ ...item });
  if (next.visual) next.visual = catalogVisualMediaUrl(String(next.visual).replace(/^\//, ""));
  if (next.cover) {
    const coverRaw = next.visual || next.cover;
    next.cover = next.visual
      ? catalogVisualMediaUrl(String(coverRaw).replace(/^\//, ""))
      : catalogCoverUrl(String(next.cover).replace(/^\//, ""));
  }
  if (next.video) next.video = catalogMotionVideoUrl(String(next.video).replace(/^\//, ""));
  if (next.preview) next.preview = catalogPreviewAudioUrl(String(next.preview).replace(/^\//, ""));
  if (next.csAudio) next.csAudio = catalogPublicMediaUrl(String(next.csAudio).replace(/^\//, ""));
  if (next.csCover) next.csCover = catalogCoverUrl(String(next.csCover).replace(/^\//, ""));
  if (!next.coverArtType) next.coverArtType = next.video ? "video" : "image";
  return next;
}
