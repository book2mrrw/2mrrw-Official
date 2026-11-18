import { showStartsAt } from "@/lib/shows/show-time";

/**
 * The one reader of upcoming events for the storefront: the home page's first
 * render, /api/shows and the 2MRRW Live countdown all see the same list.
 */

const COLUMNS = "id, name, location, event_date, event_time, venue_timezone, price_cents, tickets_available, event_type";
const DEFAULT_TIMEZONE = "America/Chicago";

/** Today's date at the earliest time zone, so no venue's today is filtered out. */
function earliestToday(now) {
  return new Date(now.getTime() - 14 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The storefront shape of an event row. */
export function toPublicShow(row) {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    date: row.event_date,
    time: row.event_time || "",
    venueTz: row.venue_timezone || DEFAULT_TIMEZONE,
    price: row.price_cents / 100,
    tickets: row.tickets_available,
    eventType: row.event_type === "live" ? "live" : "show",
  };
}

/** Active events from today on, soonest first. */
export async function fetchUpcomingShows(admin, now = new Date()) {
  const { data, error } = await admin
    .from("shows_events")
    .select(COLUMNS)
    .eq("active", true)
    .gte("event_date", earliestToday(now))
    .order("event_date", { ascending: true });
  if (error) throw error;
  return (data || []).map(toPublicShow);
}

/**
 * The next 2MRRW Live event that has not started yet, with the instant it
 * starts at its venue — what the homepage countdown counts down to.
 */
export async function fetchNextLiveEvent(admin, now = new Date()) {
  const { data, error } = await admin
    .from("shows_events")
    .select(COLUMNS)
    .eq("active", true)
    .eq("event_type", "live")
    .gte("event_date", earliestToday(now))
    .order("event_date", { ascending: true })
    .limit(20);
  if (error) throw error;
  const next = (data || [])
    .map((row) => ({ row, startsAt: showStartsAt(row.event_date, row.event_time, row.venue_timezone || DEFAULT_TIMEZONE) }))
    .filter(({ startsAt }) => startsAt && startsAt.getTime() > now.getTime())
    .sort((a, b) => a.startsAt - b.startsAt)[0];
  if (!next) return null;
  return {
    id: next.row.id,
    title: next.row.name,
    location: next.row.location,
    startsAt: next.startsAt.toISOString(),
  };
}
