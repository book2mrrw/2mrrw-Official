import { mergeCanonicalMetadata } from "@/lib/media/canonical-catalog";
import { isSiteApiMediaPath } from "@/lib/media/site-api-url";
import {
  catalogCoverUrl,
  catalogMotionVideoUrl,
  catalogPreviewAudioUrl,
  catalogPublicMediaUrl,
  catalogVisualMediaUrl,
} from "@/lib/media-urls";

// Bounded LRU-ish cache: evict oldest entries when limit is reached, and
// expire entries after 60 minutes to pick up any metadata updates.
const CATALOG_CACHE_MAX = 300;
const CATALOG_CACHE_TTL_MS = 60 * 60 * 1000;
const catalogMediaStableCache = new Map(); // slug → { sig, value, ts }

/** Stable signature for cover/video/visual/preview — used to skip redundant state updates. */
export function catalogMediaSignature(item) {
  if (!item) return "";
  return [
    item.slug,
    item.cover,
    item.video,
    item.visual,
    item.preview,
    item.artwork_revision || item.artworkRevision,
    item.motion_revision || item.motionRevision,
  ].join("\0");
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
  if (isStorefrontInlineMediaPath(raw)) return raw;
  return resolver(String(raw).replace(/^\//, ""));
}

/** Resolve storefront catalog media to R2 public URLs when configured (idempotent). */
export function withR2CatalogMedia(item) {
  if (!item) return item;
  const slug = item.slug;
  const sig = catalogMediaSignature(item);
  if (slug) {
    const cached = catalogMediaStableCache.get(slug);
    if (cached?.sig === sig && Date.now() - cached.ts < CATALOG_CACHE_TTL_MS) {
      return cached.value;
    }
    if (cached) catalogMediaStableCache.delete(slug); // expired or stale sig
  }

  const next = mergeCanonicalMetadata({ ...item });
  if (next.visual) {
    next.visual = resolveCatalogMediaField(next.visual, catalogVisualMediaUrl);
  }
  // Preserve static image BEFORE cover is overwritten with the visual (video) URL.
  // baseCover is the always-safe static image for <img> tags and system artwork.
  // This must run before the cover field is mutated so we capture the original value.
  if (next.visual && !next.baseCover && next.cover) {
    next.baseCover = resolveCatalogMediaField(next.cover, catalogCoverUrl);
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
  next.coverArtType = next.video ? "video" : (next.coverArtType || "image");
  // Ensure baseCover is always a resolved URL (never a bare relative path used as <img src>).
  if (next.baseCover && !isResolvedCatalogMediaUrl(next.baseCover) && !isStorefrontInlineMediaPath(next.baseCover)) {
    next.baseCover = resolveCatalogMediaField(String(next.baseCover).replace(/^\//, ""), catalogCoverUrl);
  }

  if (slug) {
    if (catalogMediaStableCache.size >= CATALOG_CACHE_MAX) {
      // Evict the oldest 20% to amortize eviction cost across many calls.
      const evictCount = Math.ceil(CATALOG_CACHE_MAX * 0.2);
      const iter = catalogMediaStableCache.keys();
      for (let i = 0; i < evictCount; i++) {
        const k = iter.next().value;
        if (k !== undefined) catalogMediaStableCache.delete(k);
      }
    }
    catalogMediaStableCache.set(slug, { sig, value: next, ts: Date.now() });
  }
  return next;
}

/** One-pass stable list for catalog surface initial state and page-1 hydration. */
export function stabilizeCatalogMediaList(items) {
  return (Array.isArray(items) ? items : []).map((item) => withR2CatalogMedia(item));
}
