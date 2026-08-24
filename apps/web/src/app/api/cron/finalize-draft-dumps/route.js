import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { finalizeDraftDump } from "@/lib/releases/finalize-draft-dump";

export const dynamic = "force-dynamic";
export async function GET(req) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected || req.headers.get("authorization") !== expected) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = getAdminClient();
  const { data: jobs, error } = await admin.from("draft_deletion_jobs").select("id,release_id,asset_keys").is("finalized_at", null).lte("delete_after", new Date().toISOString()).limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const results = [];
  for (const job of jobs || []) {
    try { await finalizeDraftDump(admin, job); results.push({ id: job.id, ok: true }); }
    catch (err) { results.push({ id: job.id, ok: false, error: err.message }); }
  }
  return NextResponse.json({ finalized: results.filter((item) => item.ok).length, results });
}
