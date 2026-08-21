/**
 * Supabase client for the HLS transcoder worker.
 * Uses the service_role key — bypasses RLS, full table access.
 */

import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

export const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Claim the next pending job atomically.
 * Uses FOR UPDATE SKIP LOCKED — only one worker claims each row.
 * Returns null when queue is empty.
 */
export async function claimNextJob(workerId) {
  // Supabase JS doesn't expose raw FOR UPDATE SKIP LOCKED — use RPC
  const { data, error } = await db.rpc("hls_claim_next_job", { p_worker_id: workerId });
  if (error) throw new Error(`claimNextJob RPC error: ${error.message}`);
  // PostgreSQL composite NULL serializes as {id: null, ...} in Supabase JS.
  // id is always a non-null UUID when a real job is claimed — null id = empty queue.
  if (!data || (Array.isArray(data) ? data.length === 0 : data.id == null)) return null;
  return Array.isArray(data) ? data[0] : data;
}

export async function markJobProcessing(jobId, workerId) {
  const { error } = await db
    .from("hls_transcode_jobs")
    .update({ status: "processing", worker_id: workerId, started_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(`markJobProcessing: ${error.message}`);
}

export async function markJobComplete(jobId, manifest) {
  // PostgREST's onConflict can't reference expression-based indexes (COALESCE).
  // INSERT first; on unique constraint violation (23505), UPDATE the existing row.
  const { error: insErr } = await db.from("hls_manifests").insert(manifest);

  if (insErr) {
    if (insErr.code === "23505") {
      let updQ = db
        .from("hls_manifests")
        .update({ ...manifest, updated_at: new Date().toISOString() })
        .eq("slug", manifest.slug);
      updQ = manifest.track_slug != null
        ? updQ.eq("track_slug", manifest.track_slug)
        : updQ.is("track_slug", null);
      const { error: updErr } = await updQ;
      if (updErr) throw new Error(`update manifest: ${updErr.message}`);
    } else {
      throw new Error(`insert manifest: ${insErr.message}`);
    }
  }

  const { error: jErr } = await db
    .from("hls_transcode_jobs")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("id", jobId);
  if (jErr) throw new Error(`markJobComplete: ${jErr.message}`);

  // Notify the web app to invalidate the L1+L2 manifest cache immediately so
  // the next /api/library/hls request serves the real manifest instead of waiting
  // up to 24h for the TTL to expire.
  const appUrl = process.env.APP_URL;
  const workerToken = process.env.HLS_WORKER_API_TOKEN;
  if (appUrl && workerToken) {
    fetch(`${appUrl}/api/admin/hls/complete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slug: manifest.slug, trackSlug: manifest.track_slug ?? null }),
    }).catch((err) => console.warn("[worker] cache invalidation notify failed", err?.message));
  }
}

export async function updatePosterKey(slug, trackSlug, posterKey, status = "ready") {
  let q = db
    .from("hls_manifests")
    .update({ poster_key: posterKey, poster_status: status })
    .eq("slug", slug);
  q = trackSlug != null ? q.eq("track_slug", trackSlug) : q.is("track_slug", null);
  const { error } = await q;
  if (error) throw new Error(`updatePosterKey: ${error.message}`);
}

export async function markJobFailed(jobId, errorMessage) {
  const { data: job } = await db
    .from("hls_transcode_jobs")
    .select("attempt_count")
    .eq("id", jobId)
    .single();

  const attemptCount = (job?.attempt_count ?? 0) + 1;
  const maxAttempts  = 3;
  const nextStatus   = attemptCount >= maxAttempts ? "failed" : "pending";

  const { error } = await db
    .from("hls_transcode_jobs")
    .update({
      status:        nextStatus,
      error_message: errorMessage,
      attempt_count: attemptCount,
      worker_id:     null,
      started_at:    null,
      completed_at:  nextStatus === "failed" ? new Date().toISOString() : null,
    })
    .eq("id", jobId);

  if (error) throw new Error(`markJobFailed: ${error.message}`);
}
