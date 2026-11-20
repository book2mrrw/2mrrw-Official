import assert from "node:assert/strict";
import { register } from "node:module";
import test, { mock } from "node:test";

register("data:text/javascript," + encodeURIComponent('export function resolve(s,c,n){return n(s === "next/server" ? "next/server.js" : s,c);}'), import.meta.url);

// The real admin analytics routes against a fake database.
let sessionUser = { id: "admin-1", email: "admin@2mrrw.com" };
let isAdmin = true;
let rpcCalls = [];
let failRpc = null;

function query(rows) {
  const q = {
    select: () => q, eq: () => q, in: () => q, gte: () => q, lt: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve) => resolve({ data: rows, error: null }),
  };
  return q;
}

const RPC_DATA = {
  analytics_overview: [{ plays: 9, qualified_plays: 4, listeners: 3, fans: 1, listen_seconds: 400, first_event_at: "2026-08-17T00:00:00Z" }],
  analytics_track_stats: [{ product_id: "sgl", song_slug: null, plays: 9, qualified_plays: 4, completes: 2, listeners: 3, completion_rate: 0.22 }],
  analytics_listener_growth: [],
  analytics_fan_demographics: [{ dimension: "total", value: "all", fans: 1 }],
  analytics_geo: [{ level: "country", country: "US", region: null, city: null, plays: 9, qualified_plays: 4, listeners: 3 }],
};

const admin = {
  rpc: (name, args) => {
    rpcCalls.push({ name, args });
    const result = failRpc === name ? { data: null, error: { message: "boom" } } : { data: RPC_DATA[name] ?? [], error: null };
    return { maybeSingle: async () => ({ ...result, data: result.data?.[0] ?? null }), then: (resolve) => resolve(result) };
  },
  from: (table) => query(table === "products" ? [{ id: "sgl", slug: "w2d", title: "W2D", product_type: "single", cover_url: "/c" }] : []),
};

mock.module("@/lib/auth/admin-api-guard", { namedExports: { getAdminSessionUser: async () => sessionUser } });
mock.module("@/lib/auth/constants", { namedExports: { isAdminUser: () => isAdmin } });
mock.module("@/lib/supabase/admin", { namedExports: { getAdminClient: () => admin } });
mock.module("@/lib/server/rate-limit", { namedExports: {
  checkRateLimit: async () => ({ allowed: true, limited: false }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
} });

const overviewRoute = await import("@/app/api/admin/analytics/route.js");
const globalRoute = await import("@/app/api/admin/analytics/global/route.js");

function reset() { rpcCalls = []; failRpc = null; isAdmin = true; sessionUser = { id: "admin-1" }; }
const get = (route, qs = "") => route.GET(new Request(`https://www.2mrrw.com/api/admin/analytics${qs}`));

test("only admins can read analytics", async () => {
  reset();
  isAdmin = false;
  assert.equal((await get(overviewRoute)).status, 401);
  assert.equal((await get(globalRoute)).status, 401);
  assert.equal(rpcCalls.length, 0, "no query runs for a non-admin");
});

test("the dashboard defaults to lifetime: every SQL function gets an open window", async () => {
  reset();
  const res = await get(overviewRoute);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.range, "all");
  for (const name of ["analytics_overview", "analytics_track_stats", "analytics_fan_demographics"]) {
    assert.deepEqual(rpcCalls.find((c) => c.name === name).args, { p_from: null, p_to: null }, name);
  }
  assert.equal(body.overview.totalPlays, 9);
  assert.equal(body.overview.qualifiedPlays, 4);
  assert.equal(body.tracks.find((t) => t.slug === "w2d").completionRate, 22);
  assert.equal(res.headers.get("cache-control"), "private, no-store, must-revalidate");
});

test("a chosen range reaches the SQL", async () => {
  reset();
  await get(overviewRoute, "?range=7d");
  const args = rpcCalls.find((c) => c.name === "analytics_overview").args;
  assert.ok(args.p_from && Date.now() - Date.parse(args.p_from) - 7 * 864e5 < 60_000);
  assert.equal(args.p_to, null);
});

test("a failed analytics query is an error, never a dashboard of silent zeros", async () => {
  reset();
  failRpc = "analytics_track_stats";
  assert.equal((await get(overviewRoute)).status, 500);
  failRpc = "analytics_geo";
  assert.equal((await get(globalRoute)).status, 500);
});

test("the map asks SQL for the chosen window plus both fixed 30-day growth windows", async () => {
  reset();
  const res = await get(globalRoute, "?since=2026-01-01T00:00:00Z");
  assert.equal(res.status, 200);
  const geoCalls = rpcCalls.filter((c) => c.name === "analytics_geo").map((c) => c.args);
  assert.equal(geoCalls.length, 3);
  assert.deepEqual(geoCalls[0], { p_from: "2026-01-01T00:00:00.000Z", p_to: null });
  const span = (a) => Date.parse(a.p_to) - Date.parse(a.p_from);
  assert.equal(span(geoCalls[1]), 30 * 864e5);
  assert.equal(span(geoCalls[2]), 30 * 864e5);
  const body = await res.json();
  assert.equal(body.by_country[0].country, "United States");
  assert.equal(body.overview.total_streams, 9);
});

test("before the revenue-ledger migration, the dashboard falls back instead of failing", async () => {
  reset();
  const realRpc = admin.rpc;
  admin.rpc = (name, args) => (name === "analytics_revenue_summary"
    ? { maybeSingle: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.analytics_revenue_summary" } }) }
    : realRpc(name, args));
  try {
    const res = await get(overviewRoute);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).overview.totalRevenueCents, 0, "falls back to completed purchases (none in this fixture)");
  } finally {
    admin.rpc = realRpc;
  }
});
