import { isAdminUser } from "@/lib/auth/constants";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";

const BATCH_SIZE = 50;
const BULK_GIFT_RATE_WINDOW_MS = 60_000;
const BULK_GIFT_RATE_MAX = 5;
const bulkGiftRateBuckets = typeof Map !== "undefined" ? new Map() : null;

function checkBulkGiftRateLimit(userId) {
  if (!bulkGiftRateBuckets || !userId) return { allowed: true };
  const now = Date.now();
  const bucket = bulkGiftRateBuckets.get(userId);
  if (!bucket || now - bucket.windowStartMs >= BULK_GIFT_RATE_WINDOW_MS) {
    bulkGiftRateBuckets.set(userId, { windowStartMs: now, count: 1 });
    return { allowed: true };
  }
  if (bucket.count >= BULK_GIFT_RATE_MAX) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.windowStartMs + BULK_GIFT_RATE_WINDOW_MS - now) / 1000)
    );
    return { allowed: false, retryAfterSeconds };
  }
  bucket.count += 1;
  return { allowed: true };
}

export async function POST(req) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (bulkGiftRateBuckets) {
    const limit = checkBulkGiftRateLimit(user.id);
    if (!limit.allowed) {
      return Response.json(
        { error: "Too many bulk gift requests. Try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds ?? 60) },
        }
      );
    }
  } else {
    // TODO: add durable rate limiting when Map is unavailable in this runtime.
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

  const admin = createAdminClient();
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
    recipients =
      data?.map((r) => ({ user_id: r.id, profiles: { email: r.email } })) || [];
  } else {
    return Response.json({ error: "Invalid recipient_type" }, { status: 400 });
  }

  const grantTargets = recipients.filter((r) => r.profiles?.email && r.user_id);
  let granted = 0;

  for (let i = 0; i < grantTargets.length; i += BATCH_SIZE) {
    const batch = grantTargets.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((r) =>
        grantLibraryItems({
          userId: r.user_id,
          purchaseId: null,
          slugs: [slug],
          source: "admin_bulk_gift",
          entitlementMetadata: { giftedBy: user.id, message: message || null },
        })
      )
    );
    granted += results.filter((result) => result.status === "fulfilled").length;
  }

  return Response.json({ ok: true, granted, total: recipients.length });
}
