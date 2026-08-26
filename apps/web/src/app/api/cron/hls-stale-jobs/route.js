/**
 * GET /api/cron/hls-stale-jobs
 *
 * Rescues HLS transcode jobs that have been stuck in 'processing' for longer
 * than STALE_THRESHOLD_MINUTES. This happens when a worker crashes mid-transcode
 * without releasing its lock.
 *
 * Called by Vercel Cron (vercel.json) — must use GET.
 * Protected by CRON_SECRET header check; the header is automatically set by Vercel.
 *
 * Rescue strategy:
 *   attempt_count < MAX_ATTEMPTS  → reset to 'pending'   (worker will re-claim it)
 *   attempt_count >= MAX_ATTEMPTS → escalate to 'failed' (requires manual intervention)
 *
 * vercel.json schedule: every 10 minutes ("star/10 star star star star")
 */

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { emitServerEvent } from "@/lib/observability/server-events";

const STALE_THRESHOLD_MINUTES = 15;
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

  // Find jobs stuck in 'processing' past the stale threshold
  const staleAfter = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000).toISOString();

  const { data: staleJobs, error: fetchErr } = await admin
    .from("hls_transcode_jobs")
    .select("id, slug, track_slug, attempt_count, worker_id")
    .eq("status", "processing")
    .lt("started_at", staleAfter);

  if (fetchErr) {
    emitServerEvent("error", "hls_stale_job_discovery_failed", { correlationId }, fetchErr);
    return json({ error: fetchErr.message }, 500);
  }

  if (!staleJobs?.length) {
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
          status:     "pending",
          worker_id:  null,
          started_at: null,
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
          status:       "failed",
          worker_id:    null,
          error_message: `Max retry attempts (${MAX_ATTEMPTS}) reached after stale processing — manual intervention required`,
          completed_at:  new Date().toISOString(),
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
