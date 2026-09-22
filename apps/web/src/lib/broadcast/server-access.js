import "server-only";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { requireAdminActor } from "@/lib/auth/admin-api-guard";
import { getAdminClient } from "@/lib/supabase/admin";
import { getUserEntitlements } from "@/lib/entitlements";
import { resolveLiveBroadcastAccess } from "@/lib/server/live-access";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { BroadcastServiceError, validBroadcastId } from "./command-service.js";
import { canAccessBroadcast } from "./access-policy.js";

const checked = ({ data, error }) => { if (error) throw new Error("Broadcast access unavailable", { cause: error }); return data; };

export async function authorizeBroadcastListener(req, sessionId) {
  if (process.env.BROADCAST_ENABLED !== "true") throw new BroadcastServiceError("Broadcast unavailable", 503);
  const user = await getFanSessionUser();
  if (!user || user.isGuest) throw new BroadcastServiceError("Sign in to enter", 401);
  if (!validBroadcastId(sessionId)) throw new BroadcastServiceError("Not found", 404);
  const rate = await checkRateLimit(req, { routeKey: "broadcast.listener", identifier: user.id, limit: 240, windowSeconds: 60, failureMode: "closed" });
  if (!rate.allowed) throw new BroadcastServiceError("Please wait before retrying", 429);
  const client = getAdminClient();
  const row = checked(await client.from("broadcast_sessions").select("id,snapshot,live_broadcast_id").eq("id", sessionId).maybeSingle());
  if (!row) throw new BroadcastServiceError("Not found", 404);
  const facts = { signedIn: true, admin: false };
  if (isAdminUser(user)) facts.admin = (await requireAdminActor()).ok;
  if (!facts.admin) {
    const policy = row.snapshot.accessPolicy;
    if (["SUBSCRIBER", "COLLECTOR_CARD_OWNER"].includes(policy)) {
      const entitlements = await getUserEntitlements(user.id, client);
      facts.subscriber = Boolean(entitlements.subscriber);
      facts.collector = Boolean(entitlements.collector_card);
    } else if (policy === "PURCHASER") {
      facts.purchaser = Boolean(checked(await client.from("purchases").select("id").eq("user_id", user.id).eq("status", "completed").limit(1).maybeSingle()));
    } else if (policy === "ENTRY" && row.live_broadcast_id) {
      facts.liveEntry = (await resolveLiveBroadcastAccess({ admin: client, user, broadcast: { id: row.live_broadcast_id } })).access === "free";
    } else if (["INVITE_ONLY", "PRIVATE_PRESS_INDUSTRY"].includes(policy)) {
      const grant = checked(await client.from("broadcast_session_grants").select("kind,expires_at,revoked_at")
        .eq("session_id", sessionId).eq("user_id", user.id).maybeSingle());
      if (grant) facts.grant = { sessionId, kind: grant.kind, expiresAt: Date.parse(grant.expires_at), revokedAt: grant.revoked_at };
    }
  }
  if (!canAccessBroadcast(row.snapshot, facts)) throw new BroadcastServiceError("Broadcast access denied", 403);
  return { client, user, session: row.snapshot, admin: facts.admin };
}
