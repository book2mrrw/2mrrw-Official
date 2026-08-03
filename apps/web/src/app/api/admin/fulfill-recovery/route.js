import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import { fulfillPaymentIntent } from "@/lib/commerce/fulfill-purchase";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req) {
  const secret = req.headers.get("x-seed-secret");
  if (!process.env.ADMIN_SEED_SECRET || secret !== process.env.ADMIN_SEED_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { paymentIntentId } = await req.json();
    if (!paymentIntentId) {
      return NextResponse.json({ error: "paymentIntentId required" }, { status: 400 });
    }

    const pi = await getStripe().paymentIntents.retrieve(paymentIntentId);
    const result = await fulfillPaymentIntent(pi);

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "Fulfillment skipped: missing user_id or invalid status" },
        { status: 422 }
      );
    }

    const admin = createAdminClient();
    const { data: libraryItems, error: libErr } = await admin
      .from("library_items")
      .select("id, user_id, product_id, purchase_id, source, granted_at, products(slug, title)")
      .eq("purchase_id", result.purchaseId);

    if (libErr) {
      return NextResponse.json({ error: libErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      paymentIntentId,
      purchaseId: result.purchaseId,
      slugs: result.slugs,
      library_items: libraryItems || [],
    });
  } catch (err) {
    console.error("fulfill-recovery error:", err);
    return NextResponse.json({ error: err.message || "Recovery failed" }, { status: 500 });
  }
}
