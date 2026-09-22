import { broadcastResponse as response, authorizeBroadcastAdmin, readBroadcastBody } from "@/lib/broadcast/admin-http";
import { broadcastRepository } from "@/lib/broadcast/server-repository";
import { resolveBroadcastProject } from "@/lib/broadcast/server-project";
import { createBroadcastSession } from "@/lib/broadcast/session-creation";
import { BroadcastServiceError, validBroadcastId } from "@/lib/broadcast/command-service";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const access = await authorizeBroadcastAdmin(req);
    if (access.denial) return access.denial;
    const before = new URL(req.url).searchParams.get("before");
    let cursor;
    if (before) {
      try { cursor = JSON.parse(Buffer.from(before, "base64url").toString("utf8")); } catch { return response({ error: "Invalid cursor" }, 400); }
      if (!validBroadcastId(cursor?.id) || typeof cursor?.at !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.at) || !Number.isFinite(Date.parse(cursor.at))) return response({ error: "Invalid cursor" }, 400);
    }
    let query = getAdminClient().from("broadcast_sessions").select("id,snapshot,created_at")
      .eq("host_id", access.actorId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(51);
    if (cursor) query = query.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data.slice(0, 50);
    const last = rows.at(-1);
    return response({ sessions: rows.map((row) => row.snapshot), nextCursor: data.length > 50 ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString("base64url") : null });
  } catch { return response({ error: "Broadcast storage is unavailable" }, 503); }
}

export async function POST(req) {
  try {
    const access = await authorizeBroadcastAdmin(req);
    if (access.denial) return access.denial;
    const input = await readBroadcastBody(req);
    const result = await createBroadcastSession({ repository: broadcastRepository(), resolveProject: resolveBroadcastProject,
      actorId: access.actorId, input });
    return response(result, result.duplicate ? 200 : 201);
  } catch (error) {
    if (error instanceof BroadcastServiceError) return response({ error: error.message, code: error.code }, error.status);
    return response({ error: "Broadcast creation is unavailable" }, 503);
  }
}
