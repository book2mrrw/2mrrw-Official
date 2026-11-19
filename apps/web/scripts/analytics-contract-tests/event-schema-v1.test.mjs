import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
// PGlite is a pinned devDependency; PGLITE_MODULE can point at another build.
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");

const migration = await fs.readFile(new URL("../../supabase/migrations/20261119210000_analytics_event_schema_v1.sql", import.meta.url), "utf8");

// media_stream_events exactly as production had it before v1 (columns,
// constraints and foreign keys read from the live catalog on 2026-11-19).
const PRODUCTION_BASELINE = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  create table public.products (id uuid primary key, slug text unique);
  create table public.media_stream_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete set null,
    product_slug text,
    event_type text not null,
    media_type text not null default 'audio',
    position_seconds integer,
    duration_seconds integer,
    completion_rate numeric,
    country text, region text, city text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    product_id uuid references public.products(id) on delete set null,
    constraint media_stream_events_event_type_check check (event_type = any (array['play','progress','complete','replay','save'])),
    constraint media_stream_events_media_type_check check (media_type = any (array['audio','video','livestream','vault']))
  );`;

async function fresh({ applyTwice = false } = {}) {
  const db = new PGlite();
  await db.exec(PRODUCTION_BASELINE);
  await db.exec("insert into public.media_stream_events (product_slug, event_type) values ('w2d','play'), ('w2d','progress')");
  await db.exec(migration);
  if (applyTwice) await db.exec(migration);
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const rejects = async (sql, params = []) => assert.rejects(db.query(sql, params));
  return { db, one, rejects };
}

const E1 = "3f2b8c1e-9d4a-4b7e-8f21-0c5d6e7f8a9b";

test("existing rows survive and keep their values; new columns take safe defaults", async () => {
  const { one } = await fresh();
  const r = await one("select count(*)::int n, bool_and(not is_internal) internal_off, bool_and(not offline) offline_off, max(schema_version) v from public.media_stream_events");
  assert.deepEqual(r, { n: 2, internal_off: true, offline_off: true, v: 0 });
});

test("the migration can be applied twice without error", async () => {
  await fresh({ applyTwice: true });
});

test("every v1 event type is accepted; anything else is still rejected", async () => {
  const { db, rejects } = await fresh();
  for (const t of ["play", "qualified", "progress", "pause", "seek", "skip", "complete", "replay", "save", "download", "download_remove"]) {
    await db.query("insert into public.media_stream_events (product_slug, event_type) values ('x', $1)", [t]);
  }
  await rejects("insert into public.media_stream_events (product_slug, event_type) values ('x','hack')");
});

test("platform and access tier only accept known values", async () => {
  const { db, rejects } = await fresh();
  await db.query("insert into public.media_stream_events (product_slug, event_type, platform, access_tier) values ('x','play','ios','preview')");
  await rejects("insert into public.media_stream_events (product_slug, event_type, platform) values ('x','play','windows')");
  await rejects("insert into public.media_stream_events (product_slug, event_type, access_tier) values ('x','play','vip')");
});

test("an event delivered twice is stored once (ON CONFLICT (event_id) DO NOTHING, as the route upserts)", async () => {
  const { db, one } = await fresh();
  const insert = "insert into public.media_stream_events (event_id, product_slug, event_type) values ($1,'w2d','play') on conflict (event_id) do nothing";
  await db.query(insert, [E1]);
  await db.query(insert, [E1]);
  assert.equal((await one("select count(*)::int n from public.media_stream_events where event_id=$1", [E1])).n, 1);
});

test("legacy rows without an event_id never conflict with each other", async () => {
  const { db, one } = await fresh();
  await db.query("insert into public.media_stream_events (product_slug, event_type) values ('w2d','play') on conflict (event_id) do nothing");
  await db.query("insert into public.media_stream_events (product_slug, event_type) values ('w2d','play') on conflict (event_id) do nothing");
  assert.equal((await one("select count(*)::int n from public.media_stream_events where event_id is null and event_type='play'")).n, 3);
});

test("deleting a fan's account keeps their plays (user_id becomes null) — lifetime totals do not shrink", async () => {
  const { db, one } = await fresh();
  const uid = "11111111-1111-4111-8111-111111111111";
  await db.query("insert into auth.users (id) values ($1)", [uid]);
  await db.query("insert into public.media_stream_events (user_id, product_slug, event_type) values ($1,'w2d','play')", [uid]);
  await db.query("delete from auth.users where id=$1", [uid]);
  assert.equal((await one("select count(*)::int n from public.media_stream_events where event_type='play'")).n, 2);
});
