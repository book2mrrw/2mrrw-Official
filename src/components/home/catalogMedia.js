import { getArtworkPlaceholderUrl } from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/normalize-release-type";
import { isUpcomingReleaseDate } from "@/lib/media/release-date";
import { withR2CatalogMedia } from "@/lib/media/r2-catalog-media";
import {
  catalogCoverUrl,
  catalogMotionVideoUrl,
  catalogVisualMediaUrl,
} from "@/lib/media-urls";

export { isUpcomingReleaseDate, withR2CatalogMedia };

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
