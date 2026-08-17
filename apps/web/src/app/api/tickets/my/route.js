import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/guest-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const user = await getRequestUser();
    if (!user) return NextResponse.json({ tickets: [] });

    const rl = await checkRateLimit(req, { routeKey: "tickets.my", limit: 30, windowSeconds: 60 });
    if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);

    const admin = getAdminClient();
    const { data, error } = await admin
      .from("ticket_purchases")
      .select("id, show_id, quantity, price_cents, status, created_at, shows_events(id, name, location, event_date, event_time)")
      .eq("user_id", user.id)
      .eq("status", "paid")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const tickets = (data || []).map((row) => ({
      id: row.id,
      showId: row.show_id,
      quantity: row.quantity,
      priceCents: row.price_cents,
      status: row.status,
      purchasedAt: row.created_at,
      show: row.shows_events
        ? {
            id: row.shows_events.id,
            name: row.shows_events.name,
            location: row.shows_events.location,
            date: row.shows_events.event_date,
            time: row.shows_events.event_time,
          }
        : null,
    }));

    return NextResponse.json({ tickets });
  } catch (err) {
    console.error("[tickets/my] error:", err);
    return NextResponse.json({ tickets: [] });
  }
}
