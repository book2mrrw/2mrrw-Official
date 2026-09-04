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

test("cover art comes from mapProductRow's canonical R2-path resolution, not the raw cover_url column", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  assert.match(src, /import \{ mapProductRow \} from "@\/lib\/media\/catalog-db";/);
  assert.doesNotMatch(src, /coverUrl:\s*p\.cover_url/, "must not read the raw column directly anymore — many releases only resolve artwork via canonical paths");
  const singleAt = src.indexOf("for (const p of products) {");
  const singleBody = src.slice(singleAt, singleAt + 700);
  assert.match(singleBody, /coverUrl: mapProductRow\(p\)\.cover \|\| null,/);
  const albumAt = src.indexOf("for (const album of albumProducts) {");
  const albumBody = src.slice(albumAt, albumAt + 700);
  assert.match(albumBody, /const coverUrl = mapProductRow\(album\)\.cover \|\| null;/,
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

// ── Tab bar: Global Map button stays on the same row as the tabs ───────────

test("the tab pill group scrolls horizontally on its own overflow instead of pushing Global Map / Refresh off the row", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const tabBarAt = src.indexOf("Tab bar");
  const body = src.slice(tabBarAt, tabBarAt + 2200);
  assert.match(body, /overflowX:"auto",/, "the pill group itself must scroll, not the whole row wrap or overflow invisibly");
  assert.match(body, /whiteSpace:"nowrap", flexShrink:0,/, "each tab button must never shrink/wrap mid-label");
});

test("Global Map link and the refresh button never shrink or wrap out of the row", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const tabBarAt = src.indexOf("Tab bar");
  const body = src.slice(tabBarAt, tabBarAt + 2200);
  const globalMapAt = body.indexOf('href="/admin/analytics"');
  const globalMapTag = body.slice(globalMapAt, globalMapAt + 600);
  assert.match(globalMapTag, /whiteSpace:"nowrap", flexShrink:0,/);
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
