/**
 * Concrete motion-video R2 key resolution — mirrors resolve-concrete-preview-key.js.
 * Flat legacy keys like videos/singles/hourglass.mp4 404 at CDN; entity folder required.
 */

import {
  CANONICAL_ALBUMS,
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

function legacyVideoStemCandidates(raw) {
  const slug = String(raw?.slug || "");
  const stems = [
    raw?.legacy_video_stem,
    raw?.legacy_cover_stem,
    slug.replace(/-/g, ""),
    slug,
  ].filter(Boolean);
  return [...new Set(stems)];
}

function matchFlatVideoStemToRelease(stem, raw) {
  const flatStem = stem.replace(/-/g, "");
  for (const legacyStem of legacyVideoStemCandidates(raw)) {
    const legacyFlat = String(legacyStem).replace(/-/g, "");
    if (legacyStem === stem || legacyFlat === flatStem) return raw.slug;
  }
  const slug = String(raw?.slug || "");
  if (slug === stem || slug.replace(/-/g, "") === flatStem) return raw.slug;
  return null;
}

/**
 * @param {string | null | undefined} videoPath
 * @returns {'singles'|'features'|'albums'|'mixtapes-and-eps'|null}
 */
export function extractReleaseTypeFolderFromFlatVideoKey(videoPath) {
  const normalized = String(videoPath || "").replace(/^\//, "");
  const match = normalized.match(
    /^videos\/(singles|features|albums|mixtapes-and-eps)\/[^/]+\.mp4$/i
  );
  return match?.[1]?.toLowerCase() || null;
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
  const releaseFolder = extractReleaseTypeFolderFromFlatVideoKey(videoPath);
  const catalogEntries = [...CANONICAL_SINGLES, ...CANONICAL_FEATURES, ...CANONICAL_ALBUMS];
  for (const raw of catalogEntries) {
    const releaseType = normalizeReleaseType(raw.release_type || "single");
    if (releaseFolder && releaseType && releaseFolder !== releaseType) continue;
    const matched = matchFlatVideoStemToRelease(stem, raw);
    if (matched) return matched;
  }
  return null;
}

/**
 * Future releases: derive nested R2 key from flat path + slug when canonical row is absent.
 * @param {string | null | undefined} videoPath
 * @param {string | null | undefined} slug
 * @returns {string | null}
 */
export function deriveNestedVideoKeyFromFlatPath(videoPath, slug) {
  const normalized = String(videoPath || "").replace(/^\//, "");
  const releaseSlug = String(slug || "").trim();
  if (!isFlatLegacyVideoKey(normalized) || !releaseSlug) return null;
  const releaseFolder = extractReleaseTypeFolderFromFlatVideoKey(normalized);
  const stem = extractStemFromFlatVideoKey(normalized);
  if (!releaseFolder || !stem) return null;
  return `videos/${releaseFolder}/${releaseSlug}/${stem}.mp4`;
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
    const fromFlat = resolveCanonicalSlugFromFlatVideoKey(normalized);
    if (fromFlat) return fromFlat;
    if (slug && getCanonicalReleaseBySlug(slug)) return slug;
    if (slug) return String(slug).trim();
    return null;
  })();

  const canonical = slugResolved ? getCanonicalReleaseBySlug(slugResolved) : null;
  if (canonical?.slug) {
    const releaseType = normalizeReleaseType(canonical.release_type || "single");
    const stem =
      extractStemFromFlatVideoKey(normalized) ||
      canonical.legacy_video_stem ||
      canonical.legacy_cover_stem ||
      String(canonical.slug).replace(/-/g, "");
    const nested = legacyVideoPublicPath(releaseType, canonical.slug, stem);
    if (nested) return nested.replace(/^\//, "");
  }

  const slugHint = slugResolved || (slug ? String(slug).trim() : "");
  if (slugHint) {
    const derived = deriveNestedVideoKeyFromFlatPath(normalized, slugHint);
    if (derived) return derived;
  }

  return null;
}
