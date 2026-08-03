/**
 * Phase 5.2 Stage 4 — Stream playback candidate resolution (server-side).
 *
 * Gated by HYBRID_STREAMING_ENABLED + STREAM_PLAYBACK_PREFERRED.
 * Never throws — all failures return { ok: false, fallbackReason } for master fallback.
 */

import { isStreamPlaybackPreferred } from "@/lib/feature-flags";
import { resolveStreamAssetKey } from "@/lib/media/entity-resolver";
import {
  validateStreamKey,
  validateStreamPath,
} from "@/lib/media/stream-registration-validation";

/**
 * Pick stream_path / stream_key from catalog_tracks row or product columns/metadata.
 * Pure — no I/O.
 *
 * @param {Record<string, unknown> | null | undefined} product
 * @param {Record<string, unknown> | null | undefined} trackRow
 * @returns {{ stream_key: string, stream_path: string | null, source: string } | null}
 */
export function pickRegisteredStreamFields(product, trackRow) {
  if (trackRow?.stream_key) {
    return {
      stream_key: String(trackRow.stream_key),
      stream_path: trackRow.stream_path ? String(trackRow.stream_path) : null,
      source: "catalog_tracks",
    };
  }

  const metadata =
    product?.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata)
      ? product.metadata
      : {};

  if (product?.stream_key) {
    return {
      stream_key: String(product.stream_key),
      stream_path: product.stream_path
        ? String(product.stream_path)
        : metadata.stream_path
          ? String(metadata.stream_path)
          : null,
      source: "products",
    };
  }

  if (metadata.stream_key) {
    return {
      stream_key: String(metadata.stream_key),
      stream_path: metadata.stream_path ? String(metadata.stream_path) : null,
      source: "products.metadata",
    };
  }

  return null;
}

/**
 * Validate registered stream fields (path optional when key present).
 *
 * @param {string | null | undefined} streamKey
 * @param {string | null | undefined} streamPath
 * @returns {{ valid: true } | { valid: false, reason: string }}
 */
export function validateRegisteredStreamFields(streamKey, streamPath) {
  const keyCheck = validateStreamKey(streamKey);
  if (!keyCheck.valid) {
    return { valid: false, reason: "invalid_stream_key" };
  }

  if (streamPath) {
    const pathCheck = validateStreamPath(streamPath);
    if (!pathCheck.valid) {
      return { valid: false, reason: "invalid_stream_path" };
    }
  }

  return { valid: true };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} albumSlug
 * @param {string} trackSlug
 */
async function loadTrackStreamFields(admin, albumSlug, trackSlug) {
  const { data, error } = await admin
    .from("catalog_tracks")
    .select("stream_path, stream_key")
    .eq("album_slug", albumSlug)
    .eq("slug", trackSlug)
    .maybeSingle();

  if (error) {
    console.warn("[resolveStreamPlayback] catalog_tracks lookup failed", {
      albumSlug,
      trackSlug,
      message: error.message,
    });
    return null;
  }

  return data;
}

/**
 * Attempt stream playback key resolution. Master fallback on any failure.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {Record<string, unknown>} product
 * @param {string | null} trackSlug
 * @param {{
 *   headCheck?: (key: string) => Promise<string | null>,
 * }} [options]
 * @returns {Promise<
 *   | { ok: true, key: string, streamPath: string | null, source: string }
 *   | { ok: false, fallbackReason: string }
 * >}
 */
export async function tryResolveStreamPlaybackKey(admin, product, trackSlug, options = {}) {
  if (!isStreamPlaybackPreferred()) {
    return { ok: false, fallbackReason: "flags_off" };
  }

  const headCheck = options.headCheck || resolveStreamAssetKey;

  try {
    let trackRow = null;
    if (trackSlug && product?.slug) {
      trackRow = await loadTrackStreamFields(admin, String(product.slug), trackSlug);
    }

    const fields = pickRegisteredStreamFields(product, trackRow);
    if (!fields?.stream_key) {
      return { ok: false, fallbackReason: "no_stream_registration" };
    }

    const validation = validateRegisteredStreamFields(fields.stream_key, fields.stream_path);
    if (!validation.valid) {
      return { ok: false, fallbackReason: validation.reason };
    }

    const key = await headCheck(fields.stream_key);
    if (!key) {
      return { ok: false, fallbackReason: "r2_missing" };
    }

    return {
      ok: true,
      key,
      streamPath: fields.stream_path,
      source: fields.source,
    };
  } catch (err) {
    console.warn("[resolveStreamPlayback] unexpected error — master fallback", {
      slug: product?.slug,
      trackSlug,
      message: err?.message,
    });
    return { ok: false, fallbackReason: "resolver_error" };
  }
}
