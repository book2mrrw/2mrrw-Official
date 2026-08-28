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

/**
 * Artwork contract for surfaces that intentionally render a still image.
 * Canonical enrichment may promote `cover` to a motion discovery URL; those
 * URLs must never be assigned to an <img>. Prefer the preserved static cover,
 * while retaining the media-aware display as a last-resort fallback.
 */
export function catalogStaticCoverDisplay(item) {
  const resolved = withR2CatalogMedia(item);
  const staticCover = String(resolved?.baseCover || "").trim();
  if (staticCover) {
    const normalized = staticCover.replace(/^\//, "");
    const src = catalogVisualMediaUrl(normalized) || catalogCoverUrl(normalized);
    return {
      src,
      type: "image",
      baseCover: src,
    };
  }

  const fallback = catalogCoverDisplay(resolved);
  return {
    ...fallback,
    baseCover: resolved?.baseCover || null,
  };
}
