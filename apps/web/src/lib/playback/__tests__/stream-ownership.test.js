import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Stream rows are written with the service-role client (RLS bypassed) using ids the
// browser sends back. These tests pin that every write is scoped to the caller, and
// that a selected-track preview keeps its track identity through the proxy URL.

register(
  "data:text/javascript," +
    encodeURIComponent('export function resolve(s,c,next){return next(s==="next/server"?"next/server.js":s,c);}'),
  import.meta.url
);

/** Minimal in-memory Supabase query builder covering the calls stream-pipeline makes. */
function createFakeAdmin(tables) {
  return {
    from(table) {
      const rows = (tables[table] ??= []);
      const filters = [];
      let kind = "select";
      let values = null;
      let order = null;
      let limit = null;
      let singleMode = null;
      const run = () => {
        const matching = rows.filter((row) => filters.every((keep) => keep(row)));
        if (kind === "delete") {
          for (const row of matching) rows.splice(rows.indexOf(row), 1);
          return { data: null, error: null };
        }
        if (kind === "update") {
          for (const row of matching) Object.assign(row, values);
          return { data: null, error: null };
        }
        if (kind === "insert") {
          const row = { ...values };
          rows.push(row);
          return { data: row, error: null };
        }
        let data = [...matching];
        if (order) {
          data.sort((a, b) => (a[order.column] < b[order.column] ? -1 : a[order.column] > b[order.column] ? 1 : 0));
          if (!order.ascending) data.reverse();
        }
        if (limit != null) data = data.slice(0, limit);
        if (singleMode) return { data: data[0] ?? null, error: null };
        return { data, error: null };
      };
      const builder = {
        select() { return builder; },
        insert(next) { kind = "insert"; values = next; return builder; },
        update(next) { kind = "update"; values = next; return builder; },
        delete() { kind = "delete"; return builder; },
        eq(column, value) { filters.push((row) => row[column] === value); return builder; },
        is(column, value) { filters.push((row) => (row[column] ?? null) === value); return builder; },
        gte(column, value) { filters.push((row) => row[column] >= value); return builder; },
        gt(column, value) { filters.push((row) => row[column] > value); return builder; },
        order(column, { ascending = true } = {}) { order = { column, ascending }; return builder; },
        limit(count) { limit = count; return builder; },
        maybeSingle() { singleMode = "maybe"; return builder; },
        single() { singleMode = "single"; return builder; },
        then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
      };
      return builder;
    },
  };
}

let tables;
let admin;
let currentUser;
let previewTrackRequests;

mock.module("@/lib/supabase/admin", { namedExports: { getAdminClient: () => admin } });
mock.module("@/lib/auth/session-user", { namedExports: { getFanSessionUser: async () => currentUser } });
mock.module("@/lib/guest-session", { namedExports: { getGuestUser: async () => null } });
mock.module("@/lib/server/rate-limit", {
  namedExports: {
    checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    rateLimitResponse: () => new Response(null, { status: 429 }),
  },
});
mock.module("@/lib/auth/constants", { namedExports: { isAdminUser: () => false } });
mock.module("@/lib/commerce/entitlements", {
  namedExports: { userCanStreamProduct: async () => false, membershipHasPremiumAccess: () => false },
});
mock.module("@/lib/releases/release-availability-server", {
  namedExports: { resolveReleaseAccessForProduct: async () => ({ availability: null }) },
});
mock.module("@/lib/playback/release-default-track", {
  namedExports: { resolveReleaseDefaultTrackSlug: async () => "01-default-track" },
});
mock.module("@/lib/playback/resolve-playback-key", {
  namedExports: {
    resolvePlaybackKey: async () => null,
    resolvePreviewKey: async (_admin, slug, { trackSlug } = {}) => {
      previewTrackRequests.push(trackSlug ?? null);
      return `previews/${slug}/${trackSlug}.mp3`;
    },
    clearPlaybackKeyCache: () => {},
    clearPersistedPlaybackKey: async () => {},
  },
});
mock.module("@/lib/playback/stream-url-cache", {
  namedExports: { getOrCreateStreamSignedUrl: async () => ({ url: "https://fixture.invalid/signed", cacheHit: false }) },
});
mock.module("@/lib/storage/r2", { namedExports: { createR2SignedGetUrl: async () => "https://fixture.invalid/signed" } });
mock.module("@/lib/server/r2-stream-proxy", {
  namedExports: { proxySignedR2Get: async () => new Response("audio", { status: 200 }) },
});
mock.module("@/lib/media/cache-invalidation", { namedExports: { clearMediaResolverCaches: () => {} } });

const { NextRequest } = await import("next/server.js");
const pipeline = await import("@/lib/playback/stream-pipeline");
const libraryStream = await import("../../../app/api/library/stream/route.js");
const streamEnd = await import("../../../app/api/stream/end/route.js");

const VICTIM = "11111111-1111-4111-8111-111111111111";
const ATTACKER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  tables = {
    products: [{ id: "p-1", slug: "love-hz-vol-1" }],
    stream_sessions: [
      { session_id: "s-victim", user_id: VICTIM, product_id: "p-1" },
      { session_id: "s-attacker", user_id: ATTACKER, product_id: "p-1" },
    ],
    stream_events: [
      { id: "e-victim", user_id: VICTIM, product_id: "p-1", ended_at: null, duration_seconds: null, completed: false, created_at: "2026-11-17T10:00:00Z" },
      { id: "e-attacker", user_id: ATTACKER, product_id: "p-1", ended_at: null, duration_seconds: null, completed: false, created_at: "2026-11-17T10:00:01Z" },
    ],
  };
  admin = createFakeAdmin(tables);
  currentUser = null;
  previewTrackRequests = [];
});

const session = (id) => tables.stream_sessions.find((row) => row.session_id === id);
const event = (id) => tables.stream_events.find((row) => row.id === id);

test("clearStreamSession only removes a session owned by the caller", async () => {
  await pipeline.clearStreamSession(admin, ATTACKER, "s-victim");
  assert.ok(session("s-victim"), "another listener's session must survive");

  await pipeline.clearStreamSession(admin, ATTACKER, "s-attacker");
  assert.equal(session("s-attacker"), undefined);
});

test("endStreamEvent cannot rewrite another listener's play", async () => {
  await pipeline.endStreamEvent(admin, ATTACKER, "e-victim", { durationSeconds: 9999, completed: true });
  assert.deepEqual(
    { ended_at: event("e-victim").ended_at, duration_seconds: event("e-victim").duration_seconds, completed: event("e-victim").completed },
    { ended_at: null, duration_seconds: null, completed: false }
  );

  await pipeline.endStreamEvent(admin, VICTIM, "e-victim", { durationSeconds: 42, completed: true });
  assert.equal(event("e-victim").duration_seconds, 42);
  assert.equal(event("e-victim").completed, true);
  assert.ok(event("e-victim").ended_at);
});

test("endStreamEventForUser closes only the caller's open event", async () => {
  await pipeline.endStreamEventForUser(admin, ATTACKER, "p-1", { durationSeconds: 30 });
  assert.equal(event("e-attacker").duration_seconds, 30);
  assert.equal(event("e-victim").ended_at, null);
});

test("stream writes require the owning user and fail closed on the old call shape", async () => {
  await assert.rejects(pipeline.clearStreamSession(admin, null, "s-victim"), TypeError);
  await assert.rejects(pipeline.endStreamEvent(admin, undefined, "e-victim", {}), TypeError);

  // A stale two-argument call lands the id in the userId slot and has no row id left.
  await pipeline.clearStreamSession(admin, "s-victim");
  await pipeline.endStreamEvent(admin, "e-victim");
  assert.ok(session("s-victim"));
  assert.equal(event("e-victim").ended_at, null);
});

test("DELETE /api/library/stream ignores a session id that belongs to someone else", async () => {
  currentUser = { id: ATTACKER };
  const res = await libraryStream.DELETE(
    new NextRequest("https://www.2mrrw.com/api/library/stream?slug=love-hz-vol-1&sessionId=s-victim", { method: "DELETE" })
  );
  assert.equal(res.status, 200);
  assert.ok(session("s-victim"));

  const own = await libraryStream.DELETE(
    new NextRequest("https://www.2mrrw.com/api/library/stream?slug=love-hz-vol-1&sessionId=s-attacker", { method: "DELETE" })
  );
  assert.equal(own.status, 200);
  assert.equal(session("s-attacker"), undefined);
});

test("POST /api/stream/end cannot end or clear another listener's stream", async () => {
  currentUser = { id: ATTACKER };
  const res = await streamEnd.POST(
    new NextRequest("https://www.2mrrw.com/api/stream/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamEventId: "e-victim", sessionId: "s-victim", durationSeconds: 9999, completed: true }),
    })
  );
  assert.equal(res.status, 200);
  assert.equal(event("e-victim").ended_at, null);
  assert.equal(event("e-victim").duration_seconds, null);
  assert.ok(session("s-victim"));

  currentUser = { id: VICTIM };
  await streamEnd.POST(
    new NextRequest("https://www.2mrrw.com/api/stream/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamEventId: "e-victim", sessionId: "s-victim", durationSeconds: 180, completed: true }),
    })
  );
  assert.equal(event("e-victim").duration_seconds, 180);
  assert.equal(session("s-victim"), undefined);
});

test("selected-track preview URL keeps the track the listener chose", async () => {
  currentUser = { id: ATTACKER };
  const res = await libraryStream.GET(
    new NextRequest("https://www.2mrrw.com/api/library/stream?slug=love-hz-vol-1&trackSlug=03-roll-call")
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.preview, true);
  const proxy = new URL(body.url, "https://www.2mrrw.com");
  assert.equal(proxy.pathname, "/api/library/stream");
  assert.equal(proxy.searchParams.get("trackSlug"), "03-roll-call");

  // Following the proxy URL must resolve the same track, not the release default.
  const audio = await libraryStream.GET(new NextRequest(proxy.href));
  assert.equal(audio.status, 200);
  assert.deepEqual(previewTrackRequests, ["03-roll-call", "03-roll-call"]);
});
