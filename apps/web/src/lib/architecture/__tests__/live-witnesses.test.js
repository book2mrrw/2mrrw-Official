import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("witness count comes from Realtime Presence, not a per-viewer database row", () => {
  const src = read("src/hooks/useLiveWitnessCount.js");
  assert.match(src, /supabase\.channel\(/);
  assert.match(src, /config:\s*\{\s*presence:\s*\{\s*key:/);
  assert.match(src, /channel\.presenceState\(\)/);
  // The whole point of Presence here is that nothing gets inserted per
  // viewer — confirm there's no insert/upsert call anywhere in this hook.
  assert.doesNotMatch(src, /\.insert\(|\.upsert\(/);
});

test("a client only reports a live witness count while it can actually view the stream", () => {
  const src = read("src/components/home/LiveCountdownDisplays.js");
  assert.match(src, /useLiveWitnessCount\(\{\s*broadcastId:\s*liveBroadcastId,\s*active:\s*canViewLive && liveIsLive,?\s*\}\)/);
});

test("peak witness reporting is throttled to new local highs only, not continuous", () => {
  const src = read("src/hooks/useLiveWitnessCount.js");
  assert.match(src, /PEAK_REPORT_MIN_INTERVAL_MS/);
  const guardAt = src.indexOf("current > lastReportedPeakRef.current");
  const fetchAt = src.indexOf('fetch("/api/live/witness-peak"');
  assert.ok(guardAt > -1 && fetchAt > guardAt,
    "the peak-report fetch must be gated behind the new-local-high check");
});

test("witness-peak route only ever raises the high-water mark and bounds the reported count", () => {
  const src = read("src/app/api/live/witness-peak/route.js");
  assert.match(src, /MAX_REASONABLE_WITNESS_COUNT/);
  assert.match(src, /parsedCount <= 0/);
  // The update must be conditioned so a report can never lower an existing,
  // higher peak — both the pre-check and the .lt() guard on the write itself.
  assert.match(src, /\.lt\(\s*"peak_witnesses",\s*parsedCount\s*\)/);
});

test("live_broadcasts has a peak_witnesses column and it flows through the status API", () => {
  const migrationDir = path.join(root, "supabase", "migrations");
  const files = fs.readdirSync(migrationDir).filter((f) => f.includes("peak_witnesses"));
  assert.equal(files.length, 1, "expected exactly one peak_witnesses migration");
  const sql = fs.readFileSync(path.join(migrationDir, files[0]), "utf8");
  assert.match(sql, /add column if not exists peak_witnesses integer not null default 0/);

  const livestreamLib = read("src/lib/server/livestream.js");
  assert.match(livestreamLib, /peak_witnesses/);
});
