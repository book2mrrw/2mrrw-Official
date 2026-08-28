/**
 * Supabase client for the HLS transcoder worker.
 * Uses the service_role key — bypasses RLS, full table access.
 */

import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL } = process.env;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
}

export const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function notifyManifestCutover(manifest) {
  const appUrl = process.env.APP_URL;
  const workerToken = process.env.HLS_WORKER_API_TOKEN;
  if (!appUrl || !workerToken) return;

  let lastError = null;
  for (const delayMs of [0, 500, 2_000]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const response = await fetch(`${appUrl}/api/admin/hls/complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${workerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ slug: manifest.slug, trackSlug: manifest.track_slug ?? null }),
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
      lastError = new Error(`cache invalidation returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("cache invalidation failed");
}

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

export async function markJobComplete(job, workerId, manifest) {
  const { data, error } = await db.rpc("hls_commit_transcode_job", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_claim_token: job.claim_token,
    p_generation: job.generation,
    p_manifest: manifest,
  });
  if (error) throw new Error(`hls_commit_transcode_job: ${error.message}`);
  if (!data?.committed) {
    return { committed: false, reason: data?.reason || "superseded" };
  }

  // Notify the web app to invalidate the L1+L2 manifest cache immediately so
  // the next /api/library/hls request serves the real manifest instead of waiting
  // up to 24h for the TTL to expire.
  await notifyManifestCutover(manifest).catch((err) => {
    console.warn("[worker] cache invalidation notify failed", err?.message);
  });

  return data;
}

export async function updatePosterKey(slug, trackSlug, generation, posterKey, status = "ready") {
  let q = db
    .from("hls_manifests")
    .update({ poster_key: posterKey, poster_status: status })
    .eq("slug", slug)
    .eq("active_generation", generation);
  q = trackSlug != null ? q.eq("track_slug", trackSlug) : q.is("track_slug", null);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`updatePosterKey: ${error.message}`);
  return Boolean(data?.length);
}

export async function markJobFailed(job, workerId, errorMessage) {
  const { data, error } = await db.rpc("hls_fail_transcode_job", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_claim_token: job.claim_token,
    p_generation: job.generation,
    p_error_message: errorMessage,
    p_max_attempts: 3,
  });
  if (error) throw new Error(`hls_fail_transcode_job: ${error.message}`);
  return data;
}
