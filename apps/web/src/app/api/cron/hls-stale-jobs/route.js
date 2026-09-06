/**
 * GET /api/cron/hls-stale-jobs
 *
 * Rescues HLS transcode jobs stuck in 'processing' with no sign of life.
 * This happens when a worker crashes mid-transcode without releasing its
 * lock. The staleness signal is job_type-aware, not one fixed threshold:
 *
 *   audio — unchanged from before the job_type split: stale if
 *           `started_at` is older than AUDIO_STALE_THRESHOLD_MINUTES.
 *           Audio jobs are short, so a fixed wall-clock age is the right
 *           signal and this behavior is not touched.
 *   video — stale if `heartbeat_at` has gone quiet for longer than
 *           VIDEO_HEARTBEAT_STALE_MINUTES. A long, genuinely healthy video
 *           encode keeps refreshing its heartbeat (see worker-runtime.js)
 *           and is never falsely reclaimed just for taking a while; a
 *           worker that actually died stops refreshing it and is
 *           recovered promptly instead of waiting out a long fixed
 *           timeout sized for encodes, not crashes.
 *
 * Called by Vercel Cron (vercel.json) — must use GET.
 * Protected by CRON_SECRET header check; the header is automatically set by Vercel.
 *
 * Rescue strategy (shared across both types):
 *   attempt_count < MAX_ATTEMPTS  → reset to 'pending'   (worker will re-claim it)
 *   attempt_count >= MAX_ATTEMPTS → escalate to 'failed' (requires manual intervention)
 *
 * vercel.json schedule: every 10 minutes ("star/10 star star star star")
 */

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { emitServerEvent } from "@/lib/observability/server-events";

const AUDIO_STALE_THRESHOLD_MINUTES = 15;
const VIDEO_HEARTBEAT_STALE_MINUTES = 3;
const MAX_ATTEMPTS = 3;

export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req) {
  const correlationId = req.headers.get("x-correlation-id") || crypto.randomUUID();
  // Vercel sets Authorization: Bearer <CRON_SECRET> on scheduled invocations.
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected || auth !== expected) {
    return json({ error: "Forbidden" }, 403);
  }

  const admin = getAdminClient();

  const audioStaleAfter = new Date(Date.now() - AUDIO_STALE_THRESHOLD_MINUTES * 60 * 1000).toISOString();
  const videoStaleAfter = new Date(Date.now() - VIDEO_HEARTBEAT_STALE_MINUTES * 60 * 1000).toISOString();

  const [audioResult, videoResult] = await Promise.all([
    admin
      .from("hls_transcode_jobs")
      .select("id, slug, track_slug, attempt_count, worker_id")
      .eq("status", "processing")
      .eq("job_type", "audio")
      .lt("started_at", audioStaleAfter),
    admin
      .from("hls_transcode_jobs")
      .select("id, slug, track_slug, attempt_count, worker_id")
      .eq("status", "processing")
      .eq("job_type", "video")
      .lt("heartbeat_at", videoStaleAfter),
  ]);

  if (audioResult.error || videoResult.error) {
    emitServerEvent("error", "hls_stale_job_discovery_failed", { correlationId }, audioResult.error || videoResult.error);
    return json({ error: (audioResult.error || videoResult.error).message }, 500);
  }

  const staleJobs = [...(audioResult.data || []), ...(videoResult.data || [])];

  if (!staleJobs.length) {
    return json({ rescued: 0, escalated: 0, staleFound: 0 });
  }

  const toRescue  = staleJobs.filter((j) => j.attempt_count < MAX_ATTEMPTS).map((j) => j.id);
  const toEscalate = staleJobs.filter((j) => j.attempt_count >= MAX_ATTEMPTS).map((j) => j.id);

  const ops = [];

  if (toRescue.length) {
    ops.push(
      admin
        .from("hls_transcode_jobs")
        .update({
          status:       "pending",
          worker_id:    null,
          started_at:   null,
          heartbeat_at: null,
          error_message: `Rescued from stale processing state at ${new Date().toISOString()}`,
        })
        .in("id", toRescue)
    );
  }

  if (toEscalate.length) {
    ops.push(
      admin
        .from("hls_transcode_jobs")
        .update({
          status:           "failed",
          worker_id:        null,
          error_message:    `Max retry attempts (${MAX_ATTEMPTS}) reached after stale processing — manual intervention required`,
          failure_category: "LEASE_LOST",
          completed_at:     new Date().toISOString(),
        })
        .in("id", toEscalate)
    );
  }

  const results = await Promise.all(ops);
  const errors  = results.filter((r) => r.error).map((r) => r.error.message);

  if (errors.length) {
    emitServerEvent("error", "hls_stale_job_recovery_failed",
      { correlationId, staleFound: staleJobs.length, errorCount: errors.length }, results.find((result) => result.error)?.error);
    return json({ error: errors.join("; ") }, 500);
  }

  emitServerEvent(toEscalate.length ? "warn" : "info", "hls_stale_job_recovery_completed",
    { correlationId, staleFound: staleJobs.length, rescued: toRescue.length,
      escalated: toEscalate.length, maxAttempts: MAX_ATTEMPTS });

  return json({
    staleFound: staleJobs.length,
    rescued:    toRescue.length,
    escalated:  toEscalate.length,
  });
}
