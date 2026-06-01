/**
 * Shared concrete preview R2 key resolution — mirrors api/media/preview fast path.
 * Used for direct CDN embed (Phase 5.2.13) and optional API route dedup.
 */

import {
  CANONICAL_FEATURES,
  CANONICAL_SINGLES,
  getCanonicalReleaseBySlug,
} from "@/lib/media/canonical-catalog";
import { extractSlugFromFlatPreviewKey } from "@/lib/media/canonical-paths";
import { isConcreteMediaKey } from "@/lib/media/entity-resolver";

const RELEASE_TYPE_PREVIEW_RE =
  /^previews\/(singles|features|albums|mixtapes-and-eps)\//i;

/** Flat keys like previews/hourglass-preview.mp3 — 404 at CDN; never direct-embed. */
const FLAT_PREVIEW_ROOT_RE = /^previews\/[^/]+-preview\.(wav|mp3|m4a|flac)$/i;

/**
 * Map flat legacy keys (e.g. hourglass-preview.mp3) to canonical release slug (hour-glass).
 * @param {string | null | undefined} previewPath
 * @returns {string | null}
 */
export function resolveCanonicalSlugFromFlatPreviewKey(previewPath) {
  const stem = extractSlugFromFlatPreviewKey(previewPath);
  if (!stem) return null;
  const direct = getCanonicalReleaseBySlug(stem);
  if (direct?.slug) return direct.slug;
  const flatStem = stem.replace(/-/g, "");
  for (const raw of [...CANONICAL_SINGLES, ...CANONICAL_FEATURES]) {
    const legacyStem =
      raw.legacy_preview_stem || String(raw.slug || "").replace(/-/g, "");
    if (legacyStem === stem || legacyStem === flatStem) return raw.slug;
    const legacy = String(raw.preview_legacy || "");
    if (legacy.includes(`/${stem}-preview.`) || legacy.includes(`/${flatStem}-preview.`)) {
      return raw.slug;
    }
  }
  return null;
}

export function slugFromPreviewEntityFolder(entityFolder) {
  return (
    String(entityFolder || "").match(
      /\/(singles|features|albums|mixtapes-and-eps)\/([^/]+)\/?$/
    )?.[2] || null
  );
}

/**
 * @param {string | null | undefined} key
 * @returns {boolean}
 */
export function isEligibleDirectPreviewR2Key(key) {
  const normalized = String(key || "").replace(/^\//, "");
  if (!normalized || !isConcreteMediaKey(normalized)) return false;
  if (!RELEASE_TYPE_PREVIEW_RE.test(normalized)) return false;
  if (FLAT_PREVIEW_ROOT_RE.test(normalized)) return false;
  return true;
}

/**
 * @param {{
 *   entityFolder?: string | null,
 *   legacyKey?: string | null,
 *   slug?: string | null,
 * }} params
 * @returns {string | null} R2 object key (no leading slash)
 */
export function resolveConcretePreviewR2Key({ entityFolder = null, legacyKey = null, slug = null }) {
  const folderSlug = slugFromPreviewEntityFolder(entityFolder);
  const slugResolved = (() => {
    if (folderSlug && getCanonicalReleaseBySlug(folderSlug)) return folderSlug;
    if (slug && getCanonicalReleaseBySlug(slug)) return slug;
    return (
      resolveCanonicalSlugFromFlatPreviewKey(legacyKey) ||
      resolveCanonicalSlugFromFlatPreviewKey(entityFolder) ||
      resolveCanonicalSlugFromFlatPreviewKey(slug) ||
      folderSlug ||
      slug ||
      extractSlugFromFlatPreviewKey(legacyKey) ||
      extractSlugFromFlatPreviewKey(entityFolder)
    );
  })();

  const candidates = [];
  const canonical = slugResolved ? getCanonicalReleaseBySlug(slugResolved) : null;
  if (canonical?.preview_legacy) {
    candidates.push(String(canonical.preview_legacy).replace(/^\//, ""));
  }

  if (legacyKey) {
    const legacy = String(legacyKey).replace(/^\//, "");
    if (isEligibleDirectPreviewR2Key(legacy)) candidates.push(legacy);
  }

  for (const key of [...new Set(candidates.filter(Boolean))]) {
    if (isEligibleDirectPreviewR2Key(key)) return key;
  }
  return null;
}
