/**
 * POST /api/admin/catalog/r2-ingest
 *
 * Secret-authenticated R2 media ingestion trigger — for automated/external callers.
 * Session-authenticated callers use /api/admin/catalog/ingest-trigger instead,
 * which calls the same pipeline directly without the HTTP hop.
 *
 * Auth: x-seed-secret header (ADMIN_SEED_SECRET env var).
 *
 * Body (optional JSON):
 *   { dryRun?: boolean }   — true = scan + classify only, no DB writes
 */

import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { runR2Ingest } from "@/lib/catalog/r2-ingest-pipeline";

function authorize(req) {
  const secret = req.headers.get("x-seed-secret");
  return Boolean(process.env.ADMIN_SEED_SECRET && secret === process.env.ADMIN_SEED_SECRET);
}

export const dynamic = "force-dynamic";

export async function POST(req) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await checkRateLimit(req, {
    routeKey: "admin.catalog.r2-ingest",
    limit: 5,
    windowSeconds: 60,
  });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const body = await req.json().catch(() => ({}));
  const dryRun = Boolean(body?.dryRun);

  try {
    const admin = getAdminClient();
    const result = await runR2Ingest({ admin, dryRun });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[r2-ingest] unhandled error", err?.message);
    return NextResponse.json({ ok: false, error: err?.message || "Internal error" }, { status: 500 });
  }
}
