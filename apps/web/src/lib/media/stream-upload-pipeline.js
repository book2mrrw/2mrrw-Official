/**
 * Phase 5.2 Stage 3 — Upload pipeline extension: master → AAC stream → R2 + DB registration.
 *
 * Gated by AUTO_GENERATE_STREAM_ASSETS + HYBRID_STREAMING_ENABLED (default OFF).
 * Master ingest succeeds even when stream generation fails — callers must not throw.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { isAutoGenerateStreamAssetsEnabled } from "@/lib/feature-flags";
import { resolveAudioFile } from "@/lib/media/entity-resolver";
import { normalizeStoragePathForStorefront } from "@/lib/sync/normalize-storage-path";
import { headR2ObjectKey } from "@/lib/storage/r2";
import {
  downloadR2ObjectToBuffer,
  uploadR2ObjectBuffer,
  streamObjectContentType,
} from "@/lib/media/r2-object-transfer";
import { registerStreamAsset } from "@/lib/media/stream-registration";
import { normalizeReleaseType } from "@/lib/media/utils/normalize-release-type";
import { STREAM_BITRATE_KBPS } from "@/lib/media/stream-asset-schema";
import {
  isFfmpegAvailable,
  transcodeMasterToStreamFile,
} from "@/lib/media/stream-transcode";

/**
 * @param {{
 *   metadata?: Record<string, unknown>,
 *   product_type?: string,
 * }} row
 * @returns {string | null}
 */
export function resolveReleaseTypeFromCatalogRow(row) {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const candidate = meta.release_type || row.product_type || null;
  return candidate ? normalizeReleaseType(String(candidate)) : null;
}

/**
 * @param {string | null | undefined} storagePath
 * @returns {Promise<string | null>}
 */
export async function resolveMasterR2Key(storagePath) {
  const normalized = normalizeStoragePathForStorefront(storagePath);
  if (!normalized) return null;
  return resolveAudioFile(normalized);
}

/**
 * @param {import("@/lib/media/stream-asset-schema").StreamRegistrationMetadata} registration
 * @param {Record<string, unknown>} [existingMetadata]
 */
export function buildStreamMetadataPatch(registration, existingMetadata = {}) {
  return {
    ...existingMetadata,
    stream_path: registration.stream_path,
    stream_key: registration.stream_key,
    stream_path_relative: registration.stream_path_relative,
    stream_asset_role: registration.asset_role,
    stream_format: registration.format,
    stream_container: registration.container,
    stream_quality: registration.quality,
    stream_generated_at: new Date().toISOString(),
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string} slug
 * @param {import("@/lib/media/stream-asset-schema").StreamRegistrationMetadata} registration
 * @param {Record<string, unknown>} [existingMetadata]
 */
export async function persistStreamRegistrationForProduct(admin, slug, registration, existingMetadata = {}) {
  const metadata = buildStreamMetadataPatch(registration, existingMetadata);

  const { error } = await admin
    .from("products")
    .update({
      stream_path: registration.stream_path,
      stream_key: registration.stream_key,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("slug", slug);

  if (error) {
    throw new Error(error.message || "Failed to persist stream registration");
  }
}

/**
 * Persist stream registration on a catalog_tracks row (multi-track releases).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {string} albumSlug
 * @param {string} trackSlug
 * @param {import("@/lib/media/stream-asset-schema").StreamRegistrationMetadata} registration
 */
export async function persistStreamRegistrationForCatalogTrack(admin, albumSlug, trackSlug, registration) {
  const { error } = await admin
    .from("catalog_tracks")
    .update({
      stream_path: registration.stream_path,
      stream_key: registration.stream_key,
      updated_at: new Date().toISOString(),
    })
    .eq("album_slug", albumSlug)
    .eq("slug", trackSlug);

  if (error) {
    throw new Error(error.message || "Failed to persist catalog track stream registration");
  }
}

/**
 * Download master from R2, transcode locally, upload stream object to R2.
 *
 * @param {string} masterKey
 * @param {string} streamKey
 * @param {{ bitrateKbps?: number }} [options]
 */
export async function transcodeAndUploadStreamObject(masterKey, streamKey, options = {}) {
  if (!(await isFfmpegAvailable())) {
    throw new Error("ffmpeg unavailable — set FFMPEG_PATH or install ffmpeg on the host");
  }

  const workId = randomUUID();
  const masterExt = path.extname(masterKey) || ".wav";
  const inputPath = path.join(os.tmpdir(), `2mrrw-master-${workId}${masterExt}`);
  const outputPath = path.join(os.tmpdir(), `2mrrw-stream-${workId}.m4a`);

  try {
    const masterBuffer = await downloadR2ObjectToBuffer(masterKey);
    await fs.writeFile(inputPath, masterBuffer);
    await transcodeMasterToStreamFile(inputPath, outputPath, {
      bitrateKbps: options.bitrateKbps,
    });
    const streamBuffer = await fs.readFile(outputPath);
    await uploadR2ObjectBuffer(streamKey, streamBuffer, streamObjectContentType());
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

/**
 * Generate stream asset after master storage — non-blocking for master ingest.
 *
 * @param {{
 *   adminClient: import("@supabase/supabase-js").SupabaseClient,
 *   slug: string,
 *   storagePath: string | null | undefined,
 *   releaseType: string | null | undefined,
 *   trackSlug?: string,
 *   albumSlug?: string,
 *   metadata?: Record<string, unknown>,
 *   quality?: "standard" | "hq",
 *   force?: boolean,
 * }} input
 * @returns {Promise<{
 *   ok: boolean,
 *   skipped?: boolean,
 *   reason?: string,
 *   stream?: import("@/lib/media/stream-asset-schema").StreamRegistrationMetadata,
 *   masterKey?: string,
 *   error?: string,
 * }>}
 */
export async function generateStreamAssetForCatalogEntity(input) {
  if (!isAutoGenerateStreamAssetsEnabled()) {
    return { ok: true, skipped: true, reason: "auto_generate_disabled" };
  }

  const {
    adminClient,
    slug,
    storagePath,
    releaseType,
    trackSlug,
    albumSlug,
    metadata = {},
    quality = "hq",
    force = false,
  } = input;

  if (!slug || !storagePath) {
    return { ok: true, skipped: true, reason: "missing_slug_or_storage_path" };
  }

  const normalizedReleaseType = releaseType ? normalizeReleaseType(releaseType) : null;
  if (!normalizedReleaseType) {
    return { ok: false, error: "invalid_or_missing_release_type" };
  }

  const registrationResult = registerStreamAsset({
    releaseType: normalizedReleaseType,
    slug,
    trackSlug,
    albumSlug,
    quality,
  });

  if (!registrationResult.ok) {
    return { ok: false, error: registrationResult.errors?.join("; ") || "registration_invalid" };
  }

  if (registrationResult.skipped || !registrationResult.registration) {
    return { ok: true, skipped: true, reason: registrationResult.reason || "registration_skipped" };
  }

  const registration = registrationResult.registration;
  const streamKey = registration.stream_key;

  if (!force && (await headR2ObjectKey(streamKey))) {
    try {
      await persistStreamRegistrationForProduct(adminClient, slug, registration, metadata);
    } catch (err) {
      return { ok: false, error: err?.message || "stream_exists_metadata_failed" };
    }
    return { ok: true, skipped: true, reason: "stream_exists", stream: registration };
  }

  const masterKey = await resolveMasterR2Key(storagePath);
  if (!masterKey) {
    return { ok: false, error: "master_not_found" };
  }

  const bitrateKbps = STREAM_BITRATE_KBPS[quality] ?? STREAM_BITRATE_KBPS.hq;

  try {
    await transcodeAndUploadStreamObject(masterKey, streamKey, { bitrateKbps });
    await persistStreamRegistrationForProduct(adminClient, slug, registration, metadata);
    return { ok: true, stream: registration, masterKey };
  } catch (err) {
    console.error("[stream-upload-pipeline] stream generation failed", {
      slug,
      masterKey,
      streamKey,
      message: err?.message,
    });
    return { ok: false, error: err?.message || "stream_generation_failed", masterKey };
  }
}

/**
 * Post-sync hook for admin catalog ingest — never throws.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} adminClient
 * @param {{
 *   slug: string,
 *   storage_path?: string | null,
 *   product_type?: string,
 *   metadata?: Record<string, unknown>,
 * }} productRow
 */
/**
 * Generate stream asset for a catalog_tracks row (album / mixtape / EP track).
 *
 * @param {{
 *   adminClient: import("@supabase/supabase-js").SupabaseClient,
 *   albumSlug: string,
 *   trackSlug: string,
 *   storagePath: string | null | undefined,
 *   releaseType: string | null | undefined,
 *   quality?: "standard" | "hq",
 *   force?: boolean,
 * }} input
 * @returns {Promise<{
 *   ok: boolean,
 *   skipped?: boolean,
 *   reason?: string,
 *   stream?: import("@/lib/media/stream-asset-schema").StreamRegistrationMetadata,
 *   masterKey?: string,
 *   error?: string,
 * }>}
 */
export async function generateStreamAssetForCatalogTrack(input) {
  if (!isAutoGenerateStreamAssetsEnabled()) {
    return { ok: true, skipped: true, reason: "auto_generate_disabled" };
  }

  const {
    adminClient,
    albumSlug,
    trackSlug,
    storagePath,
    releaseType,
    quality = "hq",
    force = false,
  } = input;

  if (!albumSlug || !trackSlug || !storagePath) {
    return { ok: true, skipped: true, reason: "missing_album_track_or_storage_path" };
  }

  const normalizedReleaseType = releaseType ? normalizeReleaseType(releaseType) : null;
  if (!normalizedReleaseType) {
    return { ok: false, error: "invalid_or_missing_release_type" };
  }

  const registrationResult = registerStreamAsset({
    releaseType: normalizedReleaseType,
    slug: trackSlug,
    trackSlug,
    albumSlug,
    quality,
  });

  if (!registrationResult.ok) {
    return { ok: false, error: registrationResult.errors?.join("; ") || "registration_invalid" };
  }

  if (registrationResult.skipped || !registrationResult.registration) {
    return { ok: true, skipped: true, reason: registrationResult.reason || "registration_skipped" };
  }

  const registration = registrationResult.registration;
  const streamKey = registration.stream_key;

  if (!force && (await headR2ObjectKey(streamKey))) {
    try {
      await persistStreamRegistrationForCatalogTrack(adminClient, albumSlug, trackSlug, registration);
    } catch (err) {
      return { ok: false, error: err?.message || "stream_exists_metadata_failed" };
    }
    return { ok: true, skipped: true, reason: "stream_exists", stream: registration };
  }

  const masterKey = await resolveMasterR2Key(storagePath);
  if (!masterKey) {
    return { ok: false, error: "master_not_found" };
  }

  const bitrateKbps = STREAM_BITRATE_KBPS[quality] ?? STREAM_BITRATE_KBPS.hq;

  try {
    await transcodeAndUploadStreamObject(masterKey, streamKey, { bitrateKbps });
    await persistStreamRegistrationForCatalogTrack(adminClient, albumSlug, trackSlug, registration);
    return { ok: true, stream: registration, masterKey };
  } catch (err) {
    console.error("[stream-upload-pipeline] catalog track stream generation failed", {
      albumSlug,
      trackSlug,
      masterKey,
      streamKey,
      message: err?.message,
    });
    return { ok: false, error: err?.message || "stream_generation_failed", masterKey };
  }
}

export async function maybeGenerateStreamAfterCatalogSync(adminClient, productRow) {
  if (!isAutoGenerateStreamAssetsEnabled()) {
    return { ok: true, skipped: true, reason: "auto_generate_disabled" };
  }

  const releaseType = resolveReleaseTypeFromCatalogRow(productRow);
  const meta =
    productRow.metadata && typeof productRow.metadata === "object" ? productRow.metadata : {};

  return generateStreamAssetForCatalogEntity({
    adminClient,
    slug: productRow.slug,
    storagePath: productRow.storage_path,
    releaseType,
    metadata: meta,
  });
}
