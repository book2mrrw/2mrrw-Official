-- Completion and skip rates from trustworthy listens only.
--
-- Before schema v1 (2026-11-19) the player recorded 'complete' for admin and
-- preview listening while suppressing their 'play', so legacy history has more
-- completes than plays for some songs (Love Hz Vol. 1: 430 vs 292) and a rate
-- computed from it is meaningless. Rates now use schema-v1 events only, where
-- every play, complete and skip carries the server's admin flag and the access
-- tier; songs with no v1 plays show no rate ("—") instead of a wrong one.
-- Play, complete and skip COUNTS are unchanged and still include all history.

create or replace function public.analytics_track_stats(p_from timestamptz default null, p_to timestamptz default null)
returns table (
  product_id uuid, release_slug text, release_title text, release_type text,
  song_slug text, title text,
  plays bigint, qualified_plays bigint, completes bigint, skips bigint,
  listeners bigint, repeat_listeners bigint, listen_seconds numeric,
  completion_rate numeric, skip_rate numeric, downloads bigint
)
language sql stable set search_path = public as $$
  with ev as (
    select * from public.analytics_fan_events
    where product_id is not null
      and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  ),
  per_listener as (
    select product_id, song_slug, listener_key, count(*) filter (where event_type = 'play') as starts
    from ev where listener_key is not null
    group by product_id, song_slug, listener_key
  ),
  repeaters as (
    select product_id, song_slug, count(*) filter (where starts >= 2) as repeat_listeners
    from per_listener group by product_id, song_slug
  ),
  heard as (
    select product_id, song_slug, sum(h) as listen_seconds from (
      select product_id, song_slug, listen_id, max(listened_seconds) as h
      from ev where listen_id is not null and listened_seconds is not null
      group by product_id, song_slug, listen_id
    ) x group by product_id, song_slug
  ),
  agg as (
    select
      product_id, song_slug,
      count(*) filter (where event_type = 'play') as plays,
      count(*) filter (where event_type = 'qualified') as qualified_plays,
      count(*) filter (where event_type = 'complete') as completes,
      count(*) filter (where event_type = 'skip') as skips,
      count(distinct listener_key) filter (where event_type in ('play', 'qualified', 'complete')) as listeners,
      count(*) filter (where event_type = 'download') as downloads,
      -- Rates come only from schema-v1 listens, whose completes and skips
      -- carry the same admin/preview flags as their plays.
      count(*) filter (where event_type = 'play' and schema_version >= 1) as rated_plays,
      count(*) filter (where event_type = 'complete' and schema_version >= 1) as rated_completes,
      count(*) filter (where event_type = 'skip' and schema_version >= 1) as rated_skips
    from ev group by product_id, song_slug
  )
  select
    a.product_id, p.slug, p.title, p.product_type,
    a.song_slug,
    coalesce(ct.title, case when a.song_slug is null then p.title end, a.song_slug),
    a.plays, a.qualified_plays, a.completes, a.skips,
    a.listeners, coalesce(r.repeat_listeners, 0), coalesce(h.listen_seconds, 0),
    case when a.rated_plays > 0 then least(1, round(a.rated_completes::numeric / a.rated_plays, 4)) end,
    case when a.rated_plays > 0 then least(1, round(a.rated_skips::numeric / a.rated_plays, 4)) end,
    a.downloads
  from agg a
  join public.products p on p.id = a.product_id
  left join public.catalog_tracks ct on ct.product_id = a.product_id and ct.slug = a.song_slug
  left join repeaters r on r.product_id = a.product_id and r.song_slug is not distinct from a.song_slug
  left join heard h on h.product_id = a.product_id and h.song_slug is not distinct from a.song_slug
  order by a.plays desc, a.qualified_plays desc;
$$;

revoke all on function public.analytics_track_stats(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.analytics_track_stats(timestamptz, timestamptz) to service_role;
