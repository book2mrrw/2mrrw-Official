import { mergeCanonicalMetadata } from "@/lib/media/canonical-catalog";
import {
  coverDescriptorToLegacyFields,
  resolveCoverDescriptor,
} from "@/lib/media/cover-descriptor";
import { isLegacyPublicMediaPath, isSiteApiMediaPath } from "@/lib/media/site-api-url";
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

/**
 * Legacy storefront static paths served from same origin before CDN rewrite.
 * @deprecated Use isLegacyPublicMediaPath from site-api-url.js directly — kept
 * as a re-export so this module's own call sites below don't need to change.
 */
export const isStorefrontInlineMediaPath = isLegacyPublicMediaPath;

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

  // ── Cover identity: decided once, then derived ────────────────────────────
  //
  // This used to be four fields resolved independently — cover, baseCover,
  // coverArtType and video — each with its own resolver and its own idea of
  // what the release's artwork was. Nothing reconciled them, so they could and
  // did disagree. Every cover defect this week came from that:
  //
  //   - baseCover was derived from `cover` with no check that `cover` was a
  //     still, so a motion release put its .mp4 into <img> and <video poster>
  //   - coverArtType was recomputed from `video` alone, so a track that
  //     inherited only `cover` silently became "image" and the player's
  //     animated-art gate could never pass
  //   - `cover` was overwritten with `visual`, losing the still entirely
  //
  // Now one descriptor decides, and the legacy fields are views over it. A
  // video can no longer reach a still slot, because resolveCoverDescriptor
  // skips any candidate that is not image-safe rather than accepting it.
  //
  // Candidates are listed best-first and resolved with the resolver that
  // matches their kind — stills through catalogCoverUrl, motion through
  // catalogMotionVideoUrl — so the descriptor chooses between already-correct
  // URLs rather than trying to own URL resolution too.
  const resolveMotionCandidate = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (isResolvedCatalogMediaUrl(raw)) return raw;
    return catalogMotionVideoUrl(raw.replace(/^\//, ""), {
      slug: next.slug,
      legacyKey: next.video_legacy,
    });
  };
  const resolveStillCandidate = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    // Pass the value through untouched — resolveCatalogMediaField already
    // strips the leading slash where the resolver needs it. Stripping it here
    // too turns "/images/x.jpg" into the RELATIVE "images/x.jpg", which
    // resolves against whatever route the browser is on.
    return resolveCatalogMediaField(raw, catalogCoverUrl);
  };

  const coverIdentity = resolveCoverDescriptor({
    // baseCover first: it is the field that is meant to be a still. `cover`
    // and legacy_cover are fallbacks for rows that never carried one.
    still: [next.baseCover, next.legacy_cover, next.cover].map(resolveStillCandidate),
    // A concrete video URL beats the discovery endpoint — same asset, one
    // fewer redirect on every play.
    motion: [resolveMotionCandidate(next.video), next.visual],
  });

  const legacy = coverDescriptorToLegacyFields(coverIdentity);
  next.cover = legacy.cover;
  next.baseCover = legacy.baseCover;
  next.video = legacy.video;
  next.coverArtType = legacy.coverArtType;
  next.coverIdentity = coverIdentity;

  if (next.preview) {
    next.preview = resolveCatalogMediaField(next.preview, catalogPreviewAudioUrl);
  }
  if (next.csAudio) {
    next.csAudio = resolveCatalogMediaField(next.csAudio, catalogPublicMediaUrl);
  }
  if (next.csCover) {
    next.csCover = resolveCatalogMediaField(next.csCover, catalogCoverUrl);
  }
  // coverArtType and baseCover are set from the descriptor above — they are no
  // longer recomputed here. Recomputing coverArtType from `video` alone is what
  // let a track that inherited only `cover` become "image", and re-resolving
  // baseCover separately is what let a video URL land in it.

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
