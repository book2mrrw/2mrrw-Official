import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalyticsOverview, platformRows } from "@/lib/analytics/overview-report";
import { buildGeoReport } from "@/lib/analytics/geo-report";
import { analyticsRange, sinceOrEpoch } from "@/lib/analytics/range";

const NOW = Date.parse("2026-11-19T18:00:00Z");
const params = (q) => new URLSearchParams(q);

// ── Range ────────────────────────────────────────────────────────────────────

test("no range means lifetime — the career record — not 90 days", () => {
  assert.deepEqual(analyticsRange(params(""), NOW), { key: "all", from: null, to: null });
  assert.equal(sinceOrEpoch(analyticsRange(params(""), NOW)), "1970-01-01T00:00:00.000Z");
});

test("presets and custom windows; an invalid value degrades to lifetime, never an error", () => {
  assert.equal(analyticsRange(params("range=30d"), NOW).from, "2026-10-20T18:00:00.000Z");
  assert.deepEqual(analyticsRange(params("since=2026-01-01&until=2026-02-01"), NOW),
    { key: "custom", from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" });
  assert.deepEqual(analyticsRange(params("range=forever"), NOW), { key: "all", from: null, to: null });
  assert.deepEqual(analyticsRange(params("since=garbage"), NOW), { key: "all", from: null, to: null });
});

// ── Overview report ──────────────────────────────────────────────────────────

const ALBUM = { id: "alb", slug: "love-hz-vol-1", title: "Love Hz Vol. 1", product_type: "album", coverUrl: "/c/alb" };
const SINGLE = { id: "sgl", slug: "w2d", title: "W2D", product_type: "single", coverUrl: "/c/sgl" };
const SONGS = [{ product_id: "alb", slug: "01-intro", title: "Intro" }, { product_id: "alb", slug: "08-knock-on-wood", title: "Knock On Wood" }];
const stat = (product_id, song_slug, extra) => ({ product_id, song_slug, plays: 0, qualified_plays: 0, completes: 0, listeners: 0, ...extra });

function report(over = {}) {
  return buildAnalyticsOverview({
    overview: { plays: 12, qualified_plays: 7, listeners: 5, fans: 2, listen_seconds: 900, first_event_at: "2026-08-17T03:58:39Z" },
    trackStats: [
      stat("alb", "08-knock-on-wood", { plays: 6, qualified_plays: 4, completes: 3, listeners: 3, completion_rate: 0.5 }),
      stat("alb", null, { plays: 2 }),               // legacy album-slug plays
      stat("sgl", null, { plays: 4, completion_rate: 0.25, listeners: 2 }),
      stat("gone", "old-song", { plays: 1, title: "Removed Song" }), // not in catalog
    ],
    products: [ALBUM, SINGLE],
    songs: SONGS,
    purchases: [
      { amount_cents: 999, purchase_type: "purchase", items: [{ slug: "love-hz-vol-1" }] },
      { amount_cents: 299, purchase_type: "purchase", items: [{ slug: "w2d" }] },
      { amount_cents: 0, purchase_type: "gift", items: [{ slug: "w2d" }] },
    ],
    demographics: [
      { dimension: "total", value: "all", fans: 2 }, { dimension: "gender", value: "male", fans: 1 },
      { dimension: "profiled", value: "gender_and_age", fans: 1 }, { dimension: "city", value: "Austin|TX", fans: 1 },
    ],
    growth: [{ month: "2026-11", new_listeners: 3, new_fans: 1 }],
    range: { key: "all" },
    now: new Date(NOW),
    ...over,
  });
}

test("an album purchase counts once, on the album row; its songs show no purchase of their own", () => {
  const r = report();
  const albumRow = r.tracks.find((t) => t.kind === "album");
  const songRows = r.tracks.filter((t) => t.kind === "album_song");
  assert.equal(albumRow.purchases, 1);
  assert.ok(songRows.every((t) => t.purchases === null));
  assert.equal(r.tracks.find((t) => t.slug === "w2d").purchases, 2, "a paid order and a gift both delivered the single");
});

test("every play is shown somewhere: songs, the album's pre-song plays, and recordings no longer in the catalog", () => {
  const r = report();
  assert.equal(r.tracks.reduce((s, t) => s + t.plays, 0), 13);
  assert.equal(r.tracks.find((t) => t.kind === "album").plays, 2);
  assert.equal(r.tracks.find((t) => t.kind === "uncatalogued").title, "Removed Song");
  assert.equal(r.tracks.find((t) => t.songSlug === "01-intro").plays, 0, "catalog songs with no plays still get a row");
});

test("completion is completes per play, as a percent; listeners are real unique listeners", () => {
  const knock = report().tracks.find((t) => t.songSlug === "08-knock-on-wood");
  assert.equal(knock.completionRate, 50);
  assert.equal(knock.listeners, 3);
  assert.equal(knock.qualifiedPlays, 4);
});

test("KPIs: listeners vs fans, paid orders vs gifts, gross revenue in range, lifetime start date", () => {
  const { overview } = report();
  assert.equal(overview.totalListeners, 5);
  assert.equal(overview.totalFans, 2);
  assert.equal(overview.totalPlays, 12);
  assert.equal(overview.qualifiedPlays, 7);
  assert.equal(overview.totalPurchases, 2);
  assert.equal(overview.giftsClaimed, 1);
  assert.equal(overview.totalRevenueCents, 1298);
  assert.equal(overview.demographicsCoverage, 50);
  assert.equal(overview.historyStartsAt, "2026-08-17T03:58:39Z");
});

test("with the ledger, money is gross in its sale period minus refunds in theirs", () => {
  const { overview } = report({ revenue: { gross_sales_cents: 1298, refunds_cents: 299, disputes_cents: 0, net_cents: 999, paid_orders: 2, gifts: 1 } });
  assert.equal(overview.totalRevenueCents, 1298);
  assert.equal(overview.refundsCents, 299);
  assert.equal(overview.netRevenueCents, 999);
  assert.equal(overview.totalPurchases, 2);
});

test("audience and growth come from fan demographics and first listens", () => {
  const r = report();
  assert.deepEqual(r.demographics.gender, { male: 1, female: 0, unknown: 1 });
  assert.deepEqual(r.geography.topCities, [{ city: "Austin", state: "TX", count: 1 }]);
  assert.equal(r.growth.monthly.length, 12);
  assert.deepEqual(r.growth.monthly.at(-1), { month: "2026-11", newListeners: 3, newFans: 1 });
});

// ── Geo report ───────────────────────────────────────────────────────────────

const geoRow = (level, country, region, city, plays, listeners) => ({ level, country, region, city, plays, qualified_plays: 0, listeners });

test("map: countries, regions and cities take their own counts; plays are never doubled; cities match the map's coordinate keys", () => {
  const r = buildGeoReport({
    overview: { listeners: 4 },
    current: [
      geoRow("country", "US", null, null, 10, 4),
      geoRow("region", "US", "TX", null, 7, 3),
      geoRow("city", "US", "TX", "Austin", 5, 2),
      geoRow("city", "US", "TX", "Dallas", 2, 2),
    ],
    range: {}, now: new Date(NOW),
  });
  const us = r.by_country.find((c) => c.a2 === "US");
  assert.equal(us.country, "United States");
  assert.equal(us.streams, 10);
  assert.equal(us.fans, 4, "distinct listeners in the country, not the sum of its cities (2 + 2)");
  assert.equal(r.overview.total_streams, 10);
  assert.equal(r.overview.total_fans, 4);
  assert.deepEqual(r.by_region.map((x) => [x.region, x.fans]), [["TX", 3]]);
  const austin = r.by_city.find((c) => c.city === "Austin");
  assert.equal(`${austin.city}|${austin.state}|${austin.country}`, "Austin|TX|United States");
});

test("map: revenue is placed by the buyer's profile and split into the growth windows", () => {
  const windows = {
    currentFrom: "2026-10-20T00:00:00Z", currentTo: "2026-11-19T18:00:00Z",
    previousFrom: "2026-09-20T00:00:00Z", previousTo: "2026-10-20T00:00:00Z",
  };
  const r = buildGeoReport({
    current: [geoRow("country", "US", null, null, 1, 1)],
    purchases: [
      { user_id: "u1", amount_cents: 500, purchased_at: "2026-11-01T00:00:00Z" },
      { user_id: "u1", amount_cents: 300, purchased_at: "2026-10-01T00:00:00Z" },
      { user_id: "nobody", amount_cents: 999, purchased_at: "2026-11-01T00:00:00Z" },
    ],
    buyerProfiles: [{ id: "u1", country: "United States", state: "tx", city: "Austin" }],
    range: {}, windows, now: new Date(NOW),
  });
  const us = r.by_country.find((c) => c.a2 === "US");
  assert.equal(us.revenueCents, 800, "lifetime range includes both purchases; a buyer with no location is not placed");
  assert.equal(us.growth.revenueCents, 500);
  assert.equal(us.growth.prevRevenueCents, 300);
});

test("map: growth compares the last 30 days with the 30 before, per country", () => {
  const r = buildGeoReport({
    current: [geoRow("country", "CA", null, null, 3, 2)],
    growthCurrent: [geoRow("country", "CA", null, null, 3, 2)],
    growthPrevious: [geoRow("country", "CA", null, null, 1, 1)],
    range: {}, now: new Date(NOW),
  });
  const ca = r.by_country.find((c) => c.a2 === "CA");
  assert.deepEqual([ca.growth.fans, ca.growth.prevFans, ca.growth.streams, ca.growth.prevStreams], [2, 1, 3, 1]);
});

test("platforms are named the way the owner thinks of them, busiest first", () => {
  const rows = platformRows([
    { platform: "web", device_class: "desktop", plays: 3, listeners: 2 },
    { platform: "ios", device_class: "phone", plays: 9, qualified_plays: 6, listeners: 4 },
    { platform: "web", device_class: "phone", plays: 5, listeners: 5 },
    { platform: "android", device_class: "phone", plays: 1, listeners: 1 },
    { platform: "unknown", device_class: "unknown", plays: 7, listeners: 0 },
  ]);
  assert.deepEqual(rows.map((r) => r.label), ["iPhone app", "Before platform tracking", "Mobile web", "Desktop web", "Android app"]);
  assert.equal(rows[0].qualifiedPlays, 6);
});
