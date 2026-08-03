import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const rl = await checkRateLimit(req, { routeKey: "public.events", limit: 30, windowSeconds: 60 });
  if (rl.limited) return rateLimitResponse(rl.retryAfterSeconds);
  try {
    const admin = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await admin
      .from("shows_events")
      .select("id, name, location, event_date, event_time, price_cents, tickets_available, ticket_url")
      .eq("active", true)
      .gte("event_date", today)
      .order("event_date", { ascending: true });

    if (error) throw error;

    const events = (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      location: row.location,
      date: row.event_date,
      time: row.event_time,
      price: row.price_cents / 100,
      tickets: row.tickets_available,
      ticketUrl: row.ticket_url || null,
    }));

    return NextResponse.json({ events });
  } catch (err) {
    console.error("public events error:", err);
    return NextResponse.json({ events: [], fallback: true });
  }
}
