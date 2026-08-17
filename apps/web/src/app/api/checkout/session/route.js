import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import { resolveCartLines } from "@/lib/commerce/resolve-cart";
import { getOwnedSlugs, getCheckoutDiscountPercent, isMerchOrVinylProduct } from "@/lib/commerce/entitlements";
import { getRequestUser } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

const siteUrl = () =>
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  "http://localhost:3000";

export async function POST(req) {
  try {
    const user = await getRequestUser();

    if (!user) {
      return NextResponse.json({ error: "Sign in to checkout" }, { status: 401 });
    }

    const limit = await checkRateLimit(req, {
      routeKey: "checkout.session",
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

    const discountPercent = await getCheckoutDiscountPercent(user.id);
    const discountEligible = purchasable.filter((l) => !isMerchOrVinylProduct(l.product_type));
    const hasDiscount = discountPercent > 0 && discountEligible.length > 0;

    const stripe = getStripe();
    const lineItems = purchasable.map((line) => {
      const eligible = !isMerchOrVinylProduct(line.product_type);
      let unitAmount = line.price_cents;
      if (hasDiscount && eligible) {
        unitAmount = Math.max(50, Math.round(line.price_cents * (1 - discountPercent / 100)));
      }
      return {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: unitAmount,
          product_data: {
            name: line.title,
            images: line.cover_url ? [new URL(line.cover_url, siteUrl()).href] : undefined,
          },
        },
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email || undefined,
      line_items: lineItems,
      success_url: `${siteUrl()}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/?tab=shop`,
      metadata: {
        user_id: user.id,
        guest_user_id: user.id,
        email: user.email || "",
        phone: user.phone || "",
        slugs: JSON.stringify(purchasable.map((l) => l.slug)),
        collector_discount_percent: hasDiscount ? String(discountPercent) : "0",
        items: JSON.stringify(
          purchasable.map((l) => ({
            slug: l.slug,
            title: l.title,
            price: l.price_cents / 100,
            cover: l.cover_url,
            type: l.product_type === "merch" ? "merch" : "digital",
          }))
        ),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("checkout session error:", err);
    return NextResponse.json({ error: err.message || "Checkout failed" }, { status: 500 });
  }
}
