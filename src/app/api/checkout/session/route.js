import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/commerce/stripe";
import { resolveCartLines } from "@/lib/commerce/resolve-cart";
import { getOwnedSlugs } from "@/lib/commerce/entitlements";

const siteUrl = () =>
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  "http://localhost:3000";

export async function POST(req) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Sign in to checkout" }, { status: 401 });
    }

    const { cart } = await req.json();
    const lines = await resolveCartLines(cart);
    const owned = await getOwnedSlugs(user.id);
    const purchasable = lines.filter((l) => !owned.has(l.slug));

    if (purchasable.length === 0) {
      return NextResponse.json({ error: "You already own everything in your cart" }, { status: 400 });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email || undefined,
      line_items: purchasable.map((line) => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: line.price_cents,
          product_data: {
            name: line.title,
            images: line.cover_url ? [new URL(line.cover_url, siteUrl()).href] : undefined,
          },
        },
      })),
      success_url: `${siteUrl()}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/?tab=shop`,
      metadata: {
        user_id: user.id,
        slugs: JSON.stringify(purchasable.map((l) => l.slug)),
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
