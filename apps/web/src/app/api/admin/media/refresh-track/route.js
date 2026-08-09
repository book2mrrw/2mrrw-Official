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
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolvePlaybackKey,
  clearPersistedPlaybackKey,
} from "@/lib/playback/resolve-playback-key";
import { clearMediaResolverCaches } from "@/lib/media/cache-invalidation";
import { buildHLSPrefix } from "@/lib/hls/derive-key";
import { r2Client, R2_BUCKET, listR2Objects } from "@/lib/storage/r2";

const VALID_RELEASE_TYPES = new Set([
  "singles", "albums", "features", "mixtapes-and-eps", "eps",
]);
const DEFAULT_BITRATES = ["320k", "160k", "96k"];

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

async function requireAdmin() {
  const user = await getFanSessionUser();
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

  const admin = createAdminClient();

  const steps = {
    jobCancelled:    false,
    manifestDeleted: false,
    segmentsDeleted: 0,
    segmentsFailed:  0,
    cacheInvalidated: false,
    jobQueued:       false,
  };

  // ── Step 1: Read manifest to get hls_prefix BEFORE deleting ─────────────────
  // If no manifest exists yet (audio never transcoded) we derive the canonical
  // prefix so R2 cleanup still works correctly on a partial transcode.
  let manifestQ = admin
    .from("hls_manifests")
    .select("hls_prefix")
    .eq("slug", slug);
  manifestQ = trackSlug
    ? manifestQ.eq("track_slug", trackSlug)
    : manifestQ.is("track_slug", null);
  const { data: manifest } = await manifestQ.maybeSingle();

  const hlsPrefix = manifest?.hls_prefix || buildHLSPrefix(slug, trackSlug, releaseType);

  // ── Step 2: Cancel any in-flight or queued transcode jobs ───────────────────
  // Includes "processing" — a worker that is mid-transcode will complete but
  // write segments to a prefix we are about to delete. The stale-job rescue
  // cron (/api/cron/hls-stale-jobs) will notice the worker went silent and
  // would re-queue it; cancelling here prevents that second pass.
  let cancelQ = admin
    .from("hls_transcode_jobs")
    .update({ status: "cancelled" })
    .eq("slug", slug)
    .in("status", ["pending", "processing", "failed"]);
  cancelQ = trackSlug
    ? cancelQ.eq("track_slug", trackSlug)
    : cancelQ.is("track_slug", null);
  const { error: cancelError } = await cancelQ;
  if (!cancelError) steps.jobCancelled = true;
  else console.warn("[refresh-track] job cancel failed", { slug, trackSlug, error: cancelError.message });

  // ── Step 3: Delete hls_manifests row ────────────────────────────────────────
  // Once this row is gone, GET /api/library/hls returns 404 and every client
  // falls back to progressive download immediately — no stale HLS served.
  let delManifestQ = admin
    .from("hls_manifests")
    .delete()
    .eq("slug", slug);
  delManifestQ = trackSlug
    ? delManifestQ.eq("track_slug", trackSlug)
    : delManifestQ.is("track_slug", null);
  const { error: manifestDeleteError } = await delManifestQ;
  if (!manifestDeleteError) steps.manifestDeleted = true;
  else console.warn("[refresh-track] manifest delete failed", { slug, trackSlug, error: manifestDeleteError.message });

  // ── Step 4: Delete every R2 HLS segment under hlsPrefix ─────────────────────
  // listR2Objects with recursive:true pages through all segment keys
  // (320k/seg_NNNNN.ts, 160k/…, 96k/…) under the prefix.
  // Promise.allSettled so one failed delete never aborts the rest.
  if (R2_BUCKET) {
    let objects = [];
    try {
      objects = await listR2Objects(hlsPrefix, { recursive: true });
    } catch (err) {
      console.warn("[refresh-track] R2 list failed", { hlsPrefix, error: err?.message });
    }

    if (objects.length > 0) {
      const deleteResults = await Promise.allSettled(
        objects.map((obj) =>
          r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: obj.Key }))
        )
      );
      for (const result of deleteResults) {
        if (result.status === "fulfilled") steps.segmentsDeleted++;
        else {
          steps.segmentsFailed++;
          console.warn("[refresh-track] segment delete failed", { error: result.reason?.message });
        }
      }
    }
  }

  // ── Step 5: Invalidate all resolver caches ───────────────────────────────────
  // clearMediaResolverCaches() wipes: entity-resolver, availability-cache,
  // stream-url-cache, playback-key (in-memory), preview-resolution, canonical-catalog.
  // clearPersistedPlaybackKey() removes the durable DB row so the next cold
  // serverless instance doesn't revive a stale key.
  clearMediaResolverCaches();
  await clearPersistedPlaybackKey(admin, slug, trackSlug);
  steps.cacheInvalidated = true;

  // ── Step 6: Re-enqueue transcode job at highest priority ────────────────────
  // resolvePlaybackKey with preferMaster:true skips the stream/preview fallback
  // chain and returns the raw R2 master key — what the transcoder needs.
  // Cache was just cleared above so this is a guaranteed fresh DB lookup.
  let sourceKey = null;
  try {
    const resolved = await resolvePlaybackKey(admin, slug, {
      trackSlug: trackSlug || undefined,
      preferMaster: true,
    });
    sourceKey = resolved?.key || null;
  } catch (err) {
    console.error("[refresh-track] resolvePlaybackKey failed", {
      slug, trackSlug, error: err?.message,
    });
  }

  let jobId = null;
  if (sourceKey) {
    // PostgREST cannot use SQL expressions in onConflict so we must do
    // an explicit select→update/insert (same pattern as /api/admin/hls/queue).
    let existingQ = admin
      .from("hls_transcode_jobs")
      .select("id, status")
      .eq("slug", slug);
    existingQ = trackSlug
      ? existingQ.eq("track_slug", trackSlug)
      : existingQ.is("track_slug", null);
    const { data: existingJob } = await existingQ.maybeSingle();

    const jobPayload = {
      source_key:            sourceKey,
      hls_prefix:            hlsPrefix,
      release_type:          releaseType,
      status:                "pending",
      priority:              1, // highest — manual refresh overrides queue ordering
      bitrates:              DEFAULT_BITRATES,
      segment_duration_secs: 6,
      attempt_count:         0,
      error_message:         null,
      worker_id:             null,
      queued_by:             user.id,
      started_at:            null,
      completed_at:          null,
    };

    if (existingJob) {
      const { data: updated, error: updateError } = await admin
        .from("hls_transcode_jobs")
        .update(jobPayload)
        .eq("id", existingJob.id)
        .select("id")
        .single();
      if (updateError) {
        console.error("[refresh-track] job update failed", { error: updateError.message });
      } else {
        jobId = updated?.id || existingJob.id;
      }
    } else {
      const { data: inserted, error: insertError } = await admin
        .from("hls_transcode_jobs")
        .insert({ slug, track_slug: trackSlug, ...jobPayload })
        .select("id")
        .single();
      if (insertError) {
        console.error("[refresh-track] job insert failed", { error: insertError.message });
      } else {
        jobId = inserted?.id || null;
      }
    }

    if (jobId) steps.jobQueued = true;
  }

  return json({
    slug,
    trackSlug,
    releaseType,
    hlsPrefix,
    steps,
    jobId,
    sourceKeyFound: Boolean(sourceKey),
  });
}
