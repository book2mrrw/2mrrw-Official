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

// ── Tracks tab: one row per real song, with the right cover art ────────────

test("the Tracks tab expands albums into their individual songs instead of one collapsed album row", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  const sectionAt = src.indexOf("const albumProducts = products.filter");
  const body = src.slice(sectionAt, sectionAt + 3200);
  assert.match(body, /if \(p\.product_type === "album"\) continue; \/\/ replaced by its individual songs below/);
  assert.match(body, /for \(const song of songsByProductId\.get\(album\.id\) \|\| \[\]\) \{/);
  assert.match(body, /title: song\.title,/, "each album-song row must use the individual song's own title, not the album's");
});

test("cover art always calls the real R2 visual-discovery endpoint, not just when video metadata happens to be recorded", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  assert.match(src, /import \{ visualDiscoveryUrl \} from "@\/lib\/media\/canonical-paths";/);
  assert.doesNotMatch(src, /coverUrl:\s*p\.cover_url/, "must not read the raw column directly — many releases only resolve artwork via canonical paths");
  const fnAt = src.indexOf("function resolveCoverUrl(row)");
  const fnBody = src.slice(fnAt, fnAt + 900);
  // mapProductRow (catalog-db.js) only calls visualDiscoveryUrl when it already
  // knows a video exists — this route's own resolver must call it unconditionally,
  // since the endpoint itself resolves whichever asset (video or image) is real.
  assert.doesNotMatch(fnBody, /hasVideo|isSingle/,
    "must not gate discovery behind a video-presence check — that gate is exactly what left albums with blank covers");
  assert.match(fnBody, /return visualDiscoveryUrl\(releaseTypeFolder, row\.slug, \{/);

  const singleAt = src.indexOf("for (const p of products) {");
  const singleBody = src.slice(singleAt, singleAt + 700);
  assert.match(singleBody, /coverUrl: resolveCoverUrl\(p\),/);
  const albumAt = src.indexOf("for (const album of albumProducts) {");
  const albumBody = src.slice(albumAt, albumAt + 700);
  assert.match(albumBody, /const coverUrl = resolveCoverUrl\(album\);/,
    "every song inside an album must inherit the parent album's own resolved cover, not try to resolve its own");
});

test("album songs use get_track_play_stats (correctly keyed by product_id+track_slug) instead of the legacy product_slug-keyed get_play_stats, which always showed zero for a multi-track release's own product row", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  assert.match(src, /admin\.rpc\("get_track_play_stats", \{ since: ninetyDaysAgo \}\)/);
  const albumAt = src.indexOf("for (const album of albumProducts) {");
  const albumBody = src.slice(albumAt, albumAt + 700);
  assert.match(albumBody, /const stat = trackPlayStats\[`\$\{album\.id\}:\$\{song\.slug\}`\];/);
});

test("owning an album attributes its purchases/listeners to every song inside it, matching real access — buying the album grants every track", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  const albumAt = src.indexOf("for (const album of albumProducts) {");
  const albumBody = src.slice(albumAt, albumAt + 700);
  assert.match(albumBody, /const purchases = purchaseCounts\[album\.slug\] \|\| 0;/);
  assert.match(albumBody, /const listeners = listenerCounts\[album\.slug\] \|\| 0;/);
});

test("only real audio product types (single/feature/album) are queried for the Tracks tab — merch/vault/tickets never belonged in a track list", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  assert.match(src, /\.in\("product_type", \["single", "feature", "album"\]\)/);
});

// ── Tab bar: genuinely scrollable, discoverable, no tab ever unreachable ───

test("ScrollableTabStrip scrolls its own overflow with visible click-to-scroll arrows that only appear when there's more to see in that direction", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const fnAt = src.indexOf("function ScrollableTabStrip(");
  const body = src.slice(fnAt, fnAt + 3200);
  assert.match(body, /overflowX:"auto",/, "the pill group itself must scroll — no scrollbarWidth:\"none\" hiding it, which made the previous fix undiscoverable");
  assert.doesNotMatch(body, /scrollbarWidth:"none"/, "the scrollbar must stay visible as a discoverable affordance");
  assert.match(body, /\{canScrollLeft && \(/);
  assert.match(body, /\{canScrollRight && \(/);
  assert.match(body, /setCanScrollLeft\(el\.scrollLeft > 4\);/);
  assert.match(body, /whiteSpace:"nowrap", flexShrink:0,/, "each tab button must never shrink/wrap mid-label");
});

test("the Analytics dashboard uses ScrollableTabStrip for its six tabs, and the Global Map link no longer renders inside this row (now one level up, next to Overview/Analytics)", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  assert.match(src, /<ScrollableTabStrip tabs=\{TABS\} activeTab=\{tab\} onSelect=\{setTab\} \/>/);
  assert.doesNotMatch(src, /href="\/admin\/analytics"/, "the Global Map anchor no longer renders inside AnalyticsDashboard — see HomeClient.js");
});

test("Global Map now sits in the same row as the Overview/Analytics toggle in HomeClient.js, reachable without first opening the Analytics sub-tab", () => {
  const src = read("src/app/HomeClient.js");
  const toggleAt = src.indexOf('{["overview","analytics"].map(t=>');
  const rowEndAt = src.indexOf("</div>", toggleAt);
  const globalMapAt = src.indexOf('href="/admin/analytics"', toggleAt);
  assert.ok(toggleAt > -1 && globalMapAt > toggleAt && globalMapAt < rowEndAt,
    "the Global Map link must be inside the same flex row as the overview/analytics buttons, not appended after it closes");
});

// ── GenderDonut: stacked layout, no more side-by-side squeeze ──────────────

test("GenderDonut stacks the donut above the legend instead of side-by-side, so labels always get the card's full width", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const fnAt = src.indexOf("function GenderDonut(");
  const body = src.slice(fnAt, fnAt + 600);
  assert.match(body, /display:"flex", flexDirection:"column", alignItems:"center", gap:18/,
    "must be a column layout (stacked), not the old row layout that squeezed the legend against a fixed-width donut");
});

test("GenderDonut's legend gets the full card width and each row can wrap without clipping male/female/unknown labels", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const fnAt = src.indexOf("function GenderDonut(");
  const body = src.slice(fnAt, fnAt + 3500);
  assert.match(body, /width:"100%", display:"flex", flexDirection:"column", gap:14/);
  assert.match(body, /justifyContent:"space-between", alignItems:"baseline", flexWrap:"wrap", gap:6/,
    "the label/percentage row must be allowed to wrap rather than clip when narrow");
});

// ── Regional (DST-correct) listening-time patterns ──────────────────────────

test("get_regional_listening_patterns uses Postgres's own IANA timezone database (AT TIME ZONE) rather than a fixed hand-rolled offset, so DST is applied automatically", () => {
  const sql = readOnlyMigration("regional_listening_patterns");
  assert.match(sql, /created_at at time zone 'America\/New_York'/);
  assert.match(sql, /created_at at time zone 'Asia\/Seoul'/);
  assert.match(sql, /created_at at time zone 'Europe\/Moscow'/);
});

test("the US is split into its own real internal timezones using the state already recorded in media_stream_events.region, not treated as one country-wide zone", () => {
  const sql = readOnlyMigration("regional_listening_patterns");
  assert.match(sql, /when country = 'US' and region in \('CT','DE','FL','GA','IN','KY','ME','MD','MA','MI','NH','NJ','NY','NC','OH','PA','RI','SC','VT','VA','WV','DC'\) then 'US — Eastern'/);
  assert.match(sql, /when country = 'US' and region in \('CA','NV','OR','WA'\) then 'US — Pacific'/);
  assert.match(sql, /when country = 'US' and region = 'AK' then 'US — Alaska'/);
  assert.match(sql, /when country = 'US' and region = 'HI' then 'US — Hawaii'/);
});

test("every named region the user asked for is represented: Europe, Africa, Russia, Korea, Middle East, and a catch-all for anywhere else", () => {
  const sql = readOnlyMigration("regional_listening_patterns");
  assert.match(sql, /then 'Central Europe'/);
  assert.match(sql, /then 'Eastern Europe'/);
  assert.match(sql, /then 'Russia'/);
  assert.match(sql, /then 'Korea'/);
  assert.match(sql, /then 'Middle East'/);
  assert.match(sql, /then 'Sub-Saharan Africa'/);
  assert.match(sql, /then 'North Africa'/);
  assert.match(sql, /else 'Other'/);
});

test("the RPC is granted to service_role", () => {
  const sql = readOnlyMigration("regional_listening_patterns");
  assert.match(sql, /grant execute on function public\.get_regional_listening_patterns\(timestamptz\) to service_role;/);
});

test("the timing route calls both the global (UTC) and regional RPCs, and summarizes each region's own peak hour/day independently", () => {
  const src = read("src/app/api/admin/analytics/timing/route.js");
  assert.match(src, /admin\.rpc\("get_listening_time_patterns", \{ since: ninetyDaysAgo \}\)/);
  assert.match(src, /admin\.rpc\("get_regional_listening_patterns", \{ since: ninetyDaysAgo \}\)/);
  assert.match(src, /return \{ region, cells: regionCells, totalPlays, \.\.\.summarize\(regionCells\) \};/);
});

// ── Global Map: no caching, ever — every load/Refresh is genuinely live ────

test("the global analytics route serves no-store — every request re-queries current data, never a browser-cached snapshot", () => {
  const src = read("src/app/api/admin/analytics/global/route.js");
  assert.match(src, /"Cache-Control": "private, no-store, must-revalidate"/);
});

test("the Global Map page's fetch explicitly requests no-store, so clicking Refresh can never be silently satisfied from the browser's HTTP cache", () => {
  const src = read("src/app/admin/analytics/page.js");
  assert.match(src, /fetch\(`\/api\/admin\/analytics\/global\$\{qs \? `\?\$\{qs\}` : ""\}`, \{ credentials: "include", cache: "no-store" \}\)/);
});

test("every tab's fetch in AnalyticsDashboard (overview/tracks, revenue, funnels, timing) explicitly requests no-store, and every one of their routes serves no-store back", () => {
  const dashboard = read("src/components/account/AnalyticsDashboard.js");
  assert.match(dashboard, /fetch\("\/api\/admin\/analytics", \{ credentials:"include", cache:"no-store" \}\)/);
  assert.match(dashboard, /fetch\("\/api\/admin\/analytics\/revenue", \{ credentials:"include", cache:"no-store" \}\)/);
  assert.match(dashboard, /fetch\("\/api\/admin\/analytics\/funnels", \{ credentials:"include", cache:"no-store" \}\)/);
  assert.match(dashboard, /fetch\("\/api\/admin\/analytics\/timing", \{ credentials:"include", cache:"no-store" \}\)/);

  for (const routeFile of [
    "src/app/api/admin/analytics/route.js",
    "src/app/api/admin/analytics/revenue/route.js",
    "src/app/api/admin/analytics/funnels/route.js",
    "src/app/api/admin/analytics/timing/route.js",
  ]) {
    const src = read(routeFile);
    assert.match(src, /"Cache-Control": "private, no-store, must-revalidate"/, `${routeFile} must serve no-store`);
  }
});
