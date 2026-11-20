import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = (needle) => {
  const dir = path.join(root, "supabase/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.includes(needle));
  assert.equal(files.length, 1, `expected exactly one migration matching "${needle}"`);
  return fs.readFileSync(path.join(dir, files[0]), "utf8");
};

// A fan is someone who listened — never merely an account that signed up.
// The counting itself is proven on real Postgres in
// scripts/analytics-contract-tests/metrics-v2.test.mjs; these pin the wiring.

test("the account-panel route takes fans, demographics and growth from the analytics SQL, never from raw profiles", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  assert.match(src, /admin\.rpc\("analytics_overview", window\)/);
  assert.match(src, /admin\.rpc\("analytics_fan_demographics", window\)/);
  assert.match(src, /admin\.rpc\("analytics_listener_growth", \{ p_tz: ARTIST_TIME_ZONE \}\)/);
  assert.doesNotMatch(src, /from\("profiles"\)/, "counting raw profiles would make every signup a fan");
  assert.doesNotMatch(src, /from\("media_stream_events"\)/, "no raw-event loads: counts come from the tested SQL");
});

test("demographics only cover signed-in people with counted listening (no admins, no previews)", () => {
  const sql = migration("analytics_metrics_v2");
  assert.match(sql, /with fans as \(\s*select distinct fan_id from public\.analytics_fan_events\s*where fan_id is not null and event_type in \('play', 'qualified', 'complete'\)/);
  assert.match(sql, /where not e\.is_internal\s*and coalesce\(e\.access_tier, 'full'\) = 'full'/);
});

test("listener growth buckets by first counted listen, not signup date", () => {
  const sql = migration("analytics_metrics_v2");
  const fnAt = sql.indexOf("create or replace function public.analytics_listener_growth");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));
  assert.match(body, /min\(created_at\) as first_at/);
  assert.match(body, /from public\.analytics_fan_events/);
  assert.doesNotMatch(body, /profiles/, "signup dates must not drive growth");
});

test("labels say what the numbers are: Fans are signed-in listeners; no 'signups'/'accounts' claims", () => {
  const dashboard = read("src/components/account/AnalyticsDashboard.js");
  const globalMapPage = read("src/app/admin/analytics/page.js");
  assert.doesNotMatch(dashboard, /All-time accounts/);
  assert.doesNotMatch(globalMapPage, /All-time signups/);
  assert.match(dashboard, /label=\{`Fans · \$\{rl\}`\}\s+value=\{fmt\(overview\.totalFans\)\}\s+sub="Signed-in listeners"/);
  assert.match(dashboard, /label=\{`Listeners · \$\{rl\}`\} value=\{fmt\(overview\.totalListeners\)\} sub="Unique, signed in or not"/);
  assert.match(globalMapPage, /label="Listeners" value=\{fmt\(ov\.total_fans\)\} sub="Heard at least once"/);
  // Revenue on the Overview is net of refunds (ledger), with gross shown beside it.
  assert.match(dashboard, /label=\{`Revenue · \$\{rl\}`\}\s+value=\{fmtRevenue\(overview\.netRevenueCents \?\? overview\.totalRevenueCents\)\}/);
});
