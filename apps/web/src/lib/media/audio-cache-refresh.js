/**
 * Shared "audio at this slug/trackSlug changed on disk, make playback catch up"
 * pipeline. Extracted from /api/admin/media/refresh-track so the same proven
 * steps run whether a stale cache is being manually refreshed or a master
 * file was just swapped in place by replace-master-audio.
 *
 * Every step is best-effort/idempotent and reported individually — a partial
 * failure here never blocks the caller's own success response, because the
 * canonical file (and, for callers that pass sourceKey, the pointer column)
 * is already correct by the time this runs. Worst case on a step failure is
 * a stale cache self-healing later (manifest cache TTL, or a cold instance
 * re-discovering the key), not wrong audio playing.
 */

import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { resolvePlaybackKey, clearPersistedPlaybackKey } from "@/lib/playback/resolve-playback-key";
import { clearMediaResolverCaches } from "@/lib/media/cache-invalidation";
import { buildHLSPrefix } from "@/lib/hls/derive-key";
import { r2Client, R2_BUCKET, listR2Objects } from "@/lib/storage/r2";
import { invalidateManifestCache } from "@/lib/server/hls-manifest-cache";

const DEFAULT_BITRATES = ["320k", "160k", "96k"];

/**
 * @param {object} params
 * @param {import('@supabase/supabase-js').SupabaseClient} params.admin
 * @param {string} params.slug
 * @param {string|null} params.trackSlug
 * @param {string} params.releaseType  one of the hls_transcode_jobs release_type values
 * @param {string|null} [params.sourceKey]  the R2 key the fresh transcode should read.
 *   If omitted, resolved live via resolvePlaybackKey(preferMaster:true) — the
 *   refresh-track case, where the caller doesn't already know the current key.
 * @param {string|null} [params.queuedBy]  admin user id, recorded on the requeued job.
 */
export async function invalidateAudioCacheAndRequeueTranscode({
  admin,
  slug,
  trackSlug = null,
  releaseType,
  sourceKey = null,
  queuedBy = null,
}) {
  const steps = {
    jobCancelled: false,
    manifestDeleted: false,
    segmentsDeleted: 0,
    segmentsFailed: 0,
    cacheInvalidated: false,
    jobQueued: false,
  };

  // ── Read manifest to get hls_prefix BEFORE deleting ─────────────────────────
  let manifestQ = admin.from("hls_manifests").select("hls_prefix").eq("slug", slug);
  manifestQ = trackSlug ? manifestQ.eq("track_slug", trackSlug) : manifestQ.is("track_slug", null);
  const { data: manifest } = await manifestQ.maybeSingle();
  const hlsPrefix = manifest?.hls_prefix || buildHLSPrefix(slug, trackSlug, releaseType);

  // ── Cancel any in-flight or queued transcode jobs ───────────────────────────
  let cancelQ = admin
    .from("hls_transcode_jobs")
    .update({ status: "cancelled" })
    .eq("slug", slug)
    .in("status", ["pending", "processing", "failed"]);
  cancelQ = trackSlug ? cancelQ.eq("track_slug", trackSlug) : cancelQ.is("track_slug", null);
  const { error: cancelError } = await cancelQ;
  if (!cancelError) steps.jobCancelled = true;
  else console.warn("[audio-cache-refresh] job cancel failed", { slug, trackSlug, error: cancelError.message });

  // ── Delete hls_manifests row ─────────────────────────────────────────────────
  let delManifestQ = admin.from("hls_manifests").delete().eq("slug", slug);
  delManifestQ = trackSlug ? delManifestQ.eq("track_slug", trackSlug) : delManifestQ.is("track_slug", null);
  const { error: manifestDeleteError } = await delManifestQ;
  if (!manifestDeleteError) {
    steps.manifestDeleted = true;
    await invalidateManifestCache(slug, trackSlug).catch(() => {});
  } else {
    console.warn("[audio-cache-refresh] manifest delete failed", { slug, trackSlug, error: manifestDeleteError.message });
  }

  // ── Delete every R2 HLS segment under hlsPrefix ─────────────────────────────
  if (R2_BUCKET) {
    let objects = [];
    try {
      objects = await listR2Objects(hlsPrefix, { recursive: true });
    } catch (err) {
      console.warn("[audio-cache-refresh] R2 list failed", { hlsPrefix, error: err?.message });
    }
    if (objects.length > 0) {
      const deleteResults = await Promise.allSettled(
        objects.map((obj) => r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: obj.Key })))
      );
      for (const result of deleteResults) {
        if (result.status === "fulfilled") steps.segmentsDeleted++;
        else {
          steps.segmentsFailed++;
          console.warn("[audio-cache-refresh] segment delete failed", { error: result.reason?.message });
        }
      }
    }
  }

  // ── Invalidate all resolver caches ──────────────────────────────────────────
  clearMediaResolverCaches();
  await clearPersistedPlaybackKey(admin, slug, trackSlug);
  steps.cacheInvalidated = true;

  // ── Re-enqueue transcode job at highest priority ────────────────────────────
  let resolvedSourceKey = sourceKey;
  if (!resolvedSourceKey) {
    try {
      const resolved = await resolvePlaybackKey(admin, slug, { trackSlug: trackSlug || undefined, preferMaster: true });
      resolvedSourceKey = resolved?.key || null;
    } catch (err) {
      console.error("[audio-cache-refresh] resolvePlaybackKey failed", { slug, trackSlug, error: err?.message });
    }
  }

  let jobId = null;
  if (resolvedSourceKey) {
    let existingQ = admin.from("hls_transcode_jobs").select("id, status").eq("slug", slug);
    existingQ = trackSlug ? existingQ.eq("track_slug", trackSlug) : existingQ.is("track_slug", null);
    const { data: existingJob } = await existingQ.maybeSingle();

    const jobPayload = {
      source_key: resolvedSourceKey,
      hls_prefix: hlsPrefix,
      release_type: releaseType,
      status: "pending",
      priority: 1,
      bitrates: DEFAULT_BITRATES,
      segment_duration_secs: 6,
      attempt_count: 0,
      error_message: null,
      worker_id: null,
      queued_by: queuedBy,
      started_at: null,
      completed_at: null,
    };

    if (existingJob) {
      const { data: updated, error: updateError } = await admin
        .from("hls_transcode_jobs")
        .update(jobPayload)
        .eq("id", existingJob.id)
        .select("id")
        .single();
      if (updateError) console.error("[audio-cache-refresh] job update failed", { error: updateError.message });
      else jobId = updated?.id || existingJob.id;
    } else {
      const { data: inserted, error: insertError } = await admin
        .from("hls_transcode_jobs")
        .insert({ slug, track_slug: trackSlug, ...jobPayload })
        .select("id")
        .single();
      if (insertError) console.error("[audio-cache-refresh] job insert failed", { error: insertError.message });
      else jobId = inserted?.id || null;
    }
    if (jobId) steps.jobQueued = true;
  }

  return { steps, jobId, hlsPrefix, sourceKeyFound: Boolean(resolvedSourceKey) };
}
