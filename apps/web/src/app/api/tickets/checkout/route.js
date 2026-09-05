import { NextResponse } from "next/server";
import { getStripe } from "@/lib/commerce/stripe";
import { getRequestUser } from "@/lib/guest-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export async function POST(req) {
  try {
    const user = await getRequestUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in to purchase tickets" }, { status: 401 });
    }

    const rl = await checkRateLimit(req, {
      routeKey: "tickets.checkout",
      limit: 10,
      windowSeconds: 600,
      identifier: user.id,
    });
    if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

    const { showId, quantity = 1 } = await req.json();
    if (!showId) return NextResponse.json({ error: "Missing showId" }, { status: 400 });

    const admin = getAdminClient();

    // Fetch show
    const { data: show, error: showErr } = await admin
      .from("shows_events")
      .select("id, name, location, event_date, event_time, price_cents, tickets_available, active")
      .eq("id", showId)
      .single();

    if (showErr || !show) return NextResponse.json({ error: "Show not found" }, { status: 404 });
    if (!show.active) return NextResponse.json({ error: "This show is no longer available" }, { status: 400 });
    if (show.tickets_available !== null && show.tickets_available <= 0) {
      return NextResponse.json({ error: "This show is sold out" }, { status: 400 });
    }

    // Check if user already has a ticket
    const { data: existing } = await admin
      .from("ticket_purchases")
      .select("id")
      .eq("user_id", user.id)
      .eq("show_id", showId)
      .eq("status", "paid")
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "You already have a ticket for this show" }, { status: 400 });
    }

    const qty = Math.max(1, Math.min(4, Number(quantity) || 1));
    const unitAmount = show.price_cents;
    const showDate = new Date(show.event_date).toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
    });

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: unitAmount * qty,
      currency: "usd",
      receipt_email: user.email || undefined,
      // Payment stays on this page — no redirect to a Stripe-hosted checkout page.
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: {
        payment_kind: "ticket",
        show_id: show.id,
        user_id: user.id,
        guest_user_id: user.id,
        email: user.email || "",
        phone: user.phone || "",
        quantity: String(qty),
        show_name: show.name,
        show_location: show.location,
        show_date: show.event_date,
        show_time: show.event_time || "",
        price_cents: String(unitAmount),
      },
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("[tickets/checkout] error:", err);
    return NextResponse.json({ error: err.message || "Checkout failed" }, { status: 500 });
  }
}
