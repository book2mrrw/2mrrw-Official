import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlaybackEventRow,
  createListenTracker,
  geoFromHeaders,
  isPreV1SchemaError,
  isQualifiedListen,
  legacyEventType,
  rateLimitIdentity,
} from "@/lib/analytics/playback-events";

const UUID = "3f2b8c1e-9d4a-4b7e-8f21-0c5d6e7f8a9b";
const headers = (h) => new Headers(h);

// ── Qualified plays ──────────────────────────────────────────────────────────

test("a play qualifies at 30 seconds heard, not before", () => {
  assert.equal(isQualifiedListen(29.9, 200), false);
  assert.equal(isQualifiedListen(30, 200), true);
});

test("a song shorter than 30 s qualifies only when heard to the end", () => {
  assert.equal(isQualifiedListen(18, 20), false);
  assert.equal(isQualifiedListen(19.2, 20), true);
});

test("the tracker counts only seconds actually heard: seeks, scrubs and paused time add nothing", () => {
  const t = createListenTracker(() => UUID);
  t.begin("rel:song", 0);
  for (let s = 0.25; s <= 10; s += 0.25) t.advance("rel:song", s); // 10 s of real play
  t.advance("rel:song", 120);                                       // drag to 2:00
  t.advance("rel:song", 125, { playing: false });                  // paused samples
  assert.equal(t.snapshot().listenedSeconds, 10);
  assert.equal(t.snapshot().qualified, false);
});

test("the tracker reports a qualified listen exactly once", () => {
  const t = createListenTracker(() => UUID);
  t.begin("rel:song", 0);
  let fired = 0;
  for (let s = 0.25; s <= 45; s += 0.25) if (t.advance("rel:song", s, { durationSeconds: 180 })) fired += 1;
  assert.equal(fired, 1);
  assert.equal(t.snapshot().qualified, true);
  assert.equal(t.snapshot().listenId, UUID);
});

test("samples for a different recording never count toward the current listen", () => {
  const t = createListenTracker(() => UUID);
  t.begin("rel:a", 0);
  for (let s = 0.25; s <= 40; s += 0.25) t.advance("rel:b", s);
  assert.equal(t.snapshot().listenedSeconds, 0);
});

test("reanchor after a short seek keeps the jump out of listening time", () => {
  const t = createListenTracker(() => UUID);
  t.begin("k", 0);
  t.advance("k", 1);
  t.reanchor("k", 3); // a 2 s forward seek would otherwise count
  t.advance("k", 3.25);
  assert.equal(t.snapshot().listenedSeconds, 1.25);
});

// ── Geography, identity, rate limiting ───────────────────────────────────────

test("region comes from Vercel's x-vercel-ip-country-region header; city is URL-decoded", () => {
  const geo = geoFromHeaders(headers({
    "x-vercel-ip-country": "US",
    "x-vercel-ip-country-region": "TX",
    "x-vercel-ip-city": "San%20Antonio",
  }));
  assert.deepEqual(geo, { country: "US", region: "TX", city: "San Antonio" });
});

test("the old, nonexistent x-vercel-ip-region header is not what region is read from", () => {
  const geo = geoFromHeaders(headers({ "x-vercel-ip-country": "US", "x-vercel-ip-region": "TX" }));
  assert.equal(geo.region, null);
});

test("rate limiting is per listener: signed-in user id, else the IP fallback — never the song", () => {
  assert.equal(rateLimitIdentity({ id: "u1" }), "user:u1");
  assert.equal(rateLimitIdentity(null), undefined);
});

// ── Row building ─────────────────────────────────────────────────────────────

test("a signed-in listener's id is written on the event", () => {
  const { row, legacyRow } = buildPlaybackEventRow({ body: { slug: "w2d", eventType: "play" }, user: { id: "u1" } });
  assert.equal(row.user_id, "u1");
  assert.equal(legacyRow.user_id, "u1");
});

test("admin sessions are flagged by the server, whatever the client claims", () => {
  const admin = buildPlaybackEventRow({ body: { slug: "w2d", eventType: "play", accessTier: "full" }, user: { id: "a", isAdmin: true } }).row;
  assert.equal(admin.is_internal, true);
  assert.equal(admin.access_tier, "admin");
  const spoof = buildPlaybackEventRow({ body: { slug: "w2d", eventType: "play", accessTier: "admin" }, user: { id: "f" } }).row;
  assert.equal(spoof.is_internal, false);
  assert.equal(spoof.access_tier, "full", "a client cannot mark itself admin");
});

test("preview listening keeps its preview tier", () => {
  const { row } = buildPlaybackEventRow({ body: { slug: "w2d", eventType: "complete", accessTier: "preview" } });
  assert.equal(row.access_tier, "preview");
});

test("event types: v1 types pass, unknown ones become progress, completed=true becomes complete", () => {
  for (const t of ["qualified", "pause", "seek", "skip", "download", "download_remove"]) {
    assert.equal(buildPlaybackEventRow({ body: { slug: "x", eventType: t } }).row.event_type, t);
  }
  assert.equal(buildPlaybackEventRow({ body: { slug: "x", eventType: "hack" } }).row.event_type, "progress");
  assert.equal(buildPlaybackEventRow({ body: { slug: "x", eventType: "progress", completed: true } }).row.event_type, "complete");
});

test("before the v1 migration, new types are stored the way they always were", () => {
  assert.equal(legacyEventType("qualified"), "progress");
  assert.equal(legacyEventType("pause"), "progress");
  assert.equal(legacyEventType("skip"), "progress");
  assert.equal(legacyEventType("play"), "play");
  assert.equal(legacyEventType("download"), null);
  assert.equal(buildPlaybackEventRow({ body: { slug: "x", eventType: "download" } }).legacyRow, null);
  assert.equal(buildPlaybackEventRow({ body: { slug: "x", eventType: "skip" } }).legacyRow.event_type, "progress");
});

test("ids must be real UUIDs; geography and recording identity are carried through", () => {
  const { row } = buildPlaybackEventRow({
    body: { slug: "love-hz-vol-1", eventType: "play", eventId: UUID, deviceId: "nope", releaseSlug: "love-hz-vol-1", trackSlug: "08-knock-on-wood", platform: "ios" },
    geo: { country: "US", region: "TX", city: "Austin" },
    productId: "p1",
  });
  assert.equal(row.event_id, UUID);
  assert.equal(row.device_id, null);
  assert.equal(row.track_slug, "08-knock-on-wood");
  assert.equal(row.product_id, "p1");
  assert.equal(row.region, "TX");
  assert.equal(row.platform, "ios");
  assert.equal(row.schema_version, 1);
});

test("device time is kept only when plausible (≤5 min ahead, ≤30 days old)", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const at = (iso) => buildPlaybackEventRow({ body: { slug: "x", clientRecordedAt: iso }, now }).row.client_recorded_at;
  assert.equal(at("2026-11-19T11:00:00Z"), "2026-11-19T11:00:00.000Z");
  assert.equal(at("2026-11-19T12:30:00Z"), null);
  assert.equal(at("2026-09-01T00:00:00Z"), null);
  assert.equal(at("garbage"), null);
});

test("completion rate is position over duration, clamped to 0..1", () => {
  assert.equal(buildPlaybackEventRow({ body: { slug: "x", positionSeconds: 90, durationSeconds: 180 } }).row.completion_rate, 0.5);
  assert.equal(buildPlaybackEventRow({ body: { slug: "x", positionSeconds: 999, durationSeconds: 180 } }).row.completion_rate, 1);
  assert.equal(buildPlaybackEventRow({ body: { slug: "x" } }).row.completion_rate, null);
});

test("schema errors that mean 'v1 not applied yet' are recognised; others are not", () => {
  assert.equal(isPreV1SchemaError({ code: "PGRST204", message: "Could not find the 'access_tier' column" }), true);
  assert.equal(isPreV1SchemaError({ code: "23514", message: "violates check constraint" }), true);
  assert.equal(isPreV1SchemaError({ code: "42P10", message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" }), true);
  assert.equal(isPreV1SchemaError({ code: "08006", message: "connection failure" }), false);
});

test("device class is stored only when it is a known value", () => {
  assert.equal(buildPlaybackEventRow({ body: { slug: "x", deviceClass: "tablet" } }).row.device_class, "tablet");
  assert.equal(buildPlaybackEventRow({ body: { slug: "x", deviceClass: "fridge" } }).row.device_class, null);
});
