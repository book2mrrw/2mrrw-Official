import { NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/auth/admin-api-guard";
import { classifyAdminAuthorityDenial } from "@/lib/auth/admin-authority-diagnostics";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { BroadcastServiceError, validBroadcastId } from "./command-service.js";
export const broadcastResponse = (body, status = 200, headers = {}) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", ...headers } });

export async function authorizeBroadcastAdmin(req, context) {
  const gate = await requireAdminActor();
  if (!gate.ok) {
    const denial = classifyAdminAuthorityDenial(gate.reason);
    return { denial: broadcastResponse({ error: "Broadcast access denied", code: denial.code }, denial.status) };
  }
  if (process.env.BROADCAST_ENABLED !== "true") return { denial: broadcastResponse({ error: "Broadcast is not enabled", code: "BROADCAST_DISABLED" }, 503) };
  const id = context ? (await context.params).id : null;
  if (context && !validBroadcastId(id)) return { denial: broadcastResponse({ error: "Not found" }, 404) };
  const limit = await checkRateLimit(req, { routeKey: `admin.broadcast.${req.method.toLowerCase()}`, identifier: gate.user.id, limit: 120, windowSeconds: 60, failureMode: "closed" });
  if (!limit.allowed) return { denial: broadcastResponse({ error: "Please wait before retrying" }, 429, { "Retry-After": String(limit.retryAfterSeconds || 60) }) };
  return { actorId: gate.user.id, id };
}


export async function readBroadcastBody(req) {
    // Stream a bounded body: Content-Length alone is caller-controlled and can be absent.
    const reader = req.body?.getReader();
    if (!reader) throw new BroadcastServiceError("Command required", 400);
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) { await reader.cancel(); throw new BroadcastServiceError("Command too large", 413); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    let command;
    try { command = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new BroadcastServiceError("Invalid JSON command", 400); }
  return command;
}
