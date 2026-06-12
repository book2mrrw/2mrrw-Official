/**
 * Phase 20H — Media determinism contract.
 *
 * Contract: once media is rendered, identity and resolved URL must never change
 * unless the underlying asset truly changes (signature delta).
 *
 * Builds on Phase 20G idempotent rewrite, per-slug memo, and inline merge.
 */
import {
  catalogMediaSignature,
  catalogSinglesMediaEqual,
  mergeCatalogTrackWithInline,
  withR2CatalogMedia,
} from "@/lib/media/r2-catalog-media";

/** Fields governed by the media identity contract. */
export const MEDIA_CONTRACT_FIELDS = ["cover", "video", "visual", "preview"];

const frozenResolvedBySlug = new Map();

const isDeterminismDebugEnabled = () =>
  process.env.NEXT_PUBLIC_MEDIA_DETERMINISM_DEBUG === "1" ||
  (typeof process !== "undefined" && process.env.NODE_ENV === "development");

function warnDeterminism(message, payload) {
  if (!isDeterminismDebugEnabled()) return;
  console.warn(`[media-determinism] ${message}`, payload);
}

/**
 * Stable identity signature for a catalog track.
 * Identical signature → identical resolved URLs after first hydration.
 */
export function getMediaSignature(track) {
  return catalogMediaSignature(track);
}

/**
 * Pure deterministic resolver — same input always yields same output.
 * Per-slug memo locks URLs after first resolution; no network, no mutation.
 */
export function resolveMedia(track) {
  if (!track) return track;
  const slug = track.slug;
  const sig = getMediaSignature(track);
  if (slug) {
    const frozen = frozenResolvedBySlug.get(slug);
    if (frozen?.sig === sig) return frozen.value;
  }

  const resolved = withR2CatalogMedia(track);
  if (slug) frozenResolvedBySlug.set(slug, { sig, value: resolved });
  return resolved;
}

/**
 * Resolve a single stable display URL for a track media field.
 * @param {object} track
 * @param {{ field?: "cover"|"video"|"visual"|"preview" }} [options]
 */
export function resolveStableMediaUrl(track, options = {}) {
  const resolved = resolveMedia(track);
  const field = options.field || "cover";
  return resolved?.[field] || "";
}

/**
 * Return a shallow-frozen copy with resolved media fields locked.
 */
export function freezeMediaFields(track) {
  if (!track) return track;
  return Object.freeze({ ...resolveMedia(track) });
}

/**
 * Dev invariant: log when signature matches but resolved field values differ.
 */
export function assertMediaInvariant(prev, next, context = {}) {
  if (!prev || !next) return;
  const prevSig = getMediaSignature(prev);
  const nextSig = getMediaSignature(next);
  if (prevSig !== nextSig) return;

  for (const field of MEDIA_CONTRACT_FIELDS) {
    if (prev[field] !== next[field]) {
      warnDeterminism(`Signature unchanged but ${field} changed`, {
        slug: prev.slug || next.slug,
        field,
        prev: prev[field],
        next: next[field],
        ...context,
      });
    }
  }
}

/**
 * Dev invariant: log SSR vs client URL mismatch on first hydration.
 */
export function assertSsrClientParity(ssrTrack, clientTrack, context = {}) {
  if (!ssrTrack || !clientTrack) return;
  for (const field of MEDIA_CONTRACT_FIELDS) {
    if (ssrTrack[field] !== clientTrack[field]) {
      warnDeterminism("SSR/client URL mismatch on first hydration", {
        slug: ssrTrack.slug || clientTrack.slug,
        field,
        ssr: ssrTrack[field],
        client: clientTrack[field],
        ...context,
      });
    }
  }
}

/**
 * Merge incoming API track onto inline/prior — preserve frozen URLs when identity unchanged.
 * Immutable replacement only; no in-place mutation of cover/video/visual/preview.
 */
export function mergeCatalogTrackDeterministic(prevTrack, incomingTrack, inlineFallback) {
  const base = inlineFallback || prevTrack;
  const merged = mergeCatalogTrackWithInline(base, incomingTrack);
  const resolved = resolveMedia(merged);

  if (prevTrack && getMediaSignature(prevTrack) === getMediaSignature(merged)) {
    assertMediaInvariant(prevTrack, resolved, { phase: "mergeCatalogTrackDeterministic" });
    const locked = { ...resolved };
    for (const field of MEDIA_CONTRACT_FIELDS) {
      if (prevTrack[field]) locked[field] = prevTrack[field];
    }
    return locked;
  }

  return resolved;
}

/**
 * Commit catalog singles list — no-op when media signatures unchanged;
 * block silent URL rewrites when identity is stable per slug.
 */
export function commitCatalogSinglesDeterministic(prev, next) {
  if (catalogSinglesMediaEqual(prev, next)) return prev;

  const prevBySlug = new Map((Array.isArray(prev) ? prev : []).map((t) => [t.slug, t]));
  const guarded = (Array.isArray(next) ? next : []).map((track) => {
    if (!track?.slug) return resolveMedia(track);
    const prior = prevBySlug.get(track.slug);
    if (!prior) return resolveMedia(track);
    if (getMediaSignature(prior) === getMediaSignature(track)) {
      assertMediaInvariant(prior, track, { phase: "commitCatalogSinglesDeterministic" });
      const locked = { ...track };
      for (const field of MEDIA_CONTRACT_FIELDS) {
        if (prior[field]) locked[field] = prior[field];
      }
      return locked;
    }
    return resolveMedia(track);
  });

  return catalogSinglesMediaEqual(prev, guarded) ? prev : guarded;
}

/** One-pass stable list — normalize BEFORE render. */
export function stabilizeCatalogMediaDeterministic(items) {
  return (Array.isArray(items) ? items : []).map((item) => resolveMedia(item));
}
