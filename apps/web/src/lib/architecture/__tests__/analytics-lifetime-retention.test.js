import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import test from "node:test";

// next/server has no ESM entry; resolve it like the other route tests do.
register("data:text/javascript," + encodeURIComponent('export function resolve(s,c,n){return n(s === "next/server" ? "next/server.js" : s,c);}'), import.meta.url);

// Analytics history is the artist's permanent career record. These tests fail
// if anything scheduled can delete it again.

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const ANALYTICS_TABLES = ["media_stream_events", "stream_events", "analytics_events"];

function cronPaths(vercelJsonRel) {
  const full = path.join(root, vercelJsonRel);
  if (!fs.existsSync(full)) return [];
  const parsed = JSON.parse(fs.readFileSync(full, "utf8").replace(/^﻿/, ""));
  return (parsed.crons || []).map((c) => c.path);
}

test("no Vercel cron schedules the analytics purge (apps/web and repo-root vercel.json)", () => {
  for (const rel of ["vercel.json", "../../vercel.json"]) {
    const paths = cronPaths(rel);
    assert.ok(
      !paths.includes("/api/cron/purge-stream-events"),
      `${rel} still schedules /api/cron/purge-stream-events — that job deleted all listening history older than 90 days`
    );
  }
});

test("the retired purge route answers 410 and reports nothing purged", async () => {
  const route = await import(path.join(root, "src/app/api/cron/purge-stream-events/route.js"));
  for (const method of ["GET", "POST"]) {
    const res = await route[method](new Request("https://www.2mrrw.com/api/cron/purge-stream-events", {
      method,
      headers: { authorization: `Bearer ${process.env.CRON_SECRET || "x"}` },
    }));
    assert.equal(res.status, 410, `${method} must answer 410 Gone`);
    const body = await res.json();
    assert.equal(body.purged, 0);
    assert.equal(body.retired, true);
  }
});

test("the retired purge route has no database access at all", () => {
  const src = read("src/app/api/cron/purge-stream-events/route.js");
  assert.doesNotMatch(src, /getAdminClient|supabase|\.delete\(/, "the purge route must not be able to reach the database");
});

test("no scheduled route deletes rows from an analytics event table", () => {
  const scheduled = new Set([...cronPaths("vercel.json"), ...cronPaths("../../vercel.json")]);
  for (const cronPath of scheduled) {
    const rel = path.join("src/app", cronPath, "route.js");
    if (!fs.existsSync(path.join(root, rel))) continue;
    const src = read(rel);
    for (const table of ANALYTICS_TABLES) {
      const deletesTable = new RegExp(`from\\(\\s*["'\`]${table}["'\`]\\s*\\)[\\s\\S]{0,200}?\\.delete\\(`).test(src)
        || new RegExp(`delete\\s+from\\s+(public\\.)?${table}\\b`, "i").test(src);
      assert.ok(!deletesTable, `${rel} (scheduled at ${cronPath}) deletes from ${table}`);
    }
  }
});
