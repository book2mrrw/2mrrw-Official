/**
 * POST /api/admin/hls/queue
 *
 * Enqueue one or more tracks for HLS transcoding.
 * Admin-only. Body accepts a single track or an array.
 *
 * Body (single):
 *   { slug, trackSlug?, releaseType?, priority? }
 *
 * Body (batch):
 *   { tracks: [{ slug, trackSlug?, releaseType?, priority? }], priority? }
 *
 * The worker (Fly.io hls-transcoder) polls hls_transcode_jobs for pending rows.
 * It resolves the source_key itself using the same resolve-playback-key logic
 * the stream route uses — or it can be provided explicitly to skip that lookup.
 *
 * DELETE /api/admin/hls/queue?jobId=<id>  — cancel a pending/failed job
 */

import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePlaybackKey } from "@/lib/playback/resolve-playback-key";
import { buildHLSPrefix } from "@/lib/hls/derive-key";

const VALID_RELEASE_TYPES = new Set([
  "singles", "albums", "features", "mixtapes-and-eps", "eps",
]);

const VALID_BITRATES = ["320k", "160k", "96k"];

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

async function requireAdmin() {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) return null;
  return user;
}

/**
 * Resolve the R2 source key for a track.
 * If the caller provides it explicitly, skip the DB lookup.
 */
async function resolveSourceKey(admin, slug, trackSlug, sourceKey) {
  if (sourceKey) return sourceKey;
  try {
    const resolved = await resolvePlaybackKey(admin, slug, {
      trackSlug: trackSlug || undefined,
      preferMaster: true, // always use the highest-quality master for transcoding input
    });
    return resolved?.key || null;
  } catch (err) {
    console.error("[admin/hls/queue] resolvePlaybackKey failed", { slug, trackSlug, message: err?.message });
    return null;
  }
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

  const admin = createAdminClient();

  // Normalise to array of track descriptors
  const tracks = Array.isArray(body.tracks)
    ? body.tracks
    : [{ slug: body.slug, trackSlug: body.trackSlug, releaseType: body.releaseType,
         priority: body.priority, sourceKey: body.sourceKey }];

  if (!tracks.length) return json({ error: "No tracks provided" }, 400);
  if (tracks.length > 200) return json({ error: "Max 200 tracks per batch" }, 400);

  const results = [];
  const errors  = [];

  for (const t of tracks) {
    const slug        = String(t.slug || "").trim();
    const trackSlug   = t.trackSlug ? String(t.trackSlug).trim() : null;
    const releaseType = VALID_RELEASE_TYPES.has(t.releaseType) ? t.releaseType : "singles";
    const priority    = Number.isInteger(t.priority) ? Math.max(1, Math.min(10, t.priority)) : 5;
    const bitrates    = Array.isArray(t.bitrates)
      ? t.bitrates.filter((b) => VALID_BITRATES.includes(b))
      : VALID_BITRATES;
    const segmentDuration = Number.isInteger(t.segmentDurationSecs) ? t.segmentDurationSecs : 6;

    if (!slug) {
      errors.push({ slug: t.slug, error: "slug required" });
      continue;
    }

    const sourceKey = await resolveSourceKey(admin, slug, trackSlug, t.sourceKey || null);
    if (!sourceKey) {
      errors.push({ slug, trackSlug, error: "Could not resolve source audio key from R2" });
      continue;
    }

    const hlsPrefix = buildHLSPrefix(slug, trackSlug, releaseType);

    // PostgREST upsert onConflict does not accept SQL expressions (e.g. COALESCE).
    // Use explicit select → insert/update so NULL track_slug is handled correctly
    // via .is("track_slug", null) and all job states are managed precisely.
    let existingQuery = admin
      .from("hls_transcode_jobs")
      .select("id, status")
      .eq("slug", slug);
    existingQuery = trackSlug
      ? existingQuery.eq("track_slug", trackSlug)
      : existingQuery.is("track_slug", null);
    const { data: existing } = await existingQuery.maybeSingle();

    let data, error;

    if (existing) {
      if (existing.status === "pending" || existing.status === "processing") {
        // Already in-flight — return current state, don't reset
        results.push({ slug, trackSlug, jobId: existing.id, status: existing.status });
        continue;
      }
      // Re-queue completed/failed/cancelled jobs with fresh state
      ({ data, error } = await admin
        .from("hls_transcode_jobs")
        .update({
          source_key:            sourceKey,
          hls_prefix:            hlsPrefix,
          release_type:          releaseType,
          status:                "pending",
          priority,
          bitrates,
          segment_duration_secs: segmentDuration,
          attempt_count:         0,
          error_message:         null,
          worker_id:             null,
          queued_by:             user.id,
          started_at:            null,
          completed_at:          null,
        })
        .eq("id", existing.id)
        .select("id, status")
        .single());
    } else {
      ({ data, error } = await admin
        .from("hls_transcode_jobs")
        .insert({
          slug,
          track_slug:            trackSlug,
          release_type:          releaseType,
          source_key:            sourceKey,
          hls_prefix:            hlsPrefix,
          status:                "pending",
          priority,
          bitrates,
          segment_duration_secs: segmentDuration,
          attempt_count:         0,
          error_message:         null,
          worker_id:             null,
          queued_by:             user.id,
          started_at:            null,
          completed_at:          null,
        })
        .select("id, status")
        .single());
    }

    if (error) {
      errors.push({ slug, trackSlug, error: error.message });
    } else {
      results.push({ slug, trackSlug, jobId: data.id, status: data.status });
    }
  }

  return json({
    queued: results.length,
    failed: errors.length,
    jobs:   results,
    errors,
  });
}

export async function DELETE(req) {
  const user = await requireAdmin();
  if (!user) return json({ error: "Forbidden" }, 403);

  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return json({ error: "jobId required" }, 400);

  const admin = createAdminClient();
  const { error } = await admin
    .from("hls_transcode_jobs")
    .update({ status: "cancelled" })
    .eq("id", jobId)
    .in("status", ["pending", "failed"]);

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
