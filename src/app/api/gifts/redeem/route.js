import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import { createOrRetrieveGuest, withGuestCookie } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw || "")).digest("hex");
}

export async function POST(req) {
  try {
    const limit = await checkRateLimit(req, {
      routeKey: "gifts.redeem",
      limit: 5,
      windowSeconds: 60,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const { token, email, phone, name } = await req.json();
    if (!token) {
      return NextResponse.json({ error: "Gift token required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: gift, error: giftError } = await admin
      .from("gift_links")
      .select("id, title, active, expires_at, max_redemptions, redemption_count, gift_link_items(products(slug))")
      .eq("token_hash", hashToken(token))
      .maybeSingle();
    if (giftError) throw giftError;
    if (!gift || !gift.active) {
      return NextResponse.json({ error: "Gift link is invalid" }, { status: 404 });
    }
    if (gift.expires_at && new Date(gift.expires_at) < new Date()) {
      return NextResponse.json({ error: "Gift link has expired" }, { status: 410 });
    }
    if (gift.max_redemptions && gift.redemption_count >= gift.max_redemptions) {
      return NextResponse.json({ error: "Gift link has reached its limit" }, { status: 410 });
    }

    const user = await createOrRetrieveGuest({ email, phone, name });
    const slugs = (gift.gift_link_items || [])
      .map((row) => row.products?.slug)
      .filter(Boolean);

    const { data: alreadyRedeemed } = await admin
      .from("gift_redemptions")
      .select("id")
      .eq("gift_link_id", gift.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!alreadyRedeemed) {
      await grantLibraryItems({ userId: user.id, purchaseId: null, slugs, source: "gift" });
      const { error: redemptionError } = await admin.from("gift_redemptions").insert({
        gift_link_id: gift.id,
        user_id: user.id,
      });
      if (redemptionError) throw redemptionError;

      await admin
        .from("gift_links")
        .update({ redemption_count: gift.redemption_count + 1 })
        .eq("id", gift.id);
    }

    return withGuestCookie(NextResponse.json({
      ok: true,
      user,
      title: gift.title,
      slugs,
      alreadyRedeemed: !!alreadyRedeemed,
    }), user.id);
  } catch (err) {
    console.error("gift redeem error:", err);
    return NextResponse.json({ error: err.message || "Gift redemption failed" }, { status: 500 });
  }
}
