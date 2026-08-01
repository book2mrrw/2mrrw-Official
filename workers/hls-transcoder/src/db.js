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
  // Upsert the manifest record, then mark the job done — in that order
  const { error: mErr } = await db.from("hls_manifests").upsert(manifest, {
    onConflict: "slug, COALESCE(track_slug, '')",
    ignoreDuplicates: false,
  });
  if (mErr) throw new Error(`upsert manifest: ${mErr.message}`);

  const { error: jErr } = await db
    .from("hls_transcode_jobs")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("id", jobId);
  if (jErr) throw new Error(`markJobComplete: ${jErr.message}`);
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
