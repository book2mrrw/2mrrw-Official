import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import { resolveCartLines } from "@/lib/commerce/resolve-cart";
import { getOwnedSlugs } from "@/lib/commerce/entitlements";
import { getRequestUser } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export async function POST(req) {
  try {
    const user = await getRequestUser();

    if (!user) {
      return NextResponse.json({ error: "Sign in to checkout" }, { status: 401 });
    }

    const limit = await checkRateLimit(req, {
      routeKey: "payment-intent.create",
      limit: 10,
      windowSeconds: 600,
      identifier: user.id,
    });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

    const { cart } = await req.json();
    const lines = await resolveCartLines(cart);
    const owned = await getOwnedSlugs(user.id);
    const purchasable = lines.filter((l) => !owned.has(l.slug));

    if (purchasable.length === 0) {
      return NextResponse.json({ error: "You already own everything in your cart" }, { status: 400 });
    }

    const amount = purchasable.reduce((sum, l) => sum + l.price_cents, 0);
    if (amount <= 0) {
      return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
    }

    const items = purchasable.map((l) => ({
      slug: l.slug,
      title: l.title,
      price: l.price_cents / 100,
      cover: l.cover_url,
      type: l.product_type === "merch" ? "merch" : "digital",
    }));

    const paymentIntent = await getStripe().paymentIntents.create({
      amount,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      receipt_email: user.email || undefined,
      metadata: {
        user_id: user.id,
        guest_user_id: user.id,
        email: user.email || "",
        phone: user.phone || "",
        slugs: JSON.stringify(purchasable.map((l) => l.slug)),
        items: JSON.stringify(items),
      },
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("Payment intent error:", err);
    return NextResponse.json({ error: err.message || "Payment failed" }, { status: 500 });
  }
}
