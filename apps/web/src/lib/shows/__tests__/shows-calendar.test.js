import assert from "node:assert/strict";
import { register } from "node:module";
import test, { mock } from "node:test";
import { formatShowTime, parseShowTime, showStartsAt } from "../show-time.js";
import { fetchNextLiveEvent, fetchUpcomingShows } from "../upcoming-shows.js";

// next/server has no ESM entry; resolve it like the ticket route tests do.
register("data:text/javascript," + encodeURIComponent('export function resolve(s,c,next){return next(s==="next/server"?"next/server.js":s,c);}'), import.meta.url);

// A shows_events table that answers the query builder calls the readers make.
function fakeShowsDb(rows, { error = null } = {}) {
  const queries = [];
  return {
    queries,
    from(table) {
      const query = { table, eq: [], gte: [], order: null, limit: null };
      queries.push(query);
      const builder = {
        select: () => builder,
        eq: (col, val) => { query.eq.push([col, val]); return builder; },
        gte: (col, val) => { query.gte.push([col, val]); return builder; },
        order: (col) => { query.order = col; return builder; },
        limit: (n) => { query.limit = n; return builder; },
        then: (resolve) => {
          const data = rows
            .filter((row) => query.eq.every(([col, val]) => row[col] === val))
            .filter((row) => query.gte.every(([col, val]) => row[col] >= val))
            .sort((a, b) => a.event_date.localeCompare(b.event_date))
            .slice(0, query.limit ?? rows.length);
          return resolve(error ? { data: null, error } : { data, error: null });
        },
      };
      return builder;
    },
  };
}

const live = (id, event_date, event_time, venue_timezone, extra = {}) => ({
  id, name: "2MRRW Live", location: "Dallas, TX", event_date, event_time, venue_timezone,
  price_cents: 0, tickets_available: null, active: true, event_type: "live", ...extra,
});

test("show times read the way admins type them", () => {
  assert.equal(parseShowTime("8:00 PM"), 20 * 60);
  assert.equal(parseShowTime("6:00pm"), 18 * 60);
  assert.equal(parseShowTime("8pm"), 20 * 60);
  assert.equal(parseShowTime("12:30 AM"), 30);
  assert.equal(parseShowTime("12:00 PM"), 12 * 60);
  assert.equal(parseShowTime("20:00"), 20 * 60);
  for (const bad of ["", null, "25:00", "13:00 PM", "soon"]) assert.equal(parseShowTime(bad), null, String(bad));
});

test("a show starts at its venue's wall clock, across DST and far-east dates", () => {
  assert.equal(showStartsAt("2026-12-05", "8:00 PM", "America/Chicago").toISOString(), "2026-12-06T02:00:00.000Z");
  assert.equal(showStartsAt("2026-07-04", "20:00", "America/Chicago").toISOString(), "2026-07-05T01:00:00.000Z");
  assert.equal(showStartsAt("2026-12-05", "9:00 AM", "Asia/Tokyo").toISOString(), "2026-12-05T00:00:00.000Z");
  assert.equal(showStartsAt("2026-12-05", "6:00pm", "Pacific/Auckland").toISOString(), "2026-12-05T05:00:00.000Z");
  assert.equal(showStartsAt("2026-12-05", "", "America/Chicago"), null);
  assert.equal(showStartsAt("Dec 5", "8:00 PM", "America/Chicago"), null);
});

test("show times show the venue's clock, plus the viewer's when they are elsewhere", () => {
  assert.equal(formatShowTime("2026-12-05", "8:00 PM", "America/Chicago", "America/Chicago"), "8:00 PM CST");
  assert.equal(formatShowTime("2026-12-05", "8:00 PM", "America/Chicago", "America/New_York"), "8:00 PM CST · 9:00 PM EST your time");
  assert.equal(formatShowTime("2026-12-05", "doors at 8", "America/Chicago", "America/New_York"), "doors at 8");
});

test("the countdown follows the next 2MRRW Live event that has not started, whatever its venue", async () => {
  const now = new Date("2026-12-05T20:00:00Z"); // 2:00 PM in Dallas
  const db = fakeShowsDb([
    live("yesterday", "2026-12-04", "8:00 PM", "America/Chicago"),
    live("started", "2026-12-05", "1:00 PM", "America/Chicago"),
    live("dallas-tonight", "2026-12-05", "9:00 PM", "America/Chicago"),
    live("nyc-tonight", "2026-12-05", "7:00 PM", "America/New_York", { name: "2MRRW Live", location: "New York, NY" }),
    live("no-time", "2026-12-05", "", "America/Chicago"),
    live("hidden", "2026-12-05", "3:00 PM", "America/Chicago", { active: false }),
    { ...live("ticketed", "2026-12-05", "3:00 PM", "America/Chicago"), event_type: "show", name: "2Day It Begins" },
  ]);
  assert.deepEqual(await fetchNextLiveEvent(db, now), {
    id: "nyc-tonight", title: "2MRRW Live", location: "New York, NY", startsAt: "2026-12-06T00:00:00.000Z",
  });
  assert.deepEqual(db.queries[0].eq, [["active", true], ["event_type", "live"]]);
  assert.equal(await fetchNextLiveEvent(fakeShowsDb([live("started", "2026-12-05", "1:00 PM", "America/Chicago")]), now), null);
  await assert.rejects(fetchNextLiveEvent(fakeShowsDb([], { error: new Error("down") }), now), /down/);
});

test("upcoming shows carry their type, venue time zone and price for the storefront", async () => {
  const now = new Date("2026-12-05T20:00:00Z");
  const shows = await fetchUpcomingShows(fakeShowsDb([
    live("yesterday", "2026-12-04", "8:00 PM", "America/Chicago"),
    { ...live("ticketed", "2026-12-20", "7:00 PM", null), event_type: "show", name: "2Day It Begins", price_cents: 2500, tickets_available: 100 },
    live("dallas", "2026-12-06", "9:00 PM", "America/Chicago"),
  ]), now);
  assert.deepEqual(shows, [
    { id: "dallas", name: "2MRRW Live", location: "Dallas, TX", date: "2026-12-06", time: "9:00 PM", venueTz: "America/Chicago", price: 0, tickets: null, eventType: "live" },
    { id: "ticketed", name: "2Day It Begins", location: "Dallas, TX", date: "2026-12-20", time: "7:00 PM", venueTz: "America/Chicago", price: 25, tickets: 100, eventType: "show" },
  ]);
});

test("the livestream state carries the next 2MRRW Live event only while nothing is live or scheduled in the studio", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-12-05T20:00:00Z") });
  let broadcast = null;
  let db = fakeShowsDb([live("dallas-tonight", "2026-12-05", "9:00 PM", "America/Chicago")]);
  mock.module("next/server", { namedExports: { NextResponse: { json: (body, init) => Response.json(body, init) } } });
  mock.module("@/lib/guest-session", { namedExports: { getRequestUser: async () => null } });
  mock.module("@/lib/auth/constants", { namedExports: { isAdminUser: () => false } });
  mock.module("@/lib/entitlements", { namedExports: { getUserEntitlements: async () => null } });
  mock.module("@/lib/supabase/admin", { namedExports: { getAdminClient: () => db } });
  mock.module("@/lib/server/livestream", { namedExports: { getCurrentBroadcast: async () => broadcast } });
  mock.module("@/lib/server/live-access", { namedExports: { resolveLiveBroadcastAccess: async () => ({ access: "free" }) } });
  const { GET } = await import("../../../app/api/public/livestream/route.js");

  const idle = await (await GET()).json();
  assert.deepEqual(idle.scheduledEvent, { id: "dallas-tonight", title: "2MRRW Live", location: "Dallas, TX", startsAt: "2026-12-06T03:00:00.000Z" });
  assert.equal(idle.broadcast, null);

  db = fakeShowsDb([], { error: new Error("down") });
  t.mock.method(console, "error", () => {});
  const unreadable = await GET();
  assert.equal(unreadable.status, 200, "a calendar outage never takes the live state down");
  assert.equal((await unreadable.json()).scheduledEvent, null);

  broadcast = { id: "b-1", audience: "all", is_live: false, goes_live_at: "2026-12-06T01:00:00.000Z", provider_status: "offline" };
  const studio = await (await GET()).json();
  assert.equal(studio.broadcast.goes_live_at, "2026-12-06T01:00:00.000Z");
  assert.equal("scheduledEvent" in studio, false, "a studio broadcast outranks the calendar");
});
