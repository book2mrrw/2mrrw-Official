import {
  catalogCoverUrl,
  catalogMotionVideoUrl,
  catalogPreviewAudioUrl,
  catalogPublicMediaUrl,
  catalogVisualMediaUrl,
} from "@/lib/media-urls";
import { getArtworkPlaceholderUrl } from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/normalize-release-type";
import { isUpcomingReleaseDate } from "@/lib/media/release-date";

export { isUpcomingReleaseDate };

/** Resolve storefront catalog media to R2 public URLs when configured. */
export function withR2CatalogMedia(item) {
  if (!item) return item;
  const next = { ...item };
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

export function catalogCoverDisplay(item) {
  const resolved = withR2CatalogMedia(item);
  const type = resolved.coverArtType || (resolved.video ? "video" : "image");
  const visualSrc = resolved.visual || resolved.cover;
  const src =
    type === "video" && (resolved.video || resolved.visual)
      ? catalogMotionVideoUrl(String(resolved.video || resolved.visual).replace(/^\//, ""))
      : catalogVisualMediaUrl(String(visualSrc || "").replace(/^\//, "")) ||
        catalogCoverUrl(String(resolved.cover || "").replace(/^\//, ""));
  if (!src) {
    const releaseType = normalizeReleaseType(
      resolved.release_type || resolved.metadata?.release_category || "single"
    );
    return {
      src: catalogCoverUrl(getArtworkPlaceholderUrl(releaseType, resolved.slug || "placeholder").replace(/^\//, "")),
      type: "image",
    };
  }
  return { src, type };
}
