import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = getAdminClient();
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await admin
      .from("shows_events")
      .select("id, name, location, event_date, event_time, venue_timezone, price_cents, tickets_available")
      .eq("active", true)
      .gte("event_date", today)
      .order("event_date", { ascending: true });

    if (error) throw error;

    const shows = (data || []).map((s) => ({
      id: s.id,
      name: s.name,
      location: s.location,
      date: s.event_date,
      time: s.event_time || "",
      venueTz: s.venue_timezone || "America/Chicago",
      price: s.price_cents / 100,
      tickets: s.tickets_available,
    }));

    return NextResponse.json({ shows });
  } catch {
    return NextResponse.json({ shows: [] });
  }
}
