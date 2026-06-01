/**
 * Phase 5.2 — Stream asset registration validation (pure functions, no I/O).
 */

import {
  DEFAULT_STREAM_EXT,
  resolveStreamKey,
  resolveStreamPath,
  streamFilenameFromSlug,
} from "@/lib/media/canonical-paths";
import { STREAM_ROOT } from "@/lib/media/constants/storage-domains";
import {
  STREAM_ASSET_ROLE,
  STREAM_AUDIO_FORMAT,
  STREAM_CONTAINER_FORMAT,
  STREAM_QUALITY_TIERS,
} from "@/lib/media/stream-asset-schema";
import {
  isKnownReleaseType,
  normalizeReleaseType,
} from "@/lib/media/utils/normalize-release-type";

/** URL-safe slug segment — matches canonical-paths cleanSegment output. */
const SLUG_SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const STREAM_ENTITY_FOLDER_RE = new RegExp(
  `^${STREAM_ROOT}/(${["singles", "features", "albums", "mixtapes-and-eps"].join("|")})/`
);

const STREAM_KEY_RE = new RegExp(
  `^${STREAM_ROOT}/(?:singles|features|albums|mixtapes-and-eps)/(?:[a-z0-9-]+/)+[a-z0-9-]+(?:_192)?\\.${DEFAULT_STREAM_EXT}$`
);

/**
 * @typedef {{
 *   valid: boolean,
 *   errors: string[],
 * }} StreamValidationResult
 */

/**
 * @param {string | undefined | null} slug
 * @returns {StreamValidationResult}
 */
export function validateStreamSlug(slug) {
  const value = String(slug ?? "").trim();
  if (!value) {
    return { valid: false, errors: ["slug is required"] };
  }
  const normalized = value.toLowerCase().replace(/[''']/g, "");
  if (!SLUG_SEGMENT_RE.test(normalized)) {
    return {
      valid: false,
      errors: ["slug must be lowercase alphanumeric with hyphens only"],
    };
  }
  return { valid: true, errors: [] };
}

/**
 * @param {string | undefined | null} releaseType
 * @returns {StreamValidationResult}
 */
export function validateStreamReleaseType(releaseType) {
  if (!releaseType) {
    return { valid: false, errors: ["release_type is required"] };
  }
  if (!isKnownReleaseType(releaseType)) {
    return { valid: false, errors: [`unknown release_type: ${releaseType}`] };
  }
  return { valid: true, errors: [] };
}

/**
 * @param {string | undefined | null} streamPath — full R2 entity folder (streaming/…/)
 * @returns {StreamValidationResult}
 */
export function validateStreamPath(streamPath) {
  const value = String(streamPath ?? "").replace(/^\//, "").trim();
  if (!value) {
    return { valid: false, errors: ["stream_path is required"] };
  }
  if (!value.endsWith("/")) {
    return { valid: false, errors: ["stream_path must be an entity folder ending with /"] };
  }
  if (!value.startsWith(`${STREAM_ROOT}/`)) {
    return {
      valid: false,
      errors: [`stream_path must start with ${STREAM_ROOT}/`],
    };
  }
  if (!STREAM_ENTITY_FOLDER_RE.test(value)) {
    return {
      valid: false,
      errors: ["stream_path must use a canonical release-type folder segment"],
    };
  }
  const segments = value.replace(/\/$/, "").split("/");
  if (segments.length < 3) {
    return { valid: false, errors: ["stream_path is too shallow for an entity folder"] };
  }
  for (const segment of segments.slice(2)) {
    const check = validateStreamSlug(segment);
    if (!check.valid) {
      return { valid: false, errors: [`invalid path segment "${segment}"`] };
    }
  }
  return { valid: true, errors: [] };
}

/**
 * @param {string | undefined | null} streamKey — full R2 object key
 * @returns {StreamValidationResult}
 */
export function validateStreamKey(streamKey) {
  const value = String(streamKey ?? "").replace(/^\//, "").trim();
  if (!value) {
    return { valid: false, errors: ["stream_key is required"] };
  }
  if (value.endsWith("/")) {
    return { valid: false, errors: ["stream_key must be a file path, not a folder"] };
  }
  if (!STREAM_KEY_RE.test(value)) {
    return {
      valid: false,
      errors: [`stream_key must match streaming/{{releaseType}}/…/{{slug}}[${"_192"}].${DEFAULT_STREAM_EXT}`],
    };
  }
  return { valid: true, errors: [] };
}

/**
 * @param {{
 *   format?: string,
 *   container?: string,
 *   quality?: string,
 * }} [constraints]
 * @returns {StreamValidationResult}
 */
export function validateStreamFormatConstraints(constraints = {}) {
  const errors = [];
  const { format, container, quality } = constraints;

  if (format != null && format !== STREAM_AUDIO_FORMAT) {
    errors.push(`format must be ${STREAM_AUDIO_FORMAT}`);
  }
  if (container != null && container !== STREAM_CONTAINER_FORMAT) {
    errors.push(`container must be ${STREAM_CONTAINER_FORMAT}`);
  }
  if (quality != null && !STREAM_QUALITY_TIERS.includes(quality)) {
    errors.push(`quality must be one of: ${STREAM_QUALITY_TIERS.join(", ")}`);
  }

  return errors.length ? { valid: false, errors } : { valid: true, errors: [] };
}

/**
 * Validate a full registration input and derived paths against canonical conventions.
 *
 * @param {{
 *   releaseType: string,
 *   slug: string,
 *   trackSlug?: string,
 *   albumSlug?: string,
 *   quality?: string,
 *   stream_path?: string,
 *   stream_key?: string,
 * }} input
 * @returns {StreamValidationResult & { derived?: { stream_path: string, stream_key: string } }}
 */
export function validateStreamRegistration(input) {
  const errors = [];
  const releaseType = input.releaseType;
  const slug = input.slug;
  const { trackSlug, albumSlug, quality = "standard" } = input;

  for (const check of [
    validateStreamReleaseType(releaseType),
    validateStreamSlug(slug),
    validateStreamFormatConstraints({ quality }),
  ]) {
    errors.push(...check.errors);
  }

  if (albumSlug) {
    const albumCheck = validateStreamSlug(albumSlug);
    if (!albumCheck.valid) errors.push(...albumCheck.errors.map((e) => `albumSlug: ${e}`));
  }
  if (trackSlug) {
    const trackCheck = validateStreamSlug(trackSlug);
    if (!trackCheck.valid) errors.push(...trackCheck.errors.map((e) => `trackSlug: ${e}`));
  }

  const normalizedType = normalizeReleaseType(releaseType);
  if (!normalizedType) {
    return { valid: false, errors: errors.length ? errors : ["invalid release_type"] };
  }

  const derivedPath = resolveStreamPath(normalizedType, slug, trackSlug, albumSlug);
  const derivedKey = resolveStreamKey(normalizedType, slug, trackSlug, albumSlug, {
    hq: quality === "hq",
  });

  if (!derivedPath) errors.push("could not derive stream_path from release_type and slugs");
  if (!derivedKey) errors.push("could not derive stream_key from release_type and slugs");

  if (derivedPath) {
    errors.push(...validateStreamPath(derivedPath).errors);
  }
  if (derivedKey) {
    errors.push(...validateStreamKey(derivedKey).errors);
  }

  if (input.stream_path) {
    const pathCheck = validateStreamPath(input.stream_path);
    if (!pathCheck.valid) errors.push(...pathCheck.errors);
    else if (derivedPath && input.stream_path !== derivedPath) {
      errors.push("stream_path does not match canonical convention");
    }
  }

  if (input.stream_key) {
    const keyCheck = validateStreamKey(input.stream_key);
    if (!keyCheck.valid) errors.push(...keyCheck.errors);
    else if (derivedKey && input.stream_key !== derivedKey) {
      errors.push("stream_key does not match canonical convention");
    }
  }

  const filenameSlug =
    normalizedType === "albums" || normalizedType === "mixtapes-and-eps"
      ? albumSlug
        ? slug
        : trackSlug || slug
      : slug;
  const expectedFilename = streamFilenameFromSlug(filenameSlug, { hq: quality === "hq" });
  if (derivedKey && expectedFilename && !derivedKey.endsWith(expectedFilename)) {
    errors.push("stream_key filename does not match slug convention");
  }

  if (errors.length) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    derived: {
      stream_path: derivedPath,
      stream_key: derivedKey,
      asset_role: STREAM_ASSET_ROLE,
      format: STREAM_AUDIO_FORMAT,
      container: STREAM_CONTAINER_FORMAT,
      quality,
    },
  };
}
