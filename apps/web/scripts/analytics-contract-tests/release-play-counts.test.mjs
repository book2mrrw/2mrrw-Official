import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
// PGlite is a pinned devDependency; PGLITE_MODULE can point at another build.
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");

const read = (name) => fs.readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const chain = await Promise.all([
  "20261119210000_analytics_event_schema_v1.sql",
  "20261119220000_analytics_metrics_v2.sql",
  "20261119223000_analytics_rates_from_v1_listens.sql",
  "20261119240000_analytics_platforms.sql",
].map(read));
const playCounts = await read("20261120000000_release_play_counts.sql");

const BASE = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create table public.products (id uuid primary key, slug text unique, title text, product_type text);
  create table public.catalog_tracks (product_id uuid, slug text, title text);
  create table public.profiles (id uuid primary key, created_at timestamptz default now(), gender text, age_range text, country text, state text, city text, first_touch jsonb);
  create table public.purchases (id uuid primary key default gen_random_uuid(), user_id uuid, status text, amount_cents int, purchased_at timestamptz default now(), created_at timestamptz default now());
  create table public.media_stream_events (
    id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
    product_slug text, event_type text not null, media_type text not null default 'audio',
    position_seconds integer, duration_seconds integer, completion_rate numeric, country text, region text, city text,
    metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
    product_id uuid references public.products(id) on delete set null,
    constraint media_stream_events_event_type_check check (event_type = any (array['play','progress','complete','replay','save'])));`;

const SINGLE = "a0000000-0000-4000-8000-000000000002";
const ALBUM = "a0000000-0000-4000-8000-000000000001";

async function fresh() {
  const db = new PGlite();
  await db.exec(BASE);
  for (const sql of chain) await db.exec(sql);
  await db.exec(`
    insert into public.products values ('${SINGLE}', 'w2d', 'W2D', 'single'), ('${ALBUM}', 'love-hz-vol-1', 'Love Hz', 'album');
    -- before product_id existed: keyed by the release slug only
    insert into public.media_stream_events (product_slug, event_type) values ('w2d','play'), ('w2d','play'), ('love-hz-vol-1','play'), ('love-hz-vol-1','complete'), ('unknown-slug','play');
    -- v1 rows: one fan play per release, plus admin and preview plays that must not count
    insert into public.media_stream_events (product_id, product_slug, track_slug, event_type, access_tier, is_internal) values
      ('${ALBUM}', 'love-hz-vol-1', '08-knock-on-wood', 'play', 'full', false),
      ('${SINGLE}', 'w2d', null, 'play', 'admin', true),
      ('${SINGLE}', 'w2d', null, 'play', 'preview', false),
      -- an internal session whose tier says full: is_internal alone must exclude it
      ('${SINGLE}', 'w2d', null, 'play', 'full', true);
  `);
  await db.exec(playCounts);
  const rows = async (sql) => (await db.query(sql)).rows;
  return { db, rows };
}

test("lifetime fan plays per release: older slug-keyed plays included; admin and preview plays never", async () => {
  const { rows } = await fresh();
  const counts = Object.fromEntries((await rows("select product_id, plays from public.release_play_counts()")).map((r) => [r.product_id, Number(r.plays)]));
  assert.equal(counts[SINGLE], 2, "two older plays; the admin and preview plays are excluded");
  assert.equal(counts[ALBUM], 2, "one older album play + one album-song play; completes are not plays");
});

test("the backfill only fills missing release references and is safe to re-run", async () => {
  const { db, rows } = await fresh();
  assert.equal(Number((await rows("select count(*) n from public.media_stream_events where product_id is null"))[0].n), 1, "an unknown slug stays unattached");
  await db.exec(playCounts);
  const counts = await rows("select sum(plays)::int total from public.release_play_counts()");
  assert.equal(counts[0].total, 4, "re-running changes nothing");
});

test("counting uses the partial fan-plays index; the browser cannot call the function", async () => {
  const { rows } = await fresh();
  const idx = await rows("select indexdef from pg_indexes where indexname = 'media_stream_events_fan_plays_idx'");
  assert.match(idx[0].indexdef, /WHERE \(\(event_type = 'play'::text\) AND \(NOT is_internal\)/);
  for (const role of ["anon", "authenticated"]) {
    const r = await rows(`select has_function_privilege('${role}', 'public.release_play_counts()', 'execute') can`);
    assert.equal(r[0].can, false, role);
  }
});
