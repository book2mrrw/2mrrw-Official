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
  const type = resolved.video ? "video" : (resolved.coverArtType || "image");
  const visualSrc = resolved.visual || resolved.cover;
  const src =
    type === "video" && (resolved.video || resolved.visual)
      ? catalogMotionVideoUrl(String(resolved.video || resolved.visual).replace(/^\//, ""), {
          slug: resolved.slug,
          legacyKey: resolved.video_legacy,
        })
      : catalogVisualMediaUrl(String(visualSrc || "").replace(/^\//, "")) ||
        catalogCoverUrl(String(resolved.cover || "").replace(/^\//, ""));
  if (!src) {
    const releaseType = normalizeReleaseType(
      resolved.release_type || resolved.metadata?.release_category
    );
    const placeholderType = releaseType || "single";
    return {
      src: catalogCoverUrl(
        getArtworkPlaceholderUrl(placeholderType, resolved.slug || "placeholder").replace(/^\//, "")
      ),
      type: "image",
    };
  }
  return { src, type };
}
