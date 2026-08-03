import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import { fulfillPaymentIntent } from "@/lib/commerce/fulfill-purchase";
import { getGuestUser } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

/** Idempotent fulfillment after in-page Payment Element success (webhook backup). */
export async function POST(req) {
  try {
    const user = await getGuestUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = await checkRateLimit(req, {
      routeKey: "purchase.confirm",
      limit: 20,
      windowSeconds: 60,
      identifier: user.id,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const { paymentIntentId } = await req.json();
    if (!paymentIntentId) {
      return NextResponse.json({ error: "paymentIntentId required" }, { status: 400 });
    }

    const pi = await getStripe().paymentIntents.retrieve(paymentIntentId);
    if ((pi.metadata?.guest_user_id || pi.metadata?.user_id) !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await fulfillPaymentIntent(pi);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("purchase confirm error:", err);
    return NextResponse.json({ error: err.message || "Confirm failed" }, { status: 500 });
  }
}
