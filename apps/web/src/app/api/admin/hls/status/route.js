/**
 * GET /api/admin/hls/status[?slug=&trackSlug=&status=&page=&limit=]
 *
 * Admin dashboard endpoint for HLS pipeline observability.
 * Returns paginated job list + aggregate status counts + manifest completion count.
 *
 * Query params:
 *   slug      — filter to a specific slug
 *   trackSlug — filter to a specific track within an album/EP
 *   status    — filter by job status (pending|processing|complete|failed|cancelled)
 *   page      — 0-indexed page (default 0)
 *   limit     — max results per page (default 50, max 200)
 */

import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

const JOB_STATUSES = ["pending", "processing", "complete", "failed", "cancelled"];

export async function GET(req) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) return json({ error: "Forbidden" }, 403);

  const { searchParams } = req.nextUrl;
  const slug      = searchParams.get("slug")      || null;
  const trackSlug = searchParams.get("trackSlug") || null;
  const status    = searchParams.get("status")    || null;
  const page      = Math.max(0, parseInt(searchParams.get("page")  || "0", 10));
  const limit     = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

  const admin = getAdminClient();

  // Build job list query
  let jobQuery = admin
    .from("hls_transcode_jobs")
    .select(
      "id, slug, track_slug, release_type, status, priority, bitrates, " +
      "segment_duration_secs, attempt_count, worker_id, error_message, " +
      "source_key, hls_prefix, queued_by, created_at, started_at, completed_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  if (slug)      jobQuery = jobQuery.eq("slug", slug);
  if (trackSlug) jobQuery = jobQuery.eq("track_slug", trackSlug);
  if (status)    jobQuery = jobQuery.eq("status", status);

  // Fire all queries in parallel: job list + one count query per status + manifest count
  const [jobResult, ...statusResults] = await Promise.all([
    jobQuery,
    ...JOB_STATUSES.map((s) =>
      admin
        .from("hls_transcode_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", s)
    ),
  ]);

  const { data: jobs, error: jobErr, count } = jobResult;
  if (jobErr) return json({ error: jobErr.message }, 500);

  const stats = JOB_STATUSES.map((s, i) => ({
    status: s,
    count:  statusResults[i]?.count ?? 0,
  }));

  // Manifest completion count (separate table — fired after parallel batch to avoid extra slot)
  const { count: manifestCount } = await admin
    .from("hls_manifests")
    .select("*", { count: "exact", head: true });

  return json({
    jobs:           jobs ?? [],
    totalJobs:      count ?? 0,
    page,
    limit,
    stats,
    manifestsReady: manifestCount ?? 0,
  });
}
