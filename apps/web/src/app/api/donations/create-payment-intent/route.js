import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import { getGuestUser } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getOrCreateStripeCustomerForUser } from "@/lib/commerce/stripe-customers";

const MIN_DONATION_CENTS = 100;
const MAX_DONATION_CENTS = 500000;

function normalizeAmountCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount);
}

export async function POST(req) {
  try {
    const body = await req.json();
    const amountCents = normalizeAmountCents(body.amountCents);

    if (!amountCents || amountCents < MIN_DONATION_CENTS) {
      return NextResponse.json({ error: "Donation must be at least $1." }, { status: 400 });
    }

    if (amountCents > MAX_DONATION_CENTS) {
      return NextResponse.json({ error: "Donation amount is too high." }, { status: 400 });
    }

    let user = null;
    try {
      user = await getGuestUser();
    } catch (err) {
      console.warn("Donation guest lookup failed:", err.message);
    }

    const limit = await checkRateLimit(req, {
      routeKey: "donation-payment-intent",
      limit: 10,
      windowSeconds: 300,
      identifier: user?.id || `anonymous:${amountCents}`,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const metadata = {
      payment_kind: "donation",
      type: "donation",
      donation_amount_cents: String(amountCents),
      user_id: user?.id || "",
      guest_user_id: user?.id || "",
      email: user?.email || "",
      phone: user?.phone || "",
    };

    const stripe = getStripe();
    const customer = user ? await getOrCreateStripeCustomerForUser(stripe, user) : null;
    const paymentIntentParams = {
      amount: amountCents,
      currency: "usd",
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
      receipt_email: user?.email || undefined,
      description: "2MRRW one-time donation",
      metadata,
    };
    if (customer?.id) {
      paymentIntentParams.customer = customer.id;
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      amountCents,
    });
  } catch (err) {
    console.error("Donation payment intent error:", err);
    return NextResponse.json({ error: err.message || "Donation failed" }, { status: 500 });
  }
}
