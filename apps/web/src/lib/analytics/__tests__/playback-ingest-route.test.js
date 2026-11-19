import assert from "node:assert/strict";
import { register } from "node:module";
import test, { mock } from "node:test";

// next/server has no ESM entry; resolve it like the other route tests do.
register("data:text/javascript," + encodeURIComponent('export function resolve(s,c,n){return n(s === "next/server" ? "next/server.js" : s,c);}'), import.meta.url);

// The real /api/media/playback route against a fake database, session and limiter.
let sessionUser = null;
let schemaV1 = true;
let limiterCalls = [];
let db;

function fakeDb() {
  const state = { events: [], progress: [], calls: [] };
  const products = { "love-hz-vol-1": "prod-album", w2d: "prod-single" };
  const from = (table) => {
    const filters = [];
    const q = {
      select: () => q,
      eq: (col, val) => { filters.push([col, val]); return q; },
      maybeSingle: async () => {
        if (table === "products") {
          const slug = filters.find(([c]) => c === "slug")?.[1];
          return { data: products[slug] ? { id: products[slug] } : null, error: null };
        }
        return { data: null, error: null };
      },
      upsert: async (rows, opts) => {
        state.calls.push({ table, op: "upsert", opts });
        if (table === "media_playback_progress") { state.progress.push(rows); return { error: null }; }
        if (!schemaV1) return { error: { code: "PGRST204", message: "Could not find the 'access_tier' column of 'media_stream_events'" } };
        for (const row of rows) {
          if (row.event_id && state.events.some((e) => e.event_id === row.event_id)) continue; // ON CONFLICT DO NOTHING
          state.events.push(row);
        }
        return { error: null };
      },
      insert: async (rows) => {
        state.calls.push({ table, op: "insert" });
        for (const row of rows) {
          if ("event_id" in row || "access_tier" in row) return { error: { code: "PGRST204", message: "legacy table" } };
          state.events.push(row);
        }
        return { error: null };
      },
    };
    return q;
  };
  return { state, client: { from } };
}

mock.module("@/lib/auth/session-user", { namedExports: { getFanSessionUser: async () => sessionUser } });
mock.module("@/lib/supabase/admin", { namedExports: { getAdminClient: () => db.client } });
mock.module("@/lib/server/rate-limit", { namedExports: {
  checkRateLimit: async (_req, opts) => { limiterCalls.push(opts); return { allowed: true, limited: false }; },
  rateLimitResponse: () => new Response(null, { status: 429 }),
} });
mock.module("@/lib/server/media-cors", { namedExports: {
  applyMediaCors: (_req, res) => res,
  mediaCorsPreflightResponse: () => new Response(null, { status: 204 }),
} });

const { POST } = await import("@/app/api/media/playback/route.js");

function req(body, extraHeaders = {}) {
  return new Request("https://www.2mrrw.com/api/media/playback", {
    method: "POST",
    headers: { "content-type": "application/json", "x-vercel-ip-country": "US", "x-vercel-ip-country-region": "TX", "x-vercel-ip-city": "Austin", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function reset({ user = null, v1 = true } = {}) {
  db = fakeDb();
  sessionUser = user;
  schemaV1 = v1;
  limiterCalls = [];
}

const EVENT_ID = "3f2b8c1e-9d4a-4b7e-8f21-0c5d6e7f8a9b";

test("a signed-in fan's play is stored with their user id (the session decides, not the guest cookie)", async () => {
  reset({ user: { id: "fan-1", isGuest: false, isAdmin: false } });
  const res = await POST(req({ slug: "w2d", eventType: "play", eventId: EVENT_ID }));
  assert.equal(res.status, 200);
  assert.equal(db.state.events.length, 1);
  assert.equal(db.state.events[0].user_id, "fan-1");
  assert.equal(db.state.events[0].is_internal, false);
});

test("state/region is stored from Vercel's country-region header", async () => {
  reset();
  await POST(req({ slug: "w2d", eventType: "play" }));
  assert.equal(db.state.events[0].region, "TX");
  assert.equal(db.state.events[0].country, "US");
});

test("the rate limit is keyed by the listener, never by the song", async () => {
  reset({ user: { id: "fan-1" } });
  await POST(req({ slug: "w2d", eventType: "play" }));
  assert.equal(limiterCalls[0].identifier, "user:fan-1");
  reset();
  await POST(req({ slug: "w2d", eventType: "play" }));
  assert.equal(limiterCalls[0].identifier, undefined, "anonymous listeners fall back to their own IP");
  assert.notEqual(limiterCalls[0].identifier, "w2d");
});

test("an admin's listening is stored but flagged internal", async () => {
  reset({ user: { id: "admin-1", isAdmin: true } });
  await POST(req({ slug: "w2d", eventType: "complete", accessTier: "full" }));
  assert.equal(db.state.events[0].is_internal, true);
  assert.equal(db.state.events[0].access_tier, "admin");
});

test("a resume-position sync stores no listening event", async () => {
  reset();
  const res = await POST(req({ slug: "w2d", eventType: "progress", positionSync: true, positionSeconds: 40 }));
  assert.equal(res.status, 200);
  assert.equal(db.state.events.length, 0);
});

test("the same event delivered twice (retry / offline replay) is stored once", async () => {
  reset();
  await POST(req({ slug: "w2d", eventType: "play", eventId: EVENT_ID }));
  await POST(req({ slug: "w2d", eventType: "play", eventId: EVENT_ID }));
  assert.equal(db.state.events.length, 1);
  assert.deepEqual(db.state.calls.find((c) => c.table === "media_stream_events").opts, { onConflict: "event_id", ignoreDuplicates: true });
});

test("an offline outbox batch is stored in one request, with product ids resolved per release", async () => {
  reset();
  const events = [
    { slug: "love-hz-vol-1", albumSlug: "love-hz-vol-1", trackSlug: "08-knock-on-wood", eventType: "play", offline: true },
    { slug: "love-hz-vol-1", albumSlug: "love-hz-vol-1", trackSlug: "08-knock-on-wood", eventType: "qualified", offline: true },
    { slug: "w2d", eventType: "download" },
  ];
  const res = await POST(req({ events }));
  assert.equal((await res.json()).stored, 3);
  assert.deepEqual(db.state.events.map((e) => e.product_id), ["prod-album", "prod-album", "prod-single"]);
  assert.ok(db.state.events.every((e) => e.region === "TX"));
  assert.equal(db.state.events[0].offline, true);
});

test("before the v1 migration is applied, events are still stored as legacy rows", async () => {
  reset({ v1: false, user: { id: "fan-1" } });
  const res = await POST(req({ events: [
    { slug: "w2d", eventType: "play" },
    { slug: "w2d", eventType: "qualified" },
    { slug: "w2d", eventType: "download" },
  ] }));
  assert.equal(res.status, 200);
  assert.deepEqual(db.state.events.map((e) => e.event_type), ["play", "progress"], "download has no legacy form and is skipped");
  assert.equal(db.state.events[0].user_id, "fan-1");
  assert.equal(db.state.events[0].region, "TX");
});

test("legacy guest sessions still get their resume position saved; signed-in fans' resume behavior is unchanged", async () => {
  reset({ user: { id: "guest-1", isGuest: true } });
  await POST(req({ slug: "w2d", eventType: "progress", positionSeconds: 12, durationSeconds: 100 }));
  assert.equal(db.state.progress.length, 1);
  reset({ user: { id: "fan-1", isGuest: false } });
  await POST(req({ slug: "w2d", eventType: "progress", positionSeconds: 12, durationSeconds: 100 }));
  assert.equal(db.state.progress.length, 0);
});

test("a request without a slug is rejected", async () => {
  reset();
  const res = await POST(req({ eventType: "play" }));
  assert.equal(res.status, 400);
});
