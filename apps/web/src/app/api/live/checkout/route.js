import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import { getRequestUser } from "@/lib/guest-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getCurrentBroadcast } from "@/lib/server/livestream";
import { resolveLiveBroadcastAccess } from "@/lib/server/live-access";
import { isAllowedLivePpvAmount } from "@/lib/live/ppv-pricing";

export const dynamic = "force-dynamic";

const siteUrl = () =>
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  "http://localhost:3000";

export async function POST(req) {
  try {
    const user = await getRequestUser();
    // A guest-session cookie is not a real account — force real signup
    // before a price is ever shown, same rule the access resolver applies.
    if (!user || user.isGuest) {
      return NextResponse.json({ error: "signup_required" }, { status: 401 });
    }

    const rl = await checkRateLimit(req, {
      routeKey: "live.checkout",
      limit: 10,
      windowSeconds: 600,
      identifier: user.id,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

    const { amountCents } = await req.json();
    if (!isAllowedLivePpvAmount(amountCents)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const admin = getAdminClient();
    const broadcast = await getCurrentBroadcast(admin);
    if (!broadcast) {
      return NextResponse.json({ error: "No live event is available right now" }, { status: 404 });
    }

    const access = await resolveLiveBroadcastAccess({ admin, user, broadcast });
    if (access.access === "free") {
      return NextResponse.json({ error: "You already have access to this live event" }, { status: 400 });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email || undefined,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: `Live Access — ${broadcast.title}`,
          },
        },
      }],
      success_url: `${siteUrl()}/?live=unlocked`,
      cancel_url: `${siteUrl()}/`,
      metadata: {
        payment_kind: "live_ppv",
        broadcast_id: broadcast.id,
        user_id: user.id,
        amount_cents: String(amountCents),
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[live/checkout] error:", err);
    return NextResponse.json({ error: err.message || "Checkout failed" }, { status: 500 });
  }
}
