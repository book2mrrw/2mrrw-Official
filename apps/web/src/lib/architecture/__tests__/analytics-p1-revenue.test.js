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

// ── media_stream_events.product_id: disambiguates same-named tracks across albums ──

test("media_stream_events gains a nullable, FK'd product_id column with a supporting index", () => {
  const sql = readOnlyMigration("media_stream_events_product_id");
  assert.match(sql, /alter table public\.media_stream_events\s*\n\s*add column if not exists product_id uuid references public\.products\(id\) on delete set null;/);
  assert.match(sql, /create index if not exists media_stream_events_product_id_idx/);
});

test("the analytics-event write route resolves product_id from albumSlug (multi-track) or slug (single) before inserting", () => {
  const src = read("src/app/api/media/playback/route.js");
  const albumSlugAt = src.indexOf("const albumSlug = cleanSlug(body.albumSlug);");
  const lookupAt = src.indexOf('.eq("slug", albumSlug || slug)', albumSlugAt);
  const insertAt = src.indexOf('await admin.from("media_stream_events").insert(eventPayload)');
  assert.ok(albumSlugAt > -1 && lookupAt > albumSlugAt, "must prefer albumSlug over the bare track slug when resolving the owning product");
  assert.ok(insertAt > lookupAt, "product_id must be resolved before the event row is inserted");
  assert.match(src, /product_id: productId,/, "the resolved id must actually be written onto the event payload");
});

test("a failed product_id lookup degrades to null rather than failing the analytics write", () => {
  const src = read("src/app/api/media/playback/route.js");
  const albumSlugAt = src.indexOf("const albumSlug = cleanSlug(body.albumSlug);");
  const body = src.slice(albumSlugAt, albumSlugAt + 500);
  assert.match(body, /try \{[\s\S]*?\} catch \{\s*productId = null;\s*\}/);
});

test("onPlay's analytics beacon sends albumSlug alongside slug, sourced from the track's existing metadata — no new plumbing required", () => {
  const src = read("src/lib/playback/PlaybackEventHandlers.js");
  const persistAt = src.indexOf("const persistPlayback = (eventType");
  const body = src.slice(persistAt, persistAt + 1200);
  assert.match(body, /albumSlug: track\.metadata\?\.albumSlug \|\| null,/);
});

test("every track object already carries metadata.albumSlug — confirms the write-path fix needed no new field, just reading what normalizeTrackForPlayback already produces", () => {
  const src = read("src/lib/music-playback.js");
  const returnAt = src.indexOf("metadata: {");
  const body = src.slice(returnAt, returnAt + 400);
  assert.match(body, /albumSlug: normalized\?\.albumSlug \|\| overrides\.albumSlug,/);
});

// ── per-release revenue + per-track play RPCs ───────────────────────────────

test("get_release_revenue_stats sums purchase_items' real allocated cents per product, not the raw purchases total", () => {
  const sql = readOnlyMigration("analytics_revenue_rpcs");
  const fnAt = sql.indexOf("create or replace function public.get_release_revenue_stats");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));
  assert.match(body, /from public\.purchase_items pi/);
  assert.match(body, /join public\.purchases pu on pu\.id = pi\.purchase_id/);
  assert.match(body, /where pu\.status = 'completed'/);
  assert.match(body, /sum\(pi\.unit_price_cents \* pi\.quantity\)::bigint as gross_cents/);
});

test("get_track_play_stats groups by (product_id, product_slug) so two albums' same-named tracks never merge, and excludes pre-migration rows lacking product_id", () => {
  const sql = readOnlyMigration("analytics_revenue_rpcs");
  const fnAt = sql.indexOf("create or replace function public.get_track_play_stats");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));
  assert.match(body, /group by e\.product_id, e\.product_slug/);
  assert.match(body, /and e\.product_id is not null/);
  assert.match(body, /left join public\.catalog_tracks ct on ct\.product_id = e\.product_id and ct\.slug = e\.product_slug/);
});

test("get_subscription_stats reports a point-in-time snapshot including MRR from the newly-captured price_cents", () => {
  const sql = readOnlyMigration("analytics_revenue_rpcs");
  const fnAt = sql.indexOf("create or replace function public.get_subscription_stats");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));
  assert.match(body, /count\(\*\) filter \(where status = 'active'\) as active_count/);
  assert.match(body, /sum\(price_cents\) filter \(where status in \('active', 'trialing'\)\), 0\)::bigint as mrr_cents/);
});

test("all three new RPCs are granted to service_role, matching the existing get_play_stats grant pattern", () => {
  const sql = readOnlyMigration("analytics_revenue_rpcs");
  assert.match(sql, /grant execute on function public\.get_release_revenue_stats\(timestamptz\) to service_role;/);
  assert.match(sql, /grant execute on function public\.get_track_play_stats\(timestamptz\) to service_role;/);
  assert.match(sql, /grant execute on function public\.get_subscription_stats\(\) to service_role;/);
});

// ── subscription pricing capture (feeds get_subscription_stats' MRR) ────────

test("memberships gains price_cents/currency columns, captured from Stripe rather than trusting a hardcoded constant", () => {
  const sql = readOnlyMigration("membership_pricing");
  assert.match(sql, /alter table public\.memberships\s*\n\s*add column if not exists price_cents integer,\s*\n\s*add column if not exists currency text;/);
});

test("upsertMembershipFromSubscription now writes price_cents/currency from the subscription's own Stripe price object", () => {
  const src = read("src/lib/commerce/stripe-entitlements.js");
  const fnAt = src.indexOf("export async function upsertMembershipFromSubscription");
  const body = src.slice(fnAt, fnAt + 2000);
  assert.match(body, /const subscriptionPrice = subscription\.items\?\.data\?\.\[0\]\?\.price;/);
  assert.match(body, /price_cents: subscriptionPrice\?\.unit_amount \?\? null,/);
  assert.match(body, /currency: subscriptionPrice\?\.currency \|\| null,/);
});

test("the membership row's existing tier/status/entitlement-granting logic is untouched by the pricing addition", () => {
  const src = read("src/lib/commerce/stripe-entitlements.js");
  const fnAt = src.indexOf("export async function upsertMembershipFromSubscription");
  const body = src.slice(fnAt, fnAt + 3200);
  assert.match(body, /tier: subscription\.metadata\?\.tier \|\| "inner_circle",/);
  assert.match(body, /grantEntitlementFlag\(admin, userId, "subscriber", "stripe_subscription"/);
  assert.match(body, /revokeEntitlementFlag\(admin, userId, "subscriber"\)/);
});

// ── royalty/collaborator schema foundation ──────────────────────────────────

test("collaborators and release_collaborators tables exist with a bounded split_percent and a release-or-product target guard", () => {
  const sql = readOnlyMigration("royalty_schema_foundation");
  assert.match(sql, /create table if not exists public\.collaborators/);
  assert.match(sql, /create table if not exists public\.release_collaborators/);
  assert.match(sql, /split_percent\s+numeric\(5,2\) not null check \(split_percent >= 0 and split_percent <= 100\)/);
  assert.match(sql, /constraint release_collaborators_has_target check \(release_id is not null or product_id is not null\)/);
});

// ── new revenue API route ────────────────────────────────────────────────────

test("the revenue route is admin-gated and rate-limited under its own routeKey, matching the existing analytics route's pattern", () => {
  const src = read("src/app/api/admin/analytics/revenue/route.js");
  assert.match(src, /if \(!user \|\| !isAdminUser\(user\)\) \{\s*return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);/);
  assert.match(src, /routeKey: "admin\.analytics\.revenue",/, "must use its own rate-limit key, not share the existing admin.analytics bucket");
});

test("the revenue route calls all three new RPCs in parallel", () => {
  const src = read("src/app/api/admin/analytics/revenue/route.js");
  assert.match(src, /admin\.rpc\("get_release_revenue_stats", \{ since: ninetyDaysAgo \}\)/);
  assert.match(src, /admin\.rpc\("get_track_play_stats", \{ since: ninetyDaysAgo \}\)/);
  assert.match(src, /admin\.rpc\("get_subscription_stats"\)\.maybeSingle\(\)/);

  // get_track_play_stats is legitimately reused by /api/admin/analytics too
  // (fixing its Tracks tab's per-song title/cover art — a later slice), but
  // the revenue-specific RPCs and purchase_items must stay exclusive to this route.
  const existingRoute = read("src/app/api/admin/analytics/route.js");
  assert.doesNotMatch(existingRoute, /purchase_items|get_release_revenue_stats|get_subscription_stats/,
    "revenue-specific RPCs must not be duplicated into the existing analytics route");
});

// ── Revenue tab: additive, lazy-loaded, no impact on existing tabs ──────────

test("the Revenue tab is added to the tab bar without touching the other three tab definitions", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const tabsAt = src.indexOf("const TABS = [");
  const tabsBody = src.slice(tabsAt, src.indexOf("];", tabsAt));
  assert.match(tabsBody, /\{ id:"overview", label:"Overview" \}/);
  assert.match(tabsBody, /\{ id:"audience", label:"Audience" \}/);
  assert.match(tabsBody, /\{ id:"tracks",   label:"Tracks"   \}/);
  assert.match(tabsBody, /\{ id:"revenue",  label:"Revenue"  \}/);
});

test("revenue data fetches lazily only once the Revenue tab is opened, with its own state — the initial dashboard load is unaffected", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  assert.match(src, /const \[revenueData,\s+setRevenueData\]\s+= useState\(null\);/);
  assert.match(src, /const \[revenueLoading, setRevenueLoading\] = useState\(false\);/);
  const effectAt = src.indexOf('useEffect(()=>{\n    if (tab==="revenue"');
  assert.ok(effectAt > -1, "the revenue fetch must be gated on tab===\"revenue\", not fired unconditionally on mount");
  const originalLoadAt = src.indexOf("const load = useCallback(() => {");
  const originalLoadBody = src.slice(originalLoadAt, src.indexOf("}, []);", originalLoadAt));
  assert.doesNotMatch(originalLoadBody, /revenue/i, "the original overview/audience/tracks load must be completely untouched by the new tab");
});

test("RevenueTab renders subscription KPIs and a per-release gross-revenue table, reusing the existing Card/Label/fmtRevenue primitives rather than inventing new ones", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const fnAt = src.indexOf("function RevenueTab(");
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt);
  assert.match(body, /fmtRevenue\(overview\.totalGrossCents\)/);
  assert.match(body, /fmtRevenue\(subscriptions\.mrrCents\)/);
  assert.match(body, /<Card /);
  assert.match(body, /<Label>/);
});
