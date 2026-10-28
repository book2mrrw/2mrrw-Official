/**
 * POST /api/admin/media/refresh-track
 *
 * Queue verified original audio as a replacement generation. Published HLS
 * metadata and segments remain available to existing and new listeners until
 * the worker commits the verified replacement. Conflicting active jobs return
 * 409 rather than being cancelled underneath their current worker.
 *
 * Body: { slug: string, trackSlug?: string, releaseType?: string }
 *
 * Admin-only. Validation and queue outcomes are reported individually.
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

  const result = await invalidateAudioCacheAndRequeueTranscode({
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
    ...result,
  }, result.error ? result.status : 200);
}
