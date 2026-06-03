/**
 * Concrete motion-video R2 key resolution — mirrors resolve-concrete-preview-key.js.
 * Flat legacy keys like videos/singles/hourglass.mp4 404 at CDN; entity folder required.
 */

import {
  CANONICAL_FEATURES,
  CANONICAL_SINGLES,
  getCanonicalReleaseBySlug,
} from "@/lib/media/canonical-catalog";
import { legacyVideoPublicPath } from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/utils/normalize-release-type";

const RELEASE_TYPE_VIDEO_RE =
  /^videos\/(singles|features|albums|mixtapes-and-eps)\//i;

/** Flat keys like videos/singles/hourglass.mp4 — missing entity slug folder; 404 at CDN. */
const FLAT_VIDEO_ROOT_RE =
  /^videos\/(singles|features|albums|mixtapes-and-eps)\/[^/]+\.mp4$/i;

const NESTED_VIDEO_RE =
  /^videos\/(singles|features|albums|mixtapes-and-eps)\/[^/]+\/[^/]+\.mp4$/i;

/**
 * @param {string | null | undefined} videoPath
 * @returns {boolean}
 */
export function isFlatLegacyVideoKey(videoPath) {
  const normalized = String(videoPath || "").replace(/^\//, "");
  return Boolean(normalized && FLAT_VIDEO_ROOT_RE.test(normalized));
}

/**
 * @param {string | null | undefined} videoPath
 * @returns {string | null}
 */
export function extractStemFromFlatVideoKey(videoPath) {
  const normalized = String(videoPath || "").replace(/^\//, "");
  const match = normalized.match(
    /^videos\/(?:singles|features|albums|mixtapes-and-eps)\/(.+)\.mp4$/i
  );
  return match?.[1] || null;
}

/**
 * Map flat legacy filename stem (e.g. hourglass) to canonical release slug (hour-glass).
 * @param {string | null | undefined} videoPath
 * @returns {string | null}
 */
export function resolveCanonicalSlugFromFlatVideoKey(videoPath) {
  const stem = extractStemFromFlatVideoKey(videoPath);
  if (!stem) return null;
  const direct = getCanonicalReleaseBySlug(stem);
  if (direct?.slug) return direct.slug;
  const flatStem = stem.replace(/-/g, "");
  for (const raw of [...CANONICAL_SINGLES, ...CANONICAL_FEATURES]) {
    const legacyStem =
      raw.legacy_video_stem || String(raw.slug || "").replace(/-/g, "");
    if (legacyStem === stem || legacyStem === flatStem) return raw.slug;
    if (raw.slug === stem || raw.slug.replace(/-/g, "") === flatStem) return raw.slug;
  }
  return null;
}

/**
 * @param {string | null | undefined} key
 * @returns {boolean}
 */
export function isEligibleDirectVideoR2Key(key) {
  const normalized = String(key || "").replace(/^\//, "");
  if (!normalized || !RELEASE_TYPE_VIDEO_RE.test(normalized)) return false;
  if (FLAT_VIDEO_ROOT_RE.test(normalized)) return false;
  return NESTED_VIDEO_RE.test(normalized);
}

/**
 * @param {{
 *   videoPath?: string | null,
 *   slug?: string | null,
 *   legacyKey?: string | null,
 * }} params
 * @returns {string | null} R2 object key (no leading slash)
 */
export function resolveConcreteVideoR2Key({ videoPath = null, slug = null, legacyKey = null }) {
  const normalized = String(videoPath || "").replace(/^\//, "");
  if (!normalized) return null;

  if (isEligibleDirectVideoR2Key(normalized)) return normalized;

  const legacyNormalized = legacyKey ? String(legacyKey).replace(/^\//, "") : "";
  if (legacyNormalized && isEligibleDirectVideoR2Key(legacyNormalized)) {
    return legacyNormalized;
  }

  if (!isFlatLegacyVideoKey(normalized)) return null;

  const slugResolved = (() => {
    if (slug && getCanonicalReleaseBySlug(slug)) return slug;
    return resolveCanonicalSlugFromFlatVideoKey(normalized);
  })();

  const canonical = slugResolved ? getCanonicalReleaseBySlug(slugResolved) : null;
  if (canonical?.slug) {
    const releaseType = normalizeReleaseType(canonical.release_type || "single");
    const stem =
      extractStemFromFlatVideoKey(normalized) ||
      canonical.legacy_video_stem ||
      String(canonical.slug).replace(/-/g, "");
    const nested = legacyVideoPublicPath(releaseType, canonical.slug, stem);
    if (nested) return nested.replace(/^\//, "");
  }

  return null;
}
