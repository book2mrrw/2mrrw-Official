import { broadcastResponse as response, authorizeBroadcastAdmin, readBroadcastBody } from "@/lib/broadcast/admin-http";
import { broadcastRepository } from "@/lib/broadcast/server-repository";
import { BroadcastServiceError, executeBroadcastCommand } from "@/lib/broadcast/command-service";
import { prepareServerBroadcastMedia } from "@/lib/broadcast/server-preparation";

export const dynamic = "force-dynamic";

export async function GET(req, context) {
  try {
    const access = await authorizeBroadcastAdmin(req, context);
    if (access.denial) return access.denial;
    const row = await broadcastRepository().loadOwned(access.id, access.actorId);
    return row ? response({ session: row.snapshot, serverTime: Date.now() }) : response({ error: "Not found" }, 404);
  } catch { return response({ error: "Broadcast storage is unavailable" }, 503); }
}

export async function PATCH(req, context) {
  try {
    const access = await authorizeBroadcastAdmin(req, context);
    if (access.denial) return access.denial;
    const command = await readBroadcastBody(req);
    const result = await executeBroadcastCommand({ repository: broadcastRepository(), sessionId: access.id, actorId: access.actorId, command, prepareMedia: prepareServerBroadcastMedia });
    return response({ ...result, serverTime: Date.now() });
  } catch (error) {
    if (error instanceof BroadcastServiceError) return response({ error: error.message, code: error.code, ...(error.session ? { session: error.session } : {}) }, error.status);
    return response({ error: "Broadcast storage is unavailable" }, 503);
  }
}
