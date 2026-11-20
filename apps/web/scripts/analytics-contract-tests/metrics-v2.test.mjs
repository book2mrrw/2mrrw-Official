import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
// PGlite is a pinned devDependency; PGLITE_MODULE can point at another build.
const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite");

const read = (name) => fs.readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const v1 = await read("20261119210000_analytics_event_schema_v1.sql");
const v2 = await read("20261119220000_analytics_metrics_v2.sql");
const v21 = await read("20261119223000_analytics_rates_from_v1_listens.sql");
const v3p = await read("20261119240000_analytics_platforms.sql");

const BASE = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.products (id uuid primary key, slug text unique, title text, product_type text);
  create table public.catalog_tracks (product_id uuid references public.products(id), slug text, title text);
  create table public.profiles (id uuid primary key, created_at timestamptz default now(), gender text, age_range text,
    country text, state text, city text, first_touch jsonb);
  create table public.purchases (id uuid primary key default gen_random_uuid(), user_id uuid, status text, amount_cents int,
    purchased_at timestamptz default now(), created_at timestamptz default now());
  create table public.media_stream_events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete set null,
    product_slug text, event_type text not null, media_type text not null default 'audio',
    position_seconds integer, duration_seconds integer, completion_rate numeric,
    country text, region text, city text, metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    product_id uuid references public.products(id) on delete set null,
    constraint media_stream_events_event_type_check check (event_type = any (array['play','progress','complete','replay','save']))
  );`;

// Fixture ids
const ALBUM = "a0000000-0000-4000-8000-000000000001";
const SINGLE = "a0000000-0000-4000-8000-000000000002";
const FAN = "f0000000-0000-4000-8000-000000000001";
const FAN2 = "f0000000-0000-4000-8000-000000000002";
const DEV_A = "d0000000-0000-4000-8000-00000000000a"; // later signs in as FAN
const DEV_B = "d0000000-0000-4000-8000-00000000000b"; // stays anonymous
const L1 = "10000000-0000-4000-8000-000000000001";
const L2 = "10000000-0000-4000-8000-000000000002";
const L3 = "10000000-0000-4000-8000-000000000003";

async function seeded() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(v1);
  await db.exec(v2);
  await db.exec(v21);
  await db.exec(v3p);
  await db.exec(`
    insert into auth.users values ('${FAN}'), ('${FAN2}');
    insert into public.products values
      ('${ALBUM}', 'love-hz-vol-1', 'Love Hz Vol. 1', 'album'),
      ('${SINGLE}', 'w2d', 'W2D', 'single');
    insert into public.catalog_tracks values ('${ALBUM}', '08-knock-on-wood', 'Knock On Wood');
    insert into public.profiles (id, gender, age_range, country, state, city, created_at) values
      ('${FAN}', 'male', '25-40', 'United States', 'tx', 'Austin', now() - interval '20 days'),
      ('${FAN2}', null, null, null, null, null, now() - interval '400 days');
  `);
  const ev = (cols) => db.query(
    `insert into public.media_stream_events (user_id, device_id, product_id, product_slug, track_slug, event_type, listen_id,
       listened_seconds, access_tier, is_internal, country, region, city, created_at, schema_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10,false),$11,$12,$13,coalesce($14, now()),1)`,
    [cols.user ?? null, cols.device ?? null, cols.product ?? null, cols.slug ?? null, cols.track ?? null, cols.type,
     cols.listen ?? null, cols.heard ?? null, cols.tier ?? null, cols.internal ?? null,
     cols.country ?? "US", cols.region ?? "TX", cols.city ?? "Austin", cols.at ?? null]);

  // Listen 1: anonymous device A plays the album song, qualifies, completes (then signs in later).
  await ev({ device: DEV_A, product: ALBUM, slug: "love-hz-vol-1", track: "08-knock-on-wood", type: "play", listen: L1, heard: 0, tier: "full" });
  await ev({ device: DEV_A, product: ALBUM, slug: "love-hz-vol-1", track: "08-knock-on-wood", type: "qualified", listen: L1, heard: 30, tier: "full" });
  await ev({ device: DEV_A, product: ALBUM, slug: "love-hz-vol-1", track: "08-knock-on-wood", type: "complete", listen: L1, heard: 200, tier: "full" });
  // Listen 2: same person, now signed in (FAN) on device A, plays it again and skips at 12 s.
  await ev({ user: FAN, device: DEV_A, product: ALBUM, slug: "love-hz-vol-1", track: "08-knock-on-wood", type: "play", listen: L2, heard: 0, tier: "full" });
  await ev({ user: FAN, device: DEV_A, product: ALBUM, slug: "love-hz-vol-1", track: "08-knock-on-wood", type: "skip", listen: L2, heard: 12, tier: "full" });
  // Listen 3: anonymous device B plays the single in Dallas, qualifies.
  await ev({ device: DEV_B, product: SINGLE, slug: "w2d", type: "play", listen: L3, heard: 0, tier: "full", city: "Dallas" });
  await ev({ device: DEV_B, product: SINGLE, slug: "w2d", type: "qualified", listen: L3, heard: 31, tier: "full", city: "Dallas" });
  // Never counted: an admin session and a preview.
  await ev({ user: FAN2, product: SINGLE, slug: "w2d", type: "play", internal: true, tier: "admin" });
  await ev({ device: DEV_B, product: SINGLE, slug: "w2d", type: "play", tier: "preview" });
  // Legacy (pre-v1) album play keyed by the album slug, 200 days ago.
  await db.query(`insert into public.media_stream_events (product_id, product_slug, event_type, country, region, city, created_at)
                  values ($1, 'love-hz-vol-1', 'play', 'US', null, 'Houston', now() - interval '200 days')`, [ALBUM]);
  // An in-app offline download.
  await ev({ device: DEV_B, product: SINGLE, slug: "w2d", type: "download", tier: "full" });

  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  return { db, rows, one: async (sql, params) => (await rows(sql, params))[0] };
}

test("lifetime overview: admin and preview excluded; a device that signs in is one listener, not two", async () => {
  const { one } = await seeded();
  const o = await one("select * from public.analytics_overview()");
  assert.equal(Number(o.plays), 4, "3 fan plays + 1 legacy play; admin and preview excluded");
  assert.equal(Number(o.qualified_plays), 2);
  assert.equal(Number(o.completes), 1);
  assert.equal(Number(o.skips), 1);
  assert.equal(Number(o.listeners), 2, "device A (= FAN) and device B; the legacy anonymous play has no listener id");
  assert.equal(Number(o.fans), 1, "only FAN is signed in");
  assert.equal(Number(o.listen_seconds), 243, "max heard per listen: 200 + 12 + 31");
  assert.equal(Number(o.downloads), 1);
});

test("a window excludes older history; NULL bounds mean lifetime", async () => {
  const { one } = await seeded();
  const recent = await one("select plays from public.analytics_overview(now() - interval '30 days', null)");
  assert.equal(Number(recent.plays), 3, "the 200-day-old legacy play is outside 30 days");
});

test("per song: album songs are separate from the album; completion and skip rates are per play", async () => {
  const { rows } = await seeded();
  const songs = await rows("select * from public.analytics_track_stats() order by release_slug, song_slug nulls first");
  const knock = songs.find((s) => s.song_slug === "08-knock-on-wood");
  assert.equal(knock.title, "Knock On Wood");
  assert.equal(Number(knock.plays), 2);
  assert.equal(Number(knock.qualified_plays), 1);
  assert.equal(Number(knock.listeners), 1, "the device and the signed-in fan are the same person");
  assert.equal(Number(knock.repeat_listeners), 1, "that person started it twice");
  assert.equal(Number(knock.completion_rate), 0.5);
  assert.equal(Number(knock.skip_rate), 0.5);
  assert.equal(Number(knock.listen_seconds), 212);
  const albumLevel = songs.find((s) => s.release_slug === "love-hz-vol-1" && s.song_slug === null);
  assert.equal(Number(albumLevel.plays), 1, "the legacy album-slug play stays album-level, never merged into a song");
  const w2d = songs.find((s) => s.release_slug === "w2d");
  assert.equal(w2d.song_slug, null);
  assert.equal(w2d.title, "W2D");
  assert.equal(Number(w2d.plays), 1, "preview and admin plays excluded");
  assert.equal(Number(w2d.downloads), 1);
});

test("geography: each level is counted on its own; a play and its complete are one play", async () => {
  const { rows } = await seeded();
  const geo = await rows("select * from public.analytics_geo()");
  const us = geo.find((g) => g.level === "country" && g.country === "US");
  assert.equal(Number(us.plays), 4);
  assert.equal(Number(us.listeners), 2);
  const tx = geo.find((g) => g.level === "region" && g.region === "TX");
  assert.equal(Number(tx.plays), 3);
  const austin = geo.find((g) => g.level === "city" && g.city === "Austin");
  assert.equal(Number(austin.plays), 2);
  assert.equal(Number(austin.completes), 1);
  assert.ok(!geo.some((g) => g.city === "Austin" && g.level === "city" && Number(g.plays) > 2), "no double counting");
});

test("daily series and listener growth use the artist's local days", async () => {
  const { rows } = await seeded();
  const days = await rows("select * from public.analytics_daily(null, null, 'America/Chicago')");
  assert.equal(days.reduce((s, d) => s + Number(d.plays), 0), 4);
  const growth = await rows("select * from public.analytics_listener_growth('America/Chicago')");
  assert.equal(growth.reduce((s, g) => s + Number(g.new_listeners), 0), 2);
  assert.equal(growth.reduce((s, g) => s + Number(g.new_fans), 0), 1);
});

test("demographics cover signed-in fans only, from their profiles", async () => {
  const { rows } = await seeded();
  const d = await rows("select * from public.analytics_fan_demographics()");
  const get = (dim, val) => Number(d.find((r) => r.dimension === dim && r.value === val)?.fans || 0);
  assert.equal(get("total", "all"), 1);
  assert.equal(get("gender", "male"), 1);
  assert.equal(get("state", "TX"), 1);
  assert.equal(get("city", "Austin|TX"), 1);
});

test("funnel counts a signed-in fan's listening as streamed; admins are not fans", async () => {
  const { one } = await seeded();
  const f = await one("select * from public.get_funnel_stats(now() - interval '90 days')");
  assert.equal(Number(f.signups), 1, "FAN signed up 20 days ago");
  assert.equal(Number(f.streamed), 1);
});

test("attribution: referrer-only visits are referral traffic from that site, not direct", async () => {
  const { db, rows } = await seeded();
  await db.exec(`update public.profiles set first_touch = '{"referrer":"https://www.instagram.com/2mrrw/"}' where id = '${FAN}'`);
  const a = await rows("select * from public.get_attribution_breakdown(now() - interval '90 days')");
  assert.equal(a[0].source, "referral:instagram.com");
  assert.equal(a[0].medium, "referral");
});

test("listening times: global hours are Central time; regional patterns use the region code; admins excluded", async () => {
  const { db, rows } = await seeded();
  // 2026-07-01 02:30 UTC = 2026-06-30 21:30 Central (CDT): hour 21, Tuesday (dow 2).
  await db.query(`insert into public.media_stream_events (product_id, product_slug, event_type, country, region, access_tier, created_at)
                  values ($1, 'w2d', 'play', 'US', 'CA', 'full', '2026-07-01T02:30:00Z')`, [SINGLE]);
  const global = await rows("select * from public.get_listening_time_patterns('2026-06-01')");
  assert.deepEqual(global.map((r) => [r.hour_of_day, r.day_of_week, Number(r.plays)]).find((r) => r[0] === 21), [21, 2, 1]);
  const regional = await rows("select * from public.get_regional_listening_patterns('2026-06-01')");
  const pacific = regional.filter((r) => r.region === "US — Pacific");
  assert.equal(pacific.reduce((s, r) => s + Number(r.plays), 0), 1, "a California play lands in US — Pacific");
  const all = regional.reduce((s, r) => s + Number(r.plays), 0);
  assert.equal(all, 4, "3 recent fan plays + the California play; the admin and preview plays are excluded, the 200-day-old play is outside the window");
});

test("rates ignore legacy history: extra legacy completes never produce a fake 100%, and v1-free songs show no rate", async () => {
  const { db, rows } = await seeded();
  // Legacy (schema 0): 1 play, 3 completes for the single — the pre-v1 admin/preview pattern.
  await db.query(`insert into public.media_stream_events (product_id, product_slug, event_type) values ($1,'w2d','play'),($1,'w2d','complete'),($1,'w2d','complete'),($1,'w2d','complete')`, [SINGLE]);
  const songs = await rows("select * from public.analytics_track_stats()");
  const w2d = songs.find((s) => s.release_slug === "w2d");
  assert.equal(Number(w2d.plays), 2, "counts still include history");
  assert.equal(Number(w2d.completes), 3);
  assert.equal(Number(w2d.completion_rate), 0, "only the v1 listen (no complete) is rated");
  const albumLevel = songs.find((s) => s.release_slug === "love-hz-vol-1" && s.song_slug === null);
  assert.equal(albumLevel.completion_rate, null, "legacy-only rows get no rate rather than a wrong one");
});

test("the browser can read neither the fan view nor any analytics function", async () => {
  const { rows } = await seeded();
  const fns = ["analytics_overview", "analytics_track_stats", "analytics_daily", "analytics_geo", "analytics_listener_growth",
    "analytics_fan_demographics", "get_funnel_stats", "get_cohort_retention", "get_attribution_breakdown",
    "get_listening_time_patterns", "get_regional_listening_patterns"];
  for (const role of ["anon", "authenticated"]) {
    const r = await rows(`select bool_or(has_function_privilege('${role}', p.oid, 'execute')) as any_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1)`, [fns]);
    assert.equal(r[0].any_exec, false, `${role} must not execute analytics functions`);
    const v = await rows(`select has_table_privilege('${role}', 'public.analytics_fan_events', 'select') as can`);
    assert.equal(v[0].can, false, `${role} must not read the fan view`);
  }
});

test("platforms: the fan view carries device_class after re-creation, and listening is split by where it happened", async () => {
  const { db, rows } = await seeded();
  await db.exec(`update public.media_stream_events set platform = 'ios', device_class = 'phone' where device_id = '${DEV_A}';
                 update public.media_stream_events set platform = 'web', device_class = 'desktop' where device_id = '${DEV_B}'`);
  const p = await rows("select * from public.analytics_platform_breakdown()");
  const get = (pl, dc) => p.find((r) => r.platform === pl && r.device_class === dc);
  assert.equal(Number(get("ios", "phone").plays), 2);
  assert.equal(Number(get("ios", "phone").listeners), 1);
  assert.equal(Number(get("ios", "phone").listen_seconds), 212);
  assert.equal(Number(get("web", "desktop").plays), 1, "preview play from that device excluded");
  assert.equal(Number(get("unknown", "unknown").plays), 1, "the legacy play is kept, labelled as before platform tracking");
  const o = (await rows("select plays from public.analytics_overview()"))[0];
  assert.equal(Number(o.plays), 4, "every other metric still works after the view was re-created");
});

test("device_class only accepts phone, tablet or desktop; the breakdown is closed to the browser", async () => {
  const { db, rows } = await seeded();
  await assert.rejects(db.query("insert into public.media_stream_events (product_slug, event_type, device_class) values ('x','play','fridge')"));
  const r = await rows("select has_function_privilege('anon', 'public.analytics_platform_breakdown(timestamptz, timestamptz)', 'execute') a");
  assert.equal(r[0].a, false);
});
