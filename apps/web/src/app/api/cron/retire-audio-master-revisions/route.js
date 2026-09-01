import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { deleteR2Object, listR2Objects } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

function authorized(req) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  return Boolean(expected && req.headers.get("authorization") === expected);
}

function safeHlsRetirementPrefix(prefix) {
  const normalized = String(prefix || "").replace(/^\//, "").replace(/\/?$/, "/");
  if (!/^(hls|hls-revisions)\/[a-z0-9-]+\/[a-z0-9-_]+\//.test(normalized)) return null;
  return normalized;
}

async function deletePrefix(prefix) {
  const safePrefix = safeHlsRetirementPrefix(prefix);
  if (!safePrefix) throw new Error("Unsafe HLS retirement prefix");
  const objects = await listR2Objects(safePrefix, { recursive: true });
  for (const object of objects) {
    if (object.Key) await deleteR2Object(object.Key);
  }
  return objects.length;
}

export async function GET(req) {
  if (!authorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const admin = getAdminClient();
  const now = new Date().toISOString();
  const abandonedBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Uncommitted staged uploads are never authoritative. Expire them so a lost
  // browser session cannot block a later replacement or leak storage forever.
  const { data: abandoned = [] } = await admin
    .from("audio_master_revisions")
    .select("id, staged_master_key")
    .eq("status", "uploading")
    .lt("created_at", abandonedBefore)
    .limit(50);
  for (const revision of abandoned) {
    await deleteR2Object(revision.staged_master_key).catch(() => {});
    await admin.from("audio_master_revisions").update({
      status: "cancelled",
      error_message: "Staged upload expired before processing",
      failed_at: now,
    }).eq("id", revision.id).eq("status", "uploading");
  }

  const { data: due = [], error: dueError } = await admin
    .from("audio_master_revisions")
    .select("id, staged_master_key, previous_master_key, hls_prefix, previous_hls_prefix")
    .in("status", ["active", "retired"])
    .is("previous_assets_retired_at", null)
    .lte("retire_after", now)
    .limit(25);
  if (dueError) return NextResponse.json({ error: dueError.message }, { status: 500 });

  let retired = 0;
  const errors = [];
  for (const revision of due) {
    try {
      if (revision.previous_master_key && revision.previous_master_key !== revision.staged_master_key) {
        await deleteR2Object(revision.previous_master_key);
      }
      if (revision.previous_hls_prefix && revision.previous_hls_prefix !== revision.hls_prefix) {
        await deletePrefix(revision.previous_hls_prefix);
      }
      const { error } = await admin.from("audio_master_revisions").update({
        previous_assets_retired_at: now,
      }).eq("id", revision.id).is("previous_assets_retired_at", null);
      if (error) throw error;
      retired += 1;
    } catch (error) {
      errors.push({ revisionId: revision.id, error: error?.message || "retirement failed" });
    }
  }

  return NextResponse.json({
    abandonedExpired: abandoned.length,
    retirementDue: due.length,
    retired,
    errors,
  }, { status: errors.length ? 207 : 200 });
}

