/**
 * Phase 5.2 — Stream asset metadata schema (in-code canonical reference).
 *
 * Mirrors additive Supabase columns on products / catalog_tracks and optional
 * media_assets rows (asset_role: stream_audio). Non-destructive — masters unchanged.
 */

import { STREAM_ROOT } from "@/lib/media/constants/storage-domains";
import { RELEASE_TYPES } from "@/lib/media/constants/release-types";
import {
  DEFAULT_STREAM_EXT,
  STREAM_HQ_FILENAME_SUFFIX,
} from "@/lib/media/canonical-paths";

/** @typedef {"standard" | "hq"} StreamQualityTier */

/** @typedef {"stream_audio"} StreamAssetRole */

/** @typedef {"aac-lc"} StreamAudioFormat */

/** @typedef {"m4a"} StreamContainerFormat */

/** Canonical asset role for hybrid stream renditions. */
export const STREAM_ASSET_ROLE = "stream_audio";

/** MVP codec — AAC-LC in MP4 container. */
export const STREAM_AUDIO_FORMAT = "aac-lc";

/** MVP container extension. */
export const STREAM_CONTAINER_FORMAT = "m4a";

/** Allowed quality tiers (bitrate mapping enforced at transcode — Stage 3). */
export const STREAM_QUALITY_TIERS = Object.freeze(["standard", "hq"]);

/** Bitrate targets by tier (kbps) — documentation only until Stage 3 transcode. */
export const STREAM_BITRATE_KBPS = Object.freeze({
  standard: 128,
  hq: 192,
});

/** Loudness target (integrated LUFS) — documentation only until Stage 3. */
export const STREAM_LOUDNESS_LUFS = -14;

/** R2 domain root for stream renditions. */
export { STREAM_ROOT };

/**
 * Product / catalog_tracks column names (additive migration).
 * @type {readonly string[]}
 */
export const STREAM_DB_COLUMNS = Object.freeze(["stream_path", "stream_key"]);

/**
 * JSON metadata keys written by attachStreamRegistrationToRow / admin sync.
 * @type {readonly string[]}
 */
export const STREAM_METADATA_KEYS = Object.freeze([
  "stream_path",
  "stream_key",
  "stream_path_relative",
  "stream_asset_role",
  "stream_format",
  "stream_container",
  "stream_quality",
]);

/**
 * Optional media_assets row shape for Control System / future resolver (Stage 4+).
 * @typedef {{
 *   asset_role: StreamAssetRole,
 *   storage_path: string,
 *   bucket?: string,
 *   format?: StreamAudioFormat,
 *   container?: StreamContainerFormat,
 *   quality?: StreamQualityTier,
 *   metadata?: Record<string, unknown>,
 * }} StreamMediaAssetRow
 */

/**
 * Registration payload emitted by registerStreamAsset / buildStreamRegistrationMetadata.
 * @typedef {{
 *   stream_path: string,
 *   stream_key: string,
 *   stream_path_relative: string,
 *   asset_role: StreamAssetRole,
 *   format: StreamAudioFormat,
 *   container: StreamContainerFormat,
 *   quality: StreamQualityTier,
 * }} StreamRegistrationMetadata
 */

/** Filename suffix for HQ tier — `{slug}_192.m4a`. */
export { DEFAULT_STREAM_EXT, STREAM_HQ_FILENAME_SUFFIX };

/** Canonical release-type folder segments valid under streaming/. */
export { RELEASE_TYPES };
