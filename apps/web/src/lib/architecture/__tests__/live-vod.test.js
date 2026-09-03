import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("live_broadcast_vods migration exists, is metadata-only, and restricts public read to published rows", () => {
  const migrationDir = path.join(root, "supabase", "migrations");
  const files = fs.readdirSync(migrationDir).filter((f) => f.includes("live_broadcast_vods"));
  assert.equal(files.length, 1, "expected exactly one live_broadcast_vods migration");
  const sql = fs.readFileSync(path.join(migrationDir, files[0]), "utf8");
  assert.match(sql, /create table if not exists public\.live_broadcast_vods/);
  assert.match(sql, /unique references public\.live_broadcasts\(id\)/);
  assert.match(sql, /for select using \(published = true\)/);
});

test("VOD capture only accepts a Twitch VOD created after the candidate broadcast actually started", () => {
  const src = read("src/lib/server/live-vod.js");
  assert.match(src, /type=archive/);
  const matchAt = src.indexOf("pending.find(");
  const compareAt = src.indexOf("Date.parse(vod.created_at) >= Date.parse(", matchAt);
  assert.ok(matchAt > -1 && compareAt > matchAt,
    "a fetched VOD must be checked against the candidate broadcast's start time before being attributed to it");
});

test("VOD capture is idempotent — a duplicate insert on the unique broadcast_id constraint is not treated as a failure", () => {
  const src = read("src/lib/server/live-vod.js");
  assert.match(src, /insertError\.code !== "23505"/);
});

test("VOD capture never blocks or fails the core Twitch live-state reconciliation cron", () => {
  const src = read("src/app/api/cron/twitch-live-reconcile/route.js");
  assert.match(src, /reconcileMissingVods\(admin\)\.catch\(/);
});

test("publishing/unpublishing a VOD uses the standard admin session guard; deleting uses the stronger MFA-recency guard", () => {
  const src = read("src/app/api/admin/live/vods/[id]/route.js");
  const patchAt = src.indexOf("export async function PATCH");
  const deleteAt = src.indexOf("export async function DELETE");
  const patchGuardAt = src.indexOf("getAdminSessionUser()", patchAt);
  const deleteGuardAt = src.indexOf("requireAdminActor(", deleteAt);
  assert.ok(patchGuardAt > patchAt && patchGuardAt < deleteAt,
    "PATCH must use the lighter session guard");
  assert.ok(deleteGuardAt > deleteAt, "DELETE must use requireAdminActor");
});

test("replay access is resolved per-VOD with the exact same function the live paywall uses", () => {
  const src = read("src/app/api/public/live-vods/route.js");
  assert.match(src, /resolveLiveBroadcastAccess\(/);
  const accessAt = src.indexOf("resolveLiveBroadcastAccess(");
  const maskAt = src.indexOf("canView ? vod.twitch_video_id : null", accessAt);
  assert.ok(accessAt > -1 && maskAt > accessAt,
    "the Twitch video id must be masked for any viewer without access");
});

test("public VOD listing only returns published entries", () => {
  const src = read("src/app/api/public/live-vods/route.js");
  assert.match(src, /\.eq\(\s*"published",\s*true\s*\)/);
});
