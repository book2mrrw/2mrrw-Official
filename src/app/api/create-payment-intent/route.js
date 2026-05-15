import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/commerce/stripe";
import { resolveCartLines } from "@/lib/commerce/resolve-cart";
import { getOwnedSlugs } from "@/lib/commerce/entitlements";

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
      payment_method_types: ["card"],
      metadata: {
        user_id: user.id,
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
