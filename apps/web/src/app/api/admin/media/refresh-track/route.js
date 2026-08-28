/**
 * POST /api/admin/media/refresh-track
 *
 * Starts a zero-downtime HLS replacement. The active manifest and its segments
 * remain untouched while the worker writes an immutable generation. Completion
 * atomically promotes that generation; retired bytes are deleted after grace.
 */

import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  resolvePlaybackKey,
  clearPersistedPlaybackKey,
} from "@/lib/playback/resolve-playback-key";
import { clearMediaResolverCaches } from "@/lib/media/cache-invalidation";
import { enqueueHlsTranscodeJob } from "@/lib/hls/transcode-queue";

const VALID_RELEASE_TYPES = new Set([
  "singles", "albums", "features", "mixtapes-and-eps", "eps",
]);

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}
export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) return json({ error: "Forbidden" }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const slug = String(body.slug || "").trim();
  if (!slug) return json({ error: "slug required" }, 400);

  const trackSlug = body.trackSlug ? String(body.trackSlug).trim() : null;
  const releaseType = VALID_RELEASE_TYPES.has(body.releaseType)
    ? body.releaseType
    : "singles";
  const admin = getAdminClient();

  // The progressive source may have changed. Keep the active HLS manifest cache
  // valid until the new generation commits and the worker invalidates it.
  clearMediaResolverCaches();
  await clearPersistedPlaybackKey(admin, slug, trackSlug);

  let sourceKey = null;
  try {
    const resolved = await resolvePlaybackKey(admin, slug, {
      trackSlug: trackSlug || undefined,
      preferMaster: true,
    });
    sourceKey = resolved?.key || null;
  } catch (error) {
    console.error("[refresh-track] source resolution failed", {
      slug, trackSlug, error: error?.message,
    });
  }

  if (!sourceKey) {
    return json({
      error: "Could not resolve the current master media object",
      slug,
      trackSlug,
      activeManifestPreserved: true,
    }, 422);
  }

  try {
    const job = await enqueueHlsTranscodeJob(admin, {
      slug,
      trackSlug,
      releaseType,
      sourceKey,
      priority: 1,
      queuedBy: user.id,
      force: true,
    });

    return json({
      slug,
      trackSlug,
      releaseType,
      sourceKeyFound: true,
      activeManifestPreserved: true,
      jobQueued: true,
      jobId: job.id,
      generation: job.generation,
      stagingPrefix: job.hls_prefix,
    });
  } catch (error) {
    console.error("[refresh-track] generation enqueue failed", {
      slug, trackSlug, error: error?.message,
    });
    return json({
      error: error?.message || "HLS refresh enqueue failed",
      slug,
      trackSlug,
      activeManifestPreserved: true,
    }, 500);
  }
}
