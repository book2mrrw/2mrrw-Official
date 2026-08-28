import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { deleteR2Prefix } from "@/lib/storage/r2";
import { emitServerEvent } from "@/lib/observability/server-events";

export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected || req.headers.get("authorization") !== expected) {
    return json({ error: "Forbidden" }, 403);
  }

  const correlationId = req.headers.get("x-correlation-id") || crypto.randomUUID();
  const admin = getAdminClient();
  const { data: prefixes, error } = await admin.rpc("hls_claim_retired_prefixes", {
    p_limit: 10,
  });
  if (error) {
    emitServerEvent("error", "hls_retired_prefix_claim_failed", { correlationId }, error);
    return json({ error: error.message }, 500);
  }

  const outcomes = [];
  for (const retired of prefixes || []) {
    const prefix = String(retired.hls_prefix || "");
    try {
      if (!prefix.startsWith("hls/") || !prefix.endsWith("/") || prefix.includes("..")) {
        throw new Error("Rejected unsafe retired HLS prefix");
      }

      // Generation zero used the logical base itself. Preserve all versioned
      // descendants while removing only legacy rendition objects below it.
      const excludePrefixes = Number(retired.generation) === 0
        ? [`${prefix}versions/`]
        : [];
      const deletedObjects = await deleteR2Prefix(prefix, { excludePrefixes });
      const { error: finishError } = await admin.rpc("hls_finish_retired_prefix", {
        p_id: retired.id,
        p_deleted: true,
        p_error: null,
      });
      if (finishError) throw finishError;
      outcomes.push({ id: retired.id, prefix, deletedObjects, status: "deleted" });
    } catch (deleteError) {
      try {
        await admin.rpc("hls_finish_retired_prefix", {
          p_id: retired.id,
          p_deleted: false,
          p_error: deleteError?.message || "R2 deletion failed",
        });
      } catch {}
      outcomes.push({ id: retired.id, prefix, status: "failed", error: deleteError?.message });
    }
  }

  const failed = outcomes.filter((outcome) => outcome.status === "failed").length;
  emitServerEvent(failed ? "warn" : "info", "hls_retired_prefix_cleanup_completed", {
    correlationId,
    claimed: outcomes.length,
    deleted: outcomes.length - failed,
    failed,
    objectsDeleted: outcomes.reduce((sum, outcome) => sum + (outcome.deletedObjects || 0), 0),
  });

  return json({ claimed: outcomes.length, failed, outcomes });
}
