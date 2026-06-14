import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getStripe } from "@/lib/commerce/stripe";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

const REFUND_WINDOW_DAYS = 30;

export async function POST(req) {
  try {
    const limit = await checkRateLimit(req, {
      routeKey: "refund.request",
      limit: 5,
      windowSeconds: 3600,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const user = await getFanSessionUser();
    if (!user || user.isGuest) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const purchaseId = body?.purchase_id;
    if (!purchaseId) {
      return NextResponse.json({ error: "purchase_id is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: purchase, error: fetchError } = await admin
      .from("purchases")
      .select("id, user_id, status, amount_cents, stripe_payment_intent_id, purchase_type, purchased_at, items")
      .eq("id", purchaseId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!purchase) {
      return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
    }

    if (purchase.status === "refunded") {
      return NextResponse.json({ error: "This purchase has already been refunded" }, { status: 409 });
    }
    if (purchase.status !== "completed") {
      return NextResponse.json({ error: "Only completed purchases can be refunded" }, { status: 400 });
    }
    if (!purchase.stripe_payment_intent_id) {
      return NextResponse.json({ error: "This purchase is not eligible for a refund" }, { status: 400 });
    }
    if ((purchase.amount_cents ?? 0) === 0) {
      return NextResponse.json({ error: "Complimentary purchases are not refundable" }, { status: 400 });
    }

    const purchasedAt = new Date(purchase.purchased_at);
    const windowExpires = new Date(purchasedAt);
    windowExpires.setDate(windowExpires.getDate() + REFUND_WINDOW_DAYS);
    if (new Date() > windowExpires) {
      return NextResponse.json(
        { error: `Refund window closed — purchases are eligible for ${REFUND_WINDOW_DAYS} days after purchase` },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    const refund = await stripe.refunds.create({
      payment_intent: purchase.stripe_payment_intent_id,
      reason: "requested_by_customer",
    });

    if (refund.status !== "succeeded" && refund.status !== "pending") {
      return NextResponse.json({ error: "Refund could not be processed. Please contact support." }, { status: 502 });
    }

    const { error: updateError } = await admin
      .from("purchases")
      .update({
        status: "refunded",
        refunded_at: new Date().toISOString(),
        stripe_refund_id: refund.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchaseId)
      .eq("user_id", user.id);
    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      refund_id: refund.id,
      status: refund.status,
      amount_cents: purchase.amount_cents,
    });
  } catch (err) {
    console.error("[refund] error:", err);
    if (err?.type === "StripeInvalidRequestError") {
      return NextResponse.json({ error: err.message || "Stripe refund failed" }, { status: 400 });
    }
    return NextResponse.json({ error: "Refund failed. Please try again or contact support." }, { status: 500 });
  }
}
