import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migrationsDir = path.join(root, "supabase/migrations");
const readOnlyMigration = (needle) => {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.includes(needle));
  assert.equal(files.length, 1, `expected exactly one migration matching "${needle}"`);
  return fs.readFileSync(path.join(migrationsDir, files[0]), "utf8");
};

// ── profiles geocoding schema ───────────────────────────────────────────────

test("profiles gains nullable geo_lat/geo_lng/geo_source/geo_resolved_at columns with a partial index", () => {
  const sql = readOnlyMigration("profile_geocoding");
  assert.match(sql, /alter table public\.profiles\s*\n\s*add column if not exists geo_lat numeric\(9, 6\),\s*\n\s*add column if not exists geo_lng numeric\(9, 6\),/);
  assert.match(sql, /create index if not exists profiles_geo_resolved_idx\s*\n\s*on public\.profiles \(geo_resolved_at\)\s*\n\s*where geo_lat is not null;/);
});

// ── geocode-profile.js: pluggable, non-throwing, curated-first ─────────────

test("the curated CITY_COORDS table stays the free, zero-network first tier — Mapbox is only tried after it misses", () => {
  const src = read("src/lib/geo/geocode-profile.js");
  const fnAt = src.indexOf("export async function resolveCityCoordinates(");
  const body = src.slice(fnAt, fnAt + 300);
  assert.match(body, /resolveCuratedCityCoordinates\(city, state, country\) \|\| resolveViaMapbox\(city, state, country\)/);
});

test("Mapbox geocoding is inert with no token configured — it must return null, never throw, so shipping this requires no env var", () => {
  const src = read("src/lib/geo/geocode-profile.js");
  const fnAt = src.indexOf("async function resolveViaMapbox(");
  const body = src.slice(fnAt, fnAt + 400);
  assert.match(body, /if \(!MAPBOX_GEOCODING_TOKEN\) return null;/);
});

test("Mapbox calls are time-bounded with an AbortController and swallow all errors", () => {
  const src = read("src/lib/geo/geocode-profile.js");
  const fnAt = src.indexOf("async function resolveViaMapbox(");
  const body = src.slice(fnAt, fnAt + 1200);
  assert.match(body, /const controller = new AbortController\(\);/);
  assert.match(body, /setTimeout\(\(\) => controller\.abort\(\), MAPBOX_TIMEOUT_MS\)/);
  assert.match(body, /\} catch \{\s*return null;\s*\}/);
  assert.match(body, /\} finally \{\s*clearTimeout\(timeout\);\s*\}/);
});

test("geocodeProfileIfNeeded never throws and requires city+country before doing any work", () => {
  const src = read("src/lib/geo/geocode-profile.js");
  const fnAt = src.indexOf("export async function geocodeProfileIfNeeded(");
  const body = src.slice(fnAt, fnAt + 900);
  assert.match(body, /if \(!userId \|\| !city \|\| !country\) return \{ resolved: false \};/);
  assert.match(body, /\} catch \{\s*return \{ resolved: false \};\s*\}/);
});

test("a resolved profile persists geo_lat/geo_lng/geo_source/geo_resolved_at in one update, keyed by user id", () => {
  const src = read("src/lib/geo/geocode-profile.js");
  const fnAt = src.indexOf("export async function geocodeProfileIfNeeded(");
  const body = src.slice(fnAt, fnAt + 900);
  assert.match(body, /geo_lat: resolved\.lat,/);
  assert.match(body, /geo_lng: resolved\.lng,/);
  assert.match(body, /geo_source: resolved\.source,/);
  assert.match(body, /\.eq\("id", userId\);/);
});

// ── write-path wiring: signup + gift claim-signup ───────────────────────────

test("both account-creation paths geocode the new profile fire-and-forget, after account provisioning succeeds and never blocking it", () => {
  for (const routeFile of ["src/app/api/auth/signup/route.js", "src/app/api/gifts/claim-signup/route.js"]) {
    const src = read(routeFile);
    assert.match(src, /import \{ geocodeProfileIfNeeded \} from "@\/lib\/geo\/geocode-profile";/, `${routeFile} must import the geocoder`);
    const provisionOkAt = src.indexOf("if (!profileProvision.ok)");
    const geocodeAt = src.indexOf("geocodeProfileIfNeeded(admin,", provisionOkAt);
    assert.ok(geocodeAt > provisionOkAt, `${routeFile} must call the geocoder only after the profile-provision success check`);
    const call = src.slice(geocodeAt, geocodeAt + 200);
    assert.match(call, /\.catch\(\(\) => \{\}\);/, `${routeFile}'s geocode call must be fire-and-forget`);
  }
});

// ── admin geo backfill route ─────────────────────────────────────────────

test("the geo backfill route is admin-gated, batched, and re-runnable (only ever selects rows still missing geo_lat)", () => {
  const src = read("src/app/api/admin/geo/backfill/route.js");
  assert.match(src, /if \(!user \|\| !isAdminUser\(user\)\) \{\s*return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);/);
  assert.match(src, /\.is\("geo_lat", null\)/);
  assert.match(src, /\.limit\(BATCH_SIZE\)/);
  assert.match(src, /const \{ count: remaining \}/, "must report how many profiles are still left so the admin knows whether to call it again");
});

// ── /api/admin/analytics/global: unified schema, revenue attribution, growth window ──

test("by_country replaces the old fans_by_country/streams_by_code split with one row per country carrying every metric", () => {
  const src = read("src/app/api/admin/analytics/global/route.js");
  assert.match(src, /class Aggregator \{/);
  assert.match(src, /country\(identity, displayName, a2\) \{/);
  assert.match(src, /fans: 0, streams: 0, revenueCents: 0, male: 0, female: 0, ages: \{\}/);
});

test("revenue is attributed via the buyer's own profile, since purchases carries no location of its own", () => {
  const src = read("src/app/api/admin/analytics/global/route.js");
  const sectionAt = src.indexOf("// ─── Revenue");
  const body = src.slice(sectionAt, sectionAt + 900);
  assert.match(body, /const buyer = profileByUserId\.get\(pu\.user_id\);/);
  assert.match(body, /if \(!buyer\?\.country\) continue;/);
  assert.match(body, /c\.revenueCents \+= cents;/);
});

test("GROWTH is always a fixed last-30-days vs. prior-30-days comparison, independent of since/until", () => {
  const src = read("src/app/api/admin/analytics/global/route.js");
  assert.match(src, /const GROWTH_WINDOW_MS = 30 \* DAY_MS;/);
  assert.match(src, /const growthCurrentStart = new Date\(now\.getTime\(\) - GROWTH_WINDOW_MS\);/);
  assert.match(src, /const growthPrevStart = new Date\(growthCurrentStart\.getTime\(\) - GROWTH_WINDOW_MS\);/);
  // Fans (a "fan" is a profile who streamed at least once, keyed by media_stream_events.created_at,
  // not since/until at all) — growth buckets are two independent Set-membership checks, so a
  // returning fan (active in both 30d windows) counts in both, not mutually exclusive.
  assert.match(src, /const streamedInGrowthCurrent = new Set\(\s*\n\s*playEvents\.filter\(\(s\) => inRange\(s\.created_at, growthCurrentStart, now\)\)\.map\(\(s\) => s\.user_id\)\s*\n\s*\);/);
  assert.match(src, /const streamedInGrowthPrev = new Set\(\s*\n\s*playEvents\.filter\(\(s\) => inRange\(s\.created_at, growthPrevStart, growthCurrentStart\)\)\.map\(\(s\) => s\.user_id\)\s*\n\s*\);/);
  const fansSectionAt = src.indexOf("// ─── Fans");
  const fansBody = src.slice(fansSectionAt, src.indexOf("// ─── Streams"));
  assert.match(fansBody, /if \(streamedInGrowthCurrent\.has\(p\.id\)\) apply\(growthCurrentAgg\);/);
  assert.match(fansBody, /if \(streamedInGrowthPrev\.has\(p\.id\)\) apply\(growthPrevAgg\);/);
});

test("omitting since/until behaves exactly like the pre-existing all-time default — every fan who has ever streamed counts in the current bucket", () => {
  const src = read("src/app/api/admin/analytics/global/route.js");
  assert.match(src, /const streamedInWindow = new Set\(\s*\n\s*playEvents\.filter\(\(s\) => \(!since && !until\) \|\| inRange\(s\.created_at, since, until\)\)\.map\(\(s\) => s\.user_id\)\s*\n\s*\);/);
  const fansSectionAt = src.indexOf("// ─── Fans");
  const fansBody = src.slice(fansSectionAt, src.indexOf("// ─── Streams"));
  assert.match(fansBody, /if \(streamedInWindow\.has\(p\.id\)\) apply\(currentAgg\);/);
});

test("a fan is a registered profile who has streamed at least once — not merely signed up — and every fan count is scoped to that", () => {
  const src = read("src/app/api/admin/analytics/global/route.js");
  assert.match(src, /const playEvents = streams\.filter\(\(s\) => s\.event_type === "play" && s\.user_id\);/);
  assert.match(src, /total_fans: streamedInWindow\.size,/);
  assert.doesNotMatch(src, /profiles\.length/, "total_fans must never fall back to a raw signup count");
});

test("since/until are optional ISO date query params parsed defensively — an invalid value degrades to null (all-time), not a 500", () => {
  const src = read("src/app/api/admin/analytics/global/route.js");
  const fnAt = src.indexOf("function parseDateParam(value)");
  const body = src.slice(fnAt, fnAt + 200);
  assert.match(body, /if \(!value\) return null;/);
  assert.match(body, /Number\.isNaN\(d\.getTime\(\)\) \? null : d/);
});

test("streams and fans are unified under one country identity — an ISO alpha-2 code when resolvable, so the old NAME_TO_A2 cross-reference dance is gone from this route", () => {
  const src = read("src/app/api/admin/analytics/global/route.js");
  assert.match(src, /function countryIdentity\(displayName\) \{\s*return NAME_TO_A2\[displayName\] \|\| displayName;\s*\}/);
  // media_stream_events.country is already an a2 code — confirm the route treats it as the identity directly, no lookup needed
  const streamsSectionAt = src.indexOf("// ─── Streams");
  const streamsBody = src.slice(streamsSectionAt, src.indexOf("// ─── Revenue"));
  assert.match(streamsBody, /const a2 = s\.country;/);
  assert.match(streamsBody, /agg\.country\(a2, displayName, a2\)/);
});

test("by_city aggregates a resolved lat/lng as the average of any geocoded profiles in that bucket, null when none are geocoded yet", () => {
  const src = read("src/app/api/admin/analytics/global/route.js");
  const fnAt = src.indexOf("function finalizeCities(agg)");
  const body = src.slice(fnAt, fnAt + 400);
  assert.match(body, /lat: geoCount > 0 \? latSum \/ geoCount : null,/);
  assert.match(body, /lng: geoCount > 0 \? lngSum \/ geoCount : null,/);
});

test("the route still selects and forwards purchases.amount_cents — previously fetched and silently discarded, now the source of revenueCents", () => {
  const src = read("src/app/api/admin/analytics/global/route.js");
  assert.match(src, /\.select\("user_id, amount_cents, status, created_at"\)/);
  assert.match(src, /const cents = Number\(pu\.amount_cents\) \|\| 0;/);
});

// ── shared geo/country-code extraction (no duplicated data) ─────────────────

test("CITY_COORDS and the country-code tables are extracted to shared lib modules, not duplicated between the map page and the geocoder", () => {
  const page = read("src/app/admin/analytics/page.js");
  assert.match(page, /import \{ CITY_COORDS \} from "@\/lib\/geo\/city-coords";/);
  assert.match(page, /import \{ NAME_TO_A2, A2_TO_NUMERIC, A2_TO_NAME \} from "@\/lib\/geo\/country-codes";/);
  assert.doesNotMatch(page, /^const CITY_COORDS = \{/m, "CITY_COORDS must no longer be defined inline in the page");
  assert.doesNotMatch(page, /^const NAME_TO_A2 = \{/m, "NAME_TO_A2 must no longer be defined inline in the page");

  const geocoder = read("src/lib/geo/geocode-profile.js");
  assert.match(geocoder, /import \{ CITY_COORDS \} from "@\/lib\/geo\/city-coords";/);

  const globalRoute = read("src/app/api/admin/analytics/global/route.js");
  assert.match(globalRoute, /import \{ NAME_TO_A2, A2_TO_NAME \} from "@\/lib\/geo\/country-codes";/);
});

// ── frontend: metric switcher, date-range controls, precise city dots ──────

test("the map has a real metric switcher (fans/streams/revenue) driving both country fill and city-dot sizing, not a label-only toggle", () => {
  const src = read("src/app/admin/analytics/page.js");
  assert.match(src, /const METRICS = \{/);
  assert.match(src, /const metricGet = METRICS\[metric\]\?\.get \|\| METRICS\.fans\.get;/);
  const cityDotsAt = src.indexOf("const cityDots = useMemo(");
  const cityDotsBody = src.slice(cityDotsAt, cityDotsAt + 1200);
  assert.match(cityDotsBody, /value: metricGet\(c\)/);
});

test("GROWTH mode actually computes a diverging value now (decline vs growth), not the same fan-count fill as DOTS/HEAT", () => {
  const src = read("src/app/admin/analytics/page.js");
  assert.match(src, /const value = isGrowth \? growthPct\(c\.growth\.fans, c\.growth\.prevFans\) : metricGet\(c\);/);
  assert.match(src, /const rgb = isGrowth \? \(value < 0 \? "239,68,68" : metricColor\) : metricColor;/);
});

test("date-range presets (7D/30D/90D/YTD/All/Custom) exist and are wired into the fetch as since/until query params", () => {
  const src = read("src/app/admin/analytics/page.js");
  assert.match(src, /const RANGE_PRESETS = \[/);
  for (const key of ["7d", "30d", "90d", "ytd", "all", "custom"]) {
    assert.match(src, new RegExp(`key: "${key}"`));
  }
  const loadAt = src.indexOf("const load = useCallback(async () => {");
  const loadBody = src.slice(loadAt, loadAt + 700);
  assert.match(loadBody, /if \(since\) params\.set\("since", since\.toISOString\(\)\);/);
  assert.match(loadBody, /if \(until\) params\.set\("until", until\.toISOString\(\)\);/);
});

test("the date-range controls are hidden for GROWTH mode, since growth is always the fixed 30d comparison regardless of range", () => {
  const src = read("src/app/admin/analytics/page.js");
  assert.match(src, /\{mapMode !== "GROWTH" && \(/);
});

test("a custom range reveals two native date inputs bound to their own state", () => {
  const src = read("src/app/admin/analytics/page.js");
  assert.match(src, /\{range === "custom" && \(/);
  assert.match(src, /<input type="date" value=\{customSince\} onChange=\{e => setCustomSince\(e\.target\.value\)\}/);
  assert.match(src, /<input type="date" value=\{customUntil\} onChange=\{e => setCustomUntil\(e\.target\.value\)\}/);
});

test("city dots prefer a precise resolved lat/lng before falling back to the curated table, and only then the country centroid — the exact same fallback order as before, just with a new first tier", () => {
  const src = read("src/app/admin/analytics/page.js");
  const cityDotsAt = src.indexOf("const cityDots = useMemo(");
  const body = src.slice(cityDotsAt, cityDotsAt + 1200);
  const preciseAt = body.indexOf("c.lat != null && c.lng != null");
  const curatedAt = body.indexOf("CITY_COORDS[key]");
  const centroidAt = body.indexOf("centroids.get(num)");
  assert.ok(preciseAt > -1 && curatedAt > preciseAt && centroidAt > curatedAt,
    "fallback order must be: resolved lat/lng -> curated table -> country centroid");
});

test("the Geography table gained a Revenue column and sort option alongside the existing Fans/Streams", () => {
  const src = read("src/app/admin/analytics/page.js");
  const fnAt = src.indexOf("function GeographyTable(");
  const body = src.slice(fnAt, fnAt + 4000);
  assert.match(body, /\{ key: "revenue", label: "Revenue" \}/);
  assert.match(body, /else if \(sortBy === "revenue"\) arr\.sort\(\(a, b\) => b\.revenueCents - a\.revenueCents\);/);
  assert.match(body, /fmtRevenue\(c\.revenueCents\)/);
});
