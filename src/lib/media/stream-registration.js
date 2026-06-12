/**
 * Phase 5.2 — Stream asset registration scaffolding (server-side).
 *
 * Path builders live in canonical-paths.js (always available).
 * Registration metadata is emitted only when HYBRID_STREAMING_ENABLED is true.
 * No playback routing, upload transcode, or R2 writes in Stage 2.
 */

import { isHybridStreamingEnabled } from "@/lib/feature-flags";
import {
  resolveStreamKey,
  resolveStreamPath,
  streamPathForProductRow,
} from "@/lib/media/canonical-paths";
import {
  STREAM_ASSET_ROLE,
  STREAM_AUDIO_FORMAT,
  STREAM_CONTAINER_FORMAT,
} from "@/lib/media/stream-asset-schema";
import { validateStreamRegistration } from "@/lib/media/stream-registration-validation";
import { normalizeReleaseType } from "@/lib/media/utils/normalize-release-type";

export { validateStreamRegistration } from "@/lib/media/stream-registration-validation";
export {
  validateStreamSlug,
  validateStreamReleaseType,
  validateStreamPath,
  validateStreamKey,
  validateStreamFormatConstraints,
} from "@/lib/media/stream-registration-validation";
export {
  STREAM_ASSET_ROLE,
  STREAM_AUDIO_FORMAT,
  STREAM_CONTAINER_FORMAT,
  STREAM_QUALITY_TIERS,
  STREAM_METADATA_KEYS,
  STREAM_DB_COLUMNS,
} from "@/lib/media/stream-asset-schema";

/** @typedef {"standard" | "hq"} StreamQualityTier */

/**
 * Build stream registration metadata for a release or track entity.
 * Returns null when hybrid streaming is disabled — inert by default.
 *
 * @param {ReleaseCategory | string} releaseType
 * @param {string} slug — release slug (single/feature/album) or track slug for collections
 * @param {{
 *   trackSlug?: string,
 *   albumSlug?: string,
 *   quality?: StreamQualityTier,
 * }} [options]
 * @returns {import("@/lib/media/stream-asset-schema").StreamRegistrationMetadata | null}
 */
export function buildStreamRegistrationMetadata(releaseType, slug, options = {}) {
  if (!isHybridStreamingEnabled()) return null;

  const validation = validateStreamRegistration({
    releaseType,
    slug,
    ...options,
  });
  if (!validation.valid || !validation.derived) return null;

  const { stream_path, stream_key, quality } = validation.derived;

  return {
    stream_path,
    stream_key,
    stream_path_relative: streamPathForProductRow(stream_path),
    asset_role: STREAM_ASSET_ROLE,
    format: STREAM_AUDIO_FORMAT,
    container: STREAM_CONTAINER_FORMAT,
    quality,
  };
}

/**
 * Register a stream asset for a catalog entity (validation + metadata payload).
 * Inert when HYBRID_STREAMING_ENABLED is false — returns skipped result, no side effects.
 *
 * @param {{
 *   releaseType: ReleaseCategory | string,
 *   slug: string,
 *   trackSlug?: string,
 *   albumSlug?: string,
 *   quality?: StreamQualityTier,
 *   stream_path?: string,
 *   stream_key?: string,
 * }} input
 * @returns {{
 *   ok: boolean,
 *   skipped?: boolean,
 *   reason?: string,
 *   registration?: import("@/lib/media/stream-asset-schema").StreamRegistrationMetadata,
 *   errors?: string[],
 * }}
 */
export function registerStreamAsset(input) {
  const validation = validateStreamRegistration(input);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  if (!isHybridStreamingEnabled()) {
    return {
      ok: true,
      skipped: true,
      reason: "hybrid_streaming_disabled",
    };
  }

  const { stream_path, stream_key, quality } = validation.derived;

  return {
    ok: true,
    registration: {
      stream_path,
      stream_key,
      stream_path_relative: streamPathForProductRow(stream_path),
      asset_role: STREAM_ASSET_ROLE,
      format: STREAM_AUDIO_FORMAT,
      container: STREAM_CONTAINER_FORMAT,
      quality,
    },
  };
}

/**
 * Attach stream registration fields to a catalog row when hybrid streaming is enabled.
 * Returns the input unchanged when flags are OFF.
 *
 * @template T extends Record<string, unknown>
 * @param {T} row
 * @param {ReleaseCategory | string} releaseType
 * @param {string} slug
 * @param {{ trackSlug?: string, albumSlug?: string, quality?: StreamQualityTier }} [options]
 * @returns {T & { stream_path?: string, stream_key?: string, metadata?: Record<string, unknown> }}
 */
export function attachStreamRegistrationToRow(row, releaseType, slug, options = {}) {
  const registration = buildStreamRegistrationMetadata(releaseType, slug, options);
  if (!registration) return row;

  const existingMetadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata
      : {};

  return {
    ...row,
    stream_path: registration.stream_path,
    stream_key: registration.stream_key,
    metadata: {
      ...existingMetadata,
      stream_path: registration.stream_path,
      stream_key: registration.stream_key,
      stream_path_relative: registration.stream_path_relative,
      stream_asset_role: registration.asset_role,
      stream_format: registration.format,
      stream_container: registration.container,
      stream_quality: registration.quality,
    },
  };
}

/**
 * Resolve stream entity folder from a product or track row (convention only).
 * Does not check feature flags — pure path derivation for diagnostics/admin.
 *
 * @param {{
 *   release_type?: string,
 *   product_type?: string,
 *   slug?: string,
 *   album_slug?: string,
 *   metadata?: { release_type?: string },
 * }} row
 * @returns {string}
 */
export function resolveStreamPathFromRow(row) {
  const releaseType =
    row.release_type ||
    row.metadata?.release_type ||
    row.product_type ||
    "single";
  const normalized = normalizeReleaseType(releaseType);
  if (!normalized) return "";

  const albumSlug = row.album_slug || null;
  if (albumSlug) {
    return resolveStreamPath(normalized, row.slug, row.slug, albumSlug);
  }

  return resolveStreamPath(normalized, row.slug);
}

/**
 * Derive canonical stream key from a row without feature-flag gating.
 *
 * @param {{
 *   release_type?: string,
 *   product_type?: string,
 *   slug?: string,
 *   album_slug?: string,
 *   metadata?: { release_type?: string, stream_quality?: StreamQualityTier },
 * }} row
 * @param {{ quality?: StreamQualityTier }} [options]
 * @returns {string}
 */
export function resolveStreamKeyFromRow(row, options = {}) {
  const releaseType =
    row.release_type ||
    row.metadata?.release_type ||
    row.product_type ||
    "single";
  const normalized = normalizeReleaseType(releaseType);
  if (!normalized || !row.slug) return "";

  const quality = options.quality ?? row.metadata?.stream_quality ?? "standard";
  const albumSlug = row.album_slug || null;

  if (albumSlug) {
    return resolveStreamKey(normalized, row.slug, row.slug, albumSlug, {
      hq: quality === "hq",
    });
  }

  return resolveStreamKey(normalized, row.slug, undefined, undefined, {
    hq: quality === "hq",
  });
}
