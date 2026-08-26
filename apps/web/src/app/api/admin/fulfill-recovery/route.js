import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import { fulfillPaymentIntent } from "@/lib/commerce/fulfill-purchase";
import { getAdminClient } from "@/lib/supabase/admin";
import { requireAdminOrCapability, ServiceCapability } from "@/lib/auth/admin-api-guard";

export async function POST(req) {
  const gate = await requireAdminOrCapability(req, ServiceCapability.FULFILL_RECOVERY);
  if (!gate.ok) {
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

    const admin = getAdminClient();
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
