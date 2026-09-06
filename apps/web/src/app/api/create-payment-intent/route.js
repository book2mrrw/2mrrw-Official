import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import { resolveCartLines } from "@/lib/commerce/resolve-cart";
import { getOwnedSlugs } from "@/lib/commerce/entitlements";
import { ownsAudioVisual } from "@/lib/audio-visual/entitlements";
import { getAdminClient } from "@/lib/supabase/admin";
import { getRequestUser } from "@/lib/guest-session";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

/**
 * A cart line is "already owned" via two entirely different mechanisms
 * depending on what it is — a catalog product's ownership is a slug lookup
 * (getOwnedSlugs), but an Audio Visual video has no slug at all, so it's
 * checked against its own real entitlement (ownsAudioVisual) instead. A
 * video line's `l.slug` is always undefined, so it would otherwise silently
 * pass any slug-only "not owned" filter regardless of real ownership.
 */
async function filterPurchasable(lines, { userId, admin, ownedSlugs }) {
  const purchasable = [];
  for (const line of lines) {
    if (line.video_id) {
      const alreadyOwned = await ownsAudioVisual(admin, userId, line.video_id);
      if (!alreadyOwned) purchasable.push(line);
      continue;
    }
    if (!ownedSlugs.has(line.slug)) purchasable.push(line);
  }
  return purchasable;
}

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
    const admin = getAdminClient();
    const ownedSlugs = await getOwnedSlugs(user.id);
    const purchasable = await filterPurchasable(lines, { userId: user.id, admin, ownedSlugs });

    if (purchasable.length === 0) {
      return NextResponse.json({ error: "You already own everything in your cart" }, { status: 400 });
    }

    const amount = purchasable.reduce((sum, l) => sum + l.price_cents, 0);
    if (amount <= 0) {
      return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
    }

    const items = purchasable.map((l) =>
      l.video_id
        ? {
            video_id: l.video_id,
            title: l.title,
            price: l.price_cents / 100,
            cover: l.cover_url,
            type: "audio_visual",
            access_type: l.access_type || "purchase",
          }
        : {
            slug: l.slug,
            title: l.title,
            price: l.price_cents / 100,
            cover: l.cover_url,
            type: l.product_type === "merch" ? "merch" : "digital",
            release_id: l.release_id || null,
            access_type: l.access_type || "purchase",
          }
    );

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
        slugs: JSON.stringify(purchasable.map((l) => l.slug).filter(Boolean)),
        items: JSON.stringify(items),
      },
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("Payment intent error:", err);
    return NextResponse.json({ error: err.message || "Payment failed" }, { status: 500 });
  }
}
