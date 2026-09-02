/**
 * POST /api/admin/hls/complete
 *
 * Called by the Fly.io HLS transcoder worker immediately after it has written
 * the hls_manifests row to Supabase. The sole job of this endpoint is to
 * invalidate the L1+L2 manifest cache so the NEXT /api/library/hls request
 * for this slug hits the DB and serves the real manifest, rather than waiting
 * up to 24 h for the TTL to expire (which would leave clients stuck on
 * progressive download despite a completed transcode).
 *
 * Auth: Bearer token â€” the worker must send the same value that is stored in
 * the HLS_WORKER_API_TOKEN environment variable on both sides. This is
 * service-to-service auth, never exposed to browser clients.
 *
 * Body: { slug: string, trackSlug?: string | null }
 *
 * Response 200: { ok: true, slug, trackSlug }
 * Response 401: missing or wrong token
 * Response 400: missing slug
 * Response 500: cache invalidation failed here (rare) is non-fatal for a master
 *   replacement specifically: promote_audio_master_revision() already clears
 *   playback_key_resolution_cache itself, in the same transaction as the
 *   pointer flip (see 20260902000000_promote_audio_master_revision_clears_playback_cache.sql).
 *   This endpoint is now a second, best-effort pass on top of that, plus the
 *   only thing invalidating the separate HLS manifest cache below, which
 *   still relies on its 24h TTL to self-heal if this call never lands.
 */

import { NextResponse } from "next/server";
import { invalidateManifestCache } from "@/lib/server/hls-manifest-cache";
import { getAdminClient } from "@/lib/supabase/admin";
import { clearPersistedPlaybackKey } from "@/lib/playback/resolve-playback-key";
import { requireServiceCapability, ServiceCapability } from "@/lib/auth/admin-api-guard";
import { revalidateStorefront } from "@/lib/media/revalidate-storefront";

const LOG_PREFIX = "[hls/complete]";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(req) {
  if (!requireServiceCapability(req, ServiceCapability.HLS_COMPLETE).ok) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const slug = String(body.slug || "").trim();
  if (!slug) {
    return json({ error: "slug required" }, 400);
  }

  const trackSlug = body.trackSlug ? String(body.trackSlug).trim() : null;

  try {
    await invalidateManifestCache(slug, trackSlug);
    console.log(`${LOG_PREFIX} manifest cache invalidated`, { slug, trackSlug });

    // Also clear the durable playback key cache so the next play request
    // re-discovers the newly transcoded HLS manifest rather than serving stale
    try {
      const admin = getAdminClient();
      await clearPersistedPlaybackKey(admin, slug, trackSlug ?? null);
      console.log(`${LOG_PREFIX} playback key cache cleared`, { slug, trackSlug });
    } catch (pkErr) {
      console.warn(`${LOG_PREFIX} playback key cache clear failed (non-fatal)`, pkErr?.message);
    }

    if (body.replacementId) {
      // Promotion already committed atomically in Supabase. This invalidates
      // only dependent server projections; it never reloads an open player.
      revalidateStorefront(slug);
    }

    return json({ ok: true, slug, trackSlug, replacementId: body.replacementId || null });
  } catch (err) {
    // Cache invalidation failure is logged but not fatal for a master replacement:
    // promote_audio_master_revision() already cleared playback_key_resolution_cache
    // itself (see 20260902000000_...sql), so playback is correct either way. The
    // manifest cache this endpoint also invalidates still relies on its 24h TTL to
    // self-heal — the worker (workers/hls-transcoder/src/db.js) does NOT retry this
    // call on a non-2xx response, it only logs a warning.
    console.error(`${LOG_PREFIX} cache invalidation failed`, { slug, trackSlug, error: err?.message });
    return json({ error: "Cache invalidation failed", slug, trackSlug }, 500);
  }
}
