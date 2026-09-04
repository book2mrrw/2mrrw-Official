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

// ── scope confirmation: no playback-file touch for P4 ───────────────────────

test("P4 does not touch any playback-engine file — queue/shuffle analytics was deliberately deferred, only peak-time/day-of-week shipped", () => {
  for (const file of [
    "src/lib/playback/PlaybackQueueCommands.js",
    "src/lib/playback/PlaybackEventHandlers.js",
    "src/lib/playback/PlaybackTransportCommands.js",
    "src/lib/playback/audio-engine-runtime.js",
  ]) {
    assert.doesNotMatch(read(file), /get_listening_time_patterns|analytics\/timing/,
      `${file} must have zero references to the new timing analytics — this slice is pure read-side over existing media_stream_events rows`);
  }
});

// ── get_listening_time_patterns RPC ─────────────────────────────────────────

test("get_listening_time_patterns buckets existing media_stream_events rows by UTC hour and day-of-week — no new column, no new write path", () => {
  const sql = readOnlyMigration("listening_time_patterns");
  const fnAt = sql.indexOf("create or replace function public.get_listening_time_patterns");
  const body = sql.slice(fnAt, sql.indexOf("$$;", fnAt));
  assert.match(body, /extract\(hour from created_at\)::int as hour_of_day/);
  assert.match(body, /extract\(dow from created_at\)::int as day_of_week/);
  assert.match(body, /from public\.media_stream_events\s*\n\s*where event_type = 'play'/);
  assert.match(body, /group by hour_of_day, day_of_week/);
});

test("the RPC is granted to service_role, matching every other analytics RPC's grant pattern", () => {
  const sql = readOnlyMigration("listening_time_patterns");
  assert.match(sql, /grant execute on function public\.get_listening_time_patterns\(timestamptz\) to service_role;/);
});

// ── /api/admin/analytics/timing route ───────────────────────────────────────

test("the timing route is admin-gated under its own rate-limit key", () => {
  const src = read("src/app/api/admin/analytics/timing/route.js");
  assert.match(src, /if \(!user \|\| !isAdminUser\(user\)\) \{\s*return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);/);
  assert.match(src, /routeKey: "admin\.analytics\.timing",/);
  assert.match(src, /admin\.rpc\("get_listening_time_patterns", \{ since: ninetyDaysAgo \}\)/);
});

test("the route derives peakHour and peakDay by summing across the other axis, not just taking the single busiest cell", () => {
  const src = read("src/app/api/admin/analytics/timing/route.js");
  const byHourAt = src.indexOf("const byHour = Array.from");
  const body = src.slice(byHourAt, byHourAt + 700);
  assert.match(body, /byHour\[cell\.hour\] \+= cell\.plays;/);
  assert.match(body, /byDay\[cell\.day\] \+= cell\.plays;/);
  assert.match(body, /const peakHour = byHour\.reduce\(/);
  assert.match(body, /const peakDay = byDay\.reduce\(/);
});

// ── Timing UI tab: additive, lazy, isolated ──────────────────────────────

test("the Timing tab is added without touching the other tab definitions, and fetches lazily only once opened", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const tabsAt = src.indexOf("const TABS = [");
  const tabsBody = src.slice(tabsAt, src.indexOf("];", tabsAt));
  assert.match(tabsBody, /\{ id:"timing",   label:"Timing"   \}/);

  assert.match(src, /const \[timingData,\s+setTimingData\]\s+= useState\(null\);/);
  const effectAt = src.indexOf('if (tab==="timing" && !timingData && !timingLoading) loadTiming();');
  assert.ok(effectAt > -1, "timing must fetch only when its own tab is opened, matching the Revenue/Funnels tabs' lazy pattern");

  const originalLoadAt = src.indexOf("const load = useCallback(() => {");
  const originalLoadBody = src.slice(originalLoadAt, src.indexOf("}, []);", originalLoadAt));
  assert.doesNotMatch(originalLoadBody, /timing/i, "the original overview/audience/tracks load must be completely untouched by the new tab");
});

test("TimingTab defaults to Global (UTC) and labels the heatmap accordingly, so the UI never implies local time for the default view", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const fnAt = src.indexOf("function TimingTab(");
  const body = src.slice(fnAt, fnAt + 5000);
  assert.match(body, /const \[regionKey, setRegionKey\] = useState\("__global__"\);/);
  assert.match(body, /\{ key:"__global__", label:"Global \(UTC\)", cells:globalCells, peakHour:globalPeakHour, peakDay:globalPeakDay, tzLabel:"UTC" \}/);
  assert.match(body, /All times UTC — pick a region above for its own local time/);
});

test("TimingTab renders a 7x24 grid keyed by (day, hour) with no crash on an empty cells list", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const fnAt = src.indexOf("function TimingTab(");
  const body = src.slice(fnAt, fnAt + 6000);
  assert.match(body, /cells\.length===0 \? \(/);
  assert.match(body, /const cellFor = \(day, hour\) => cells\.find\(c=>c\.day===day && c\.hour===hour\);/);
  assert.match(body, /DAY_NAMES\.map\(\(name, day\)=>\(/);
});

test("TimingTab offers a region selector fed by the route's regions array, each showing its own already-local-time peak hour/day", () => {
  const src = read("src/components/account/AnalyticsDashboard.js");
  const fnAt = src.indexOf("function TimingTab(");
  const body = src.slice(fnAt, fnAt + 6000);
  assert.match(body, /\.\.\.regions\.map\(r=>\(\{ key:r\.region, label:r\.region, cells:r\.cells, peakHour:r\.peakHour, peakDay:r\.peakDay, tzLabel:`\$\{r\.region\} local time` \}\)\)/);
  assert.match(body, /<select value=\{regionKey\} onChange=\{e=>setRegionKey\(e\.target\.value\)\}/);
});
