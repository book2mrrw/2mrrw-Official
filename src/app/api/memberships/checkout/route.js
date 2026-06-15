import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getOrCreateStripeCustomerForUser } from "@/lib/commerce/stripe-customers";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

const INNER_CIRCLE_PRICE_CENTS = 799;
const INNER_CIRCLE_PRICE_ID = process.env.STRIPE_INNER_CIRCLE_PRICE_ID;
const INNER_CIRCLE_PRODUCT_ID = process.env.STRIPE_INNER_CIRCLE_PRODUCT_ID;
const INNER_CIRCLE_PRODUCT_METADATA = { slug: "inner_circle_membership", tier: "inner_circle" };

async function getMembershipProduct(stripe) {
  if (INNER_CIRCLE_PRODUCT_ID) {
    return stripe.products.retrieve(INNER_CIRCLE_PRODUCT_ID);
  }

  const products = await stripe.products.list({ active: true, limit: 100 });
  const existing = products.data.find((product) => product.metadata?.slug === INNER_CIRCLE_PRODUCT_METADATA.slug);
  if (existing) return existing;

  return stripe.products.create(
    {
      name: "2MRRW Inner Circle Membership",
      description: "All-access digital ecosystem membership: music, videos, archives, exclusives, premium livestreams, creative process content, and future premium features.",
      metadata: INNER_CIRCLE_PRODUCT_METADATA,
    },
    { idempotencyKey: "inner-circle-membership-product" }
  );
}

async function membershipLineItem(stripe) {
  if (INNER_CIRCLE_PRICE_ID) {
    return { price: INNER_CIRCLE_PRICE_ID };
  }

  const product = await getMembershipProduct(stripe);
  return {
    price_data: {
      currency: "usd",
      unit_amount: INNER_CIRCLE_PRICE_CENTS,
      recurring: { interval: "month" },
      product: product.id,
    },
  };
}

export async function POST(req) {
  try {
    const user = await getFanSessionUser();

    if (!user) {
      return NextResponse.json({ error: "Account session unavailable" }, { status: 401 });
    }

    const limit = await checkRateLimit(req, {
      routeKey: "membership.checkout",
      limit: 5,
      windowSeconds: 3600,
      identifier: user.id,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const stripe = getStripe();
    const metadata = {
      payment_kind: "subscription",
      type: "subscription",
      user_id: user.id,
      guest_user_id: user.id,
      email: user.email || "",
      phone: user.phone || "",
      tier: "inner_circle",
    };
    const customer = await getOrCreateStripeCustomerForUser(stripe, user);

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ quantity: 1, ...(await membershipLineItem(stripe)) }],
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
      },
      expand: ["latest_invoice.payment_intent", "latest_invoice.confirmation_secret"],
      metadata,
    }, {
      idempotencyKey: `inner-circle-subscription-${user.id}-${customer.id}-${Math.floor(Date.now() / 60000)}`,
    });

    const invoice = typeof subscription.latest_invoice === "string"
      ? await stripe.invoices.retrieve(subscription.latest_invoice, {
          expand: ["payment_intent", "confirmation_secret"],
        })
      : subscription.latest_invoice;
    const paymentIntent = invoice?.payment_intent;
    const clientSecret = paymentIntent?.client_secret || invoice?.confirmation_secret?.client_secret;
    if (!clientSecret) {
      throw new Error("Subscription payment setup did not return a client secret");
    }
    if (paymentIntent?.id) {
      await stripe.paymentIntents.update(paymentIntent.id, { metadata });
    }

    return NextResponse.json({
      clientSecret,
      subscriptionId: subscription.id,
      amountCents: INNER_CIRCLE_PRICE_CENTS,
    });
  } catch (err) {
    console.error("membership checkout error:", err);
    return NextResponse.json({ error: err.message || "Subscription checkout failed" }, { status: 500 });
  }
}
