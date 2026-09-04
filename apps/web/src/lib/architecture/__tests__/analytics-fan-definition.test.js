import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// ── /api/admin/analytics/route.js: fan = streamed at least once ────────────

test("the account-panel analytics route fetches play events and builds a streamedUserIds set, instead of trusting every profile as a fan", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  assert.match(src, /admin\.from\("media_stream_events"\)\.select\("user_id, created_at"\)\.eq\("event_type", "play"\)\.not\("user_id", "is", null\)\.limit\(100000\)/);
  const fnAt = src.indexOf("const streamedUserIds = new Set(");
  const body = src.slice(fnAt, fnAt + 1200);
  assert.match(body, /const streamedUserIds = new Set\(\(playEventsResult\.data \|\| \[\]\)\.map\(\(e\) => e\.user_id\)\);/);
});

test("profiles are filtered to streamedUserIds before any demographic/geography tally, and totalFans derives from that filtered list, not the raw profiles table", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  assert.match(src, /const profiles = \(profilesResult\.data \|\| \[\]\)\.filter\(\(p\) => streamedUserIds\.has\(p\.id\)\);/);
  const totalFansAt = src.indexOf("const totalFans = profiles.length;");
  assert.ok(totalFansAt > -1, "totalFans must read from the already-filtered profiles array");
});

test("the profiles query now selects id, required to join against streamedUserIds", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  assert.match(src, /admin\.from\("profiles"\)\.select\("id, gender, age_range, city, state, country, created_at, role"\)/);
});

test("the Fan Growth chart buckets by first-play month (firstPlayMonthByUser), not signup month — consistent with fan meaning streamed, not signed up", () => {
  const src = read("src/app/api/admin/analytics/route.js");
  const fnAt = src.indexOf("const firstPlayMonthByUser = new Map();");
  assert.ok(fnAt > -1);
  const usageAt = src.indexOf("for (const iso of firstPlayMonthByUser.values())");
  assert.ok(usageAt > fnAt, "the month-bucketing loop must actually consume firstPlayMonthByUser");
  assert.doesNotMatch(src, /if \(p\.created_at\) \{\s*\n\s*const m = p\.created_at\.slice\(0, 7\);/,
    "the old signup-date month bucketing must be gone, not left alongside the new one");
});

// ── UI labels no longer claim "signups"/"accounts" for a streamed-based count ──

test("every Total Fans KPI label now reads 'Streamed at least once' instead of the stale 'All-time signups'/'All-time accounts' text", () => {
  const dashboard = read("src/components/account/AnalyticsDashboard.js");
  const globalMapPage = read("src/app/admin/analytics/page.js");
  assert.doesNotMatch(dashboard, /All-time accounts/);
  assert.doesNotMatch(globalMapPage, /All-time signups/);
  const dashboardMatches = [...dashboard.matchAll(/sub="Streamed at least once"/g)];
  assert.equal(dashboardMatches.length, 2, "both the Overview and Audience tabs' Total Fans tiles must carry the corrected label");
  assert.match(globalMapPage, /sub="Streamed at least once"/);
});
