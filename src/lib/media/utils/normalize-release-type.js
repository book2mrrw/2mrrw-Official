import { RELEASE_TYPE_ALIASES, RELEASE_TYPES } from "@/lib/media/constants/release-types";

/**
 * Map catalog / API release_type values to canonical R2 folder segment.
 * @param {string} [input]
 * @returns {'singles'|'features'|'albums'|'mixtapes-and-eps'}
 */
export function normalizeReleaseType(input) {
  const key = String(input ?? "single")
    .trim()
    .toLowerCase();
  if (!key) return "singles";
  const mapped = RELEASE_TYPE_ALIASES[key];
  if (mapped) return mapped;
  if (RELEASE_TYPES.includes(key)) return key;
  return "singles";
}

/** @param {string} [input] */
export function isKnownReleaseType(input) {
  const key = String(input ?? "")
    .trim()
    .toLowerCase();
  if (!key) return false;
  return Boolean(RELEASE_TYPE_ALIASES[key]) || RELEASE_TYPES.includes(key);
}
