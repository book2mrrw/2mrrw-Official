import { mergeCanonicalMetadata } from "@/lib/media/canonical-catalog";
import { isSiteApiMediaPath } from "@/lib/media/site-api-url";
import {
  catalogCoverUrl,
  catalogMotionVideoUrl,
  catalogPreviewAudioUrl,
  catalogPublicMediaUrl,
  catalogVisualMediaUrl,
} from "@/lib/media-urls";

const catalogMediaStableCache = new Map();

/** Stable signature for cover/video/visual/preview — used to skip redundant state updates. */
export function catalogMediaSignature(item) {
  if (!item) return "";
  return [item.slug, item.cover, item.video, item.visual, item.preview].join("\0");
}

export function catalogSinglesMediaEqual(a, b) {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  return left.every((item, i) => catalogMediaSignature(item) === catalogMediaSignature(right[i]));
}

function isResolvedCatalogMediaUrl(url) {
  const s = String(url || "").trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  return isSiteApiMediaPath(s);
}

/** Legacy storefront static paths served from same origin before CDN rewrite. */
export function isStorefrontInlineMediaPath(url) {
  const s = String(url || "").trim();
  if (!s) return false;
  return /^\/(images|videos|audio)\//.test(s) || /^(images|videos|audio)\//.test(s);
}

/**
 * Merge API track onto inline fallback — preserve inline cover/video when API fields are empty
 * or when inline already has a working storefront path (Phase 20D / 20G).
 */
export function mergeCatalogTrackWithInline(inline, api) {
  if (!inline) return api;
  if (!api) return inline;
  const pickMedia = (apiVal, inlineVal) => {
    if (!apiVal) return inlineVal;
    if (!inlineVal) return apiVal;
    if (isStorefrontInlineMediaPath(inlineVal) && !isStorefrontInlineMediaPath(apiVal)) {
      return inlineVal;
    }
    if (isResolvedCatalogMediaUrl(inlineVal) && !isResolvedCatalogMediaUrl(apiVal)) {
      return inlineVal;
    }
    return apiVal;
  };
  return {
    ...inline,
    ...api,
    preview: api.preview || inline.preview,
    video: pickMedia(api.video, inline.video),
    cover: pickMedia(api.cover, inline.cover),
    visual: pickMedia(api.visual, inline.visual),
  };
}

function resolveCatalogMediaField(value, resolver) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (isResolvedCatalogMediaUrl(raw)) return raw;
  return resolver(String(raw).replace(/^\//, ""));
}

/** Resolve storefront catalog media to R2 public URLs when configured (idempotent). */
export function withR2CatalogMedia(item) {
  if (!item) return item;
  const slug = item.slug;
  const sig = catalogMediaSignature(item);
  if (slug) {
    const cached = catalogMediaStableCache.get(slug);
    if (cached?.sig === sig) return cached.value;
  }

  const next = mergeCanonicalMetadata({ ...item });
  if (next.visual) {
    next.visual = resolveCatalogMediaField(next.visual, catalogVisualMediaUrl);
  }
  if (next.cover) {
    const coverRaw = next.visual || next.cover;
    next.cover = next.visual
      ? resolveCatalogMediaField(coverRaw, catalogVisualMediaUrl)
      : resolveCatalogMediaField(next.cover, catalogCoverUrl);
  }
  if (next.video) {
    const videoRaw = String(next.video || "").trim();
    if (isResolvedCatalogMediaUrl(videoRaw)) {
      next.video = videoRaw;
    } else {
      next.video = catalogMotionVideoUrl(videoRaw.replace(/^\//, ""), {
        slug: next.slug,
        legacyKey: next.video_legacy,
      });
    }
  }
  if (next.preview) {
    next.preview = resolveCatalogMediaField(next.preview, catalogPreviewAudioUrl);
  }
  if (next.csAudio) {
    next.csAudio = resolveCatalogMediaField(next.csAudio, catalogPublicMediaUrl);
  }
  if (next.csCover) {
    next.csCover = resolveCatalogMediaField(next.csCover, catalogCoverUrl);
  }
  if (!next.coverArtType) next.coverArtType = next.video ? "video" : "image";

  if (slug) catalogMediaStableCache.set(slug, { sig, value: next });
  return next;
}

/** One-pass stable list for catalog surface initial state and page-1 hydration. */
export function stabilizeCatalogMediaList(items) {
  return (Array.isArray(items) ? items : []).map((item) => withR2CatalogMedia(item));
}
