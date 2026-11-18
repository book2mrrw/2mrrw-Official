import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import { getRequestUser } from "@/lib/guest-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { fulfillTicketPurchase } from "@/lib/commerce/handle-stripe-webhook";

/**
 * Records a ticket as soon as its in-page payment succeeds: the buyer's page
 * calls this with the PaymentIntent id, the payment is verified with Stripe
 * (a ticket, this buyer's, succeeded), and the webhook's own fulfillment runs —
 * idempotent on the PaymentIntent id, so the webhook arriving later (or never)
 * changes nothing. Mirrors /api/purchase/confirm for music purchases.
 */
export async function POST(req) {
  try {
    const user = await getRequestUser();
    if (!user) return NextResponse.json({ error: "Sign in to confirm your ticket" }, { status: 401 });

    const rl = await checkRateLimit(req, {
      routeKey: "tickets.confirm",
      limit: 20,
      windowSeconds: 600,
      identifier: user.id,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

    const { paymentIntentId } = await req.json().catch(() => ({}));
    if (typeof paymentIntentId !== "string" || !paymentIntentId.startsWith("pi_")) {
      return NextResponse.json({ error: "paymentIntentId required" }, { status: 400 });
    }

    const pi = await getStripe().paymentIntents.retrieve(paymentIntentId);
    if (pi.metadata?.payment_kind !== "ticket") {
      return NextResponse.json({ error: "Not a ticket payment" }, { status: 400 });
    }
    if ((pi.metadata?.guest_user_id || pi.metadata?.user_id) !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (pi.status !== "succeeded") {
      return NextResponse.json({ error: "Payment is not complete" }, { status: 409 });
    }

    await fulfillTicketPurchase(getAdminClient(), pi);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[tickets/confirm] error:", err);
    return NextResponse.json({ error: "Could not confirm the ticket" }, { status: 500 });
  }
}
