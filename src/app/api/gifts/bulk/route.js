import { isAdminUser } from "@/lib/auth/constants";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
      .eq("status", "active");
    recipients = data || [];
  } else if (recipientType === "collectors") {
    const { data } = await admin
      .from("collector_ownerships")
      .select("user_id, profiles(email)")
      .in("status", ["active", "verified", "granted"]);
    recipients = data || [];
  } else if (recipientType === "all") {
    const { data } = await admin.from("profiles").select("id, email").not("email", "is", null);
    recipients =
      data?.map((r) => ({ user_id: r.id, profiles: { email: r.email } })) || [];
  } else {
    return Response.json({ error: "Invalid recipient_type" }, { status: 400 });
  }

  let granted = 0;
  for (const r of recipients) {
    const recipientEmail = r.profiles?.email;
    if (!recipientEmail || !r.user_id) continue;
    try {
      await grantLibraryItems({
        userId: r.user_id,
        purchaseId: null,
        slugs: [slug],
        source: "admin_bulk_gift",
        entitlementMetadata: { giftedBy: user.id, message: message || null },
      });
      granted += 1;
    } catch {
      /* continue with remaining recipients */
    }
  }

  return Response.json({ ok: true, granted, total: recipients.length });
}
