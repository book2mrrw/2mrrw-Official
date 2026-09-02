/**
 * POST /api/admin/media/refresh-track
 *
 * Atomic audio refresh pipeline for a single track.
 * Wires together the four operations that must happen together when audio is
 * replaced in R2 but the user still hears the old version:
 *
 *   1. Cancel any in-flight or queued transcode jobs (prevents race)
 *   2. Delete the hls_manifests row (manifest API returns 404 immediately;
 *      all clients fall back to progressive download)
 *   3. Delete every HLS segment from R2 under the track's hls_prefix
 *   4. Invalidate all playback key caches (in-memory + durable DB)
 *   5. Re-enqueue a fresh transcode job at highest priority (1)
 *
 * Body: { slug: string, trackSlug?: string, releaseType?: string }
 *
 * Admin-only. All five steps are reported individually so callers can
 * diagnose partial failures without re-running the entire pipeline.
 */

import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { invalidateAudioCacheAndRequeueTranscode } from "@/lib/media/audio-cache-refresh";

const VALID_RELEASE_TYPES = new Set([
  "singles", "albums", "features", "mixtapes-and-eps", "eps",
]);

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

async function requireAdmin() {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) return null;
  return user;
}

export async function POST(req) {
  const user = await requireAdmin();
  if (!user) return json({ error: "Forbidden" }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const slug = String(body.slug || "").trim();
  if (!slug) return json({ error: "slug required" }, 400);

  const trackSlug    = body.trackSlug ? String(body.trackSlug).trim() : null;
  const releaseType  = VALID_RELEASE_TYPES.has(body.releaseType)
    ? body.releaseType
    : "singles";

  const admin = getAdminClient();

  const { steps, jobId, hlsPrefix, sourceKeyFound } = await invalidateAudioCacheAndRequeueTranscode({
    admin,
    slug,
    trackSlug,
    releaseType,
    queuedBy: user.id,
  });

  return json({
    slug,
    trackSlug,
    releaseType,
    hlsPrefix,
    steps,
    jobId,
    sourceKeyFound,
  });
}
