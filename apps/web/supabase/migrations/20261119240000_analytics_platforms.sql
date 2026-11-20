-- Analytics on every platform: iPhone/iPad app, Android app, mobile web,
-- tablet web and desktop web.
--
-- platform (web | ios | android) says WHERE it played; device_class
-- (phone | tablet | desktop) splits mobile web from desktop web. In the app the
-- native player records listening itself (including the lock screen and the
-- background, where the web view is suspended) with platform ios/android.

alter table public.media_stream_events add column if not exists device_class text;
alter table public.media_stream_events drop constraint if exists media_stream_events_device_class_check;
alter table public.media_stream_events add constraint media_stream_events_device_class_check
  check (device_class is null or device_class in ('phone', 'tablet', 'desktop'));
comment on column public.media_stream_events.device_class is 'phone | tablet | desktop (from the device; splits mobile web from desktop web).';

-- The fan view captured the table's columns when it was created; re-create it
-- (identical definition) so it carries device_class. SQL-language functions
-- that read it resolve it at run time, so none of them change.
drop view if exists public.analytics_fan_events;
create view public.analytics_fan_events
with (security_invoker = true) as
with device_owner as (
  select device_id, (array_agg(user_id order by created_at desc))[1] as user_id
  from public.media_stream_events
  where device_id is not null and user_id is not null
  group by device_id
)
select
  e.*,
  coalesce(e.user_id, d.user_id) as fan_id,
  coalesce(e.user_id::text, d.user_id::text, 'd:' || e.device_id::text) as listener_key,
  coalesce(
    nullif(e.track_slug, ''),
    case when p.slug is not null and e.product_slug is distinct from p.slug then e.product_slug end
  ) as song_slug
from public.media_stream_events e
left join device_owner d on d.device_id = e.device_id
left join public.products p on p.id = e.product_id
where not e.is_internal
  and coalesce(e.access_tier, 'full') = 'full';

comment on view public.analytics_fan_events is
  'Fan listening that counts toward analytics: excludes admin sessions and previews; adds listener_key, fan_id and song_slug.';

revoke all on public.analytics_fan_events from public, anon, authenticated;
grant select on public.analytics_fan_events to service_role;

-- Where people listen: one row per platform x device class.
create or replace function public.analytics_platform_breakdown(p_from timestamptz default null, p_to timestamptz default null)
returns table (platform text, device_class text, plays bigint, qualified_plays bigint, listeners bigint, listen_seconds numeric)
language sql stable set search_path = public as $$
  with ev as (
    select *, coalesce(platform, 'unknown') as pf, coalesce(device_class, 'unknown') as dc
    from public.analytics_fan_events
    where (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  ),
  agg as (
    select pf, dc,
      count(*) filter (where event_type = 'play') as plays,
      count(*) filter (where event_type = 'qualified') as qualified_plays,
      count(distinct listener_key) filter (where event_type in ('play', 'qualified', 'complete')) as listeners
    from ev
    group by pf, dc
    having count(*) filter (where event_type in ('play', 'qualified', 'complete')) > 0
  ),
  heard as (
    select pf, dc, sum(h) as listen_seconds from (
      select pf, dc, listen_id, max(listened_seconds) as h
      from ev where listen_id is not null and listened_seconds is not null
      group by pf, dc, listen_id
    ) x group by pf, dc
  )
  select a.pf, a.dc, a.plays, a.qualified_plays, a.listeners, coalesce(h.listen_seconds, 0)
  from agg a left join heard h on h.pf = a.pf and h.dc = a.dc
  order by a.plays desc;
$$;

revoke all on function public.analytics_platform_breakdown(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.analytics_platform_breakdown(timestamptz, timestamptz) to service_role;
