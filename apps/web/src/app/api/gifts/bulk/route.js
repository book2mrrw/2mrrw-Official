import crypto from "node:crypto";
import { requireAdminActor } from "@/lib/auth/admin-api-guard";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { emitServerEvent } from "@/lib/observability/server-events";

const BATCH_SIZE = 50;
const BULK_GIFT_RATE_MAX = 5;

export async function POST(req) {
  const correlationId = req.headers.get("x-correlation-id") || crypto.randomUUID();
  const gate = await requireAdminActor();
  if (!gate.ok) {
    return Response.json(
      { error: "Forbidden", reason: gate.reason },
      { status: gate.reason === "no_session" ? 401 : 403 }
    );
  }
  const user = gate.user;

  // Bulk entitlement grants are privileged fan-out writes. Their request
  // budget must remain global across instances and cold starts. If neither
  // durable limiter is available, deny instead of silently widening authority.
  const limit = await checkRateLimit(req, {
    routeKey: "gifts.bulk",
    limit: BULK_GIFT_RATE_MAX,
    windowSeconds: 60,
    identifier: user.id,
    failureMode: "closed",
  });
  if (!limit.allowed) {
    if (limit.unavailable) {
      return Response.json(
        { error: "Bulk gifting is temporarily unavailable. Please retry shortly." },
        { status: 503, headers: { "Retry-After": "30" } }
      );
    }
    return rateLimitResponse(limit.retryAfterSeconds ?? 60);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { slug, recipient_type: recipientType, message } = body || {};
  if (!slug || !recipientType) {
    return Response.json({ error: "slug and recipient_type required" }, { status: 400 });
  }

  const admin = getAdminClient();
  let recipients = [];

  if (recipientType === "subscribers") {
    const { data } = await admin
      .from("memberships")
      .select("user_id, profiles(email)")
      .in("status", ["active", "trialing"]);
    recipients = data || [];
  } else if (recipientType === "collectors") {
    const { data } = await admin
      .from("collector_ownerships")
      .select("user_id, profiles(email)")
      .eq("entitlement_status", "active")
      .in("verification_status", ["verified", "pending"]);
    recipients = data || [];
  } else if (recipientType === "all") {
    const { data } = await admin.from("profiles").select("id, email").not("email", "is", null);
    recipients = data?.map((row) => ({ user_id: row.id, profiles: { email: row.email } })) || [];
  } else {
    return Response.json({ error: "Invalid recipient_type" }, { status: 400 });
  }

  const grantTargets = recipients.filter((recipient) => recipient.profiles?.email && recipient.user_id);
  let granted = 0;

  for (let index = 0; index < grantTargets.length; index += BATCH_SIZE) {
    const batch = grantTargets.slice(index, index + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((recipient) =>
        grantLibraryItems({
          userId: recipient.user_id,
          purchaseId: null,
          slugs: [slug],
          source: "admin_bulk_gift",
          entitlementMetadata: { giftedBy: user.id, message: message || null },
        })
      )
    );
    granted += results.filter((result) => result.status === "fulfilled").length;
  }

  emitServerEvent(granted === grantTargets.length ? "info" : "warn", "admin_bulk_gift_completed",
    { correlationId, actorId: user.id, recipientType, requested: recipients.length,
      eligible: grantTargets.length, granted, failed: grantTargets.length - granted, releaseSlug: slug });
  return Response.json({ ok: true, granted, total: recipients.length });
}
