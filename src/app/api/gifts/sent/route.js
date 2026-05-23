import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";

export async function GET() {
  try {
    const user = await getFanSessionUser();
    if (!user || user.isGuest) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    if (!isAdminUser(user)) {
      return NextResponse.json({ error: "Admin account required" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: gifts, error } = await admin
      .from("gifts")
      .select("id, created_at, recipient_email, item_title, item_type, item_id, status, sender_id")
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
      createdAt: gift.created_at,
      status: gift.status,
      coverUrl: coverByProductId[gift.item_id] || null,
    }));

    return NextResponse.json({ gifts: rows });
  } catch (err) {
    console.error("gifts sent list error:", err);
    return NextResponse.json({ error: err.message || "Could not load gifts" }, { status: 500 });
  }
}
