import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export async function GET(req) {
  try {
    const user = await getFanSessionUser();
    if (!user || user.isGuest) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    if (!isAdminUser(user)) {
      return NextResponse.json({ error: "Admin account required" }, { status: 403 });
    }

    const rl = await checkRateLimit(req, {
      routeKey: "gifts.sent",
      limit: 20,
      windowSeconds: 60,
      identifier: user.id,
    });
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

    const admin = getAdminClient();
    const { data: gifts, error } = await admin
      .from("gifts")
      .select("id, created_at, recipient_email, recipient_phone, item_title, item_type, item_id, status, claimed, claimed_at, sender_id")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const productIds = [...new Set((gifts || []).map((g) => g.item_id).filter(Boolean))];
    let coverByProductId = {};
    if (productIds.length) {
      const { data: products } = await admin
        .from("products")
        .select("id, cover_url, slug")
        .in("id", productIds);
      coverByProductId = Object.fromEntries(
        (products || []).map((p) => [p.id, p.cover_url || null])
      );
    }

    const rows = (gifts || []).map((gift) => ({
      id: gift.id,
      title: gift.item_title || "Gift",
      recipientEmail: gift.recipient_email,
      recipientPhone: gift.recipient_phone || null,
      createdAt: gift.created_at,
      status: gift.status,
      claimed: Boolean(gift.claimed),
      claimedAt: gift.claimed_at || null,
      redemptionStatus: gift.claimed ? "redeemed" : gift.status,
      coverUrl: coverByProductId[gift.item_id] || null,
    }));

    return NextResponse.json({ gifts: rows });
  } catch (err) {
    console.error("gifts sent list error:", err);
    return NextResponse.json({ error: err.message || "Could not load gifts" }, { status: 500 });
  }
}
