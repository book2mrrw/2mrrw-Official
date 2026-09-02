import { getAdminClient } from "@/lib/supabase/admin";
import { getStorefrontCatalogFromDB } from "@/lib/media/catalog-db";
import HomeClient from "./HomeClient";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireConsumerPrincipal } from "@/lib/auth/consumer-authority";
import { loginRedirectPath } from "@/lib/auth/route-access-policy";

// Revalidate the page every hour so events stay fresh without a full rebuild.
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  const principal = await requireConsumerPrincipal();
  if (!principal) redirect(loginRedirectPath("/"));

  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "www.2mrrw.com";
  const requestedParent = forwardedHost.split(",")[0].trim().split(":")[0].toLowerCase();
  const twitchEmbedParent = requestedParent === "www.2mrrw.com" || requestedParent === "localhost" || requestedParent.endsWith(".vercel.app")
    ? requestedParent
    : "www.2mrrw.com";
  const twitchBroadcasterLogin = /^[a-zA-Z0-9_]{1,25}$/.test(process.env.TWITCH_BROADCASTER_LOGIN || "")
    ? process.env.TWITCH_BROADCASTER_LOGIN
    : "callme2mrrw";

  // Fetch in parallel — catalog DB failure is non-fatal (HomeClient falls back to hardcoded arrays).
  const [events, initialCatalog] = await Promise.all([
    fetchEvents(),
    getStorefrontCatalogFromDB(),
  ]);
  return (
    <HomeClient
      initialEvents={events ?? FALLBACK_EVENTS}
      initialCatalog={initialCatalog}
      twitchEmbedParent={twitchEmbedParent}
      twitchBroadcasterLogin={twitchBroadcasterLogin}
    />
  );
}
