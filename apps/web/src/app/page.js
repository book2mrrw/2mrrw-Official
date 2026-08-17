import { getAdminClient } from "@/lib/supabase/admin";
import HomeClient from "./HomeClient";

// Revalidate the page every hour so events stay fresh without a full rebuild.
export const revalidate = 3600;

const FALLBACK_EVENTS = [
  { id:"evt-1", name:"2MRRW Live – Dallas",  location:"Dallas, TX",      date:"2026-05-10", time:"8:00 PM", price:25.00, tickets:50 },
  { id:"evt-2", name:"2MRRW Live – Houston", location:"Houston, TX",     date:"2026-05-24", time:"9:00 PM", price:25.00, tickets:75 },
  { id:"evt-3", name:"2MRRW Live – Atlanta", location:"Atlanta, GA",     date:"2026-06-07", time:"8:30 PM", price:30.00, tickets:60 },
  { id:"evt-4", name:"2MRRW Live – LA",      location:"Los Angeles, CA", date:"2026-06-21", time:"9:00 PM", price:35.00, tickets:40 },
  { id:"evt-5", name:"2MRRW Live – NYC",     location:"New York, NY",    date:"2026-07-04", time:"8:00 PM", price:35.00, tickets:45 },
];

async function fetchEvents() {
  try {
    const admin = getAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await admin
      .from("shows_events")
      .select("id, name, location, event_date, event_time, price_cents, tickets_available, ticket_url")
      .eq("active", true)
      .gte("event_date", today)
      .order("event_date", { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      location: row.location,
      date: row.event_date,
      time: row.event_time,
      price: row.price_cents / 100,
      tickets: row.tickets_available,
      ticketUrl: row.ticket_url || null,
    }));
  } catch {
    return null;
  }
}

export default async function Page() {
  const events = await fetchEvents();
  return <HomeClient initialEvents={events ?? FALLBACK_EVENTS} />;
}
