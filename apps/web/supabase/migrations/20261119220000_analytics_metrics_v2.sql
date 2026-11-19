-- Analytics metrics v2 — one tested definition of every listening number.
--
-- Requires 20261119210000_analytics_event_schema_v1.sql.
-- Every function takes an optional [p_from, p_to) window; NULL means lifetime
-- (analytics are the artist's permanent career record).
--
-- Definitions (owner defaults, 2026-11-19):
--   play            a listen started (event_type 'play')
--   qualified play  30 s actually heard, sent once per listen ('qualified');
--                   recorded from 2026-11-19 on, so older periods show plays only
--   listener        a signed-in fan (user_id), else an anonymous install
--                   (device_id); an install later seen signed in counts as that fan
--   fan             a signed-in listener
--   completion      completes / plays for that song
--   counted         fan listening only: never admin sessions (is_internal) and
--                   never previews (access_tier 'preview'); legacy rows (before
--                   v1) have no tier and count as full.

-- ── Countable fan listening ─────────────────────────────────────────────────
create or replace view public.analytics_fan_events
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

-- ── Overview ────────────────────────────────────────────────────────────────
create or replace function public.analytics_overview(p_from timestamptz default null, p_to timestamptz default null)
returns table (
  plays bigint, qualified_plays bigint, completes bigint, skips bigint,
  listeners bigint, fans bigint, listen_seconds numeric,
  downloads bigint, download_removes bigint, first_event_at timestamptz
)
language sql stable set search_path = public as $$
  with ev as (
    select * from public.analytics_fan_events
    where (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  ),
  listens as (
    select listen_id, max(listened_seconds) as heard from ev
    where listen_id is not null and listened_seconds is not null group by listen_id
  )
  select
    count(*) filter (where event_type = 'play'),
    count(*) filter (where event_type = 'qualified'),
    count(*) filter (where event_type = 'complete'),
    count(*) filter (where event_type = 'skip'),
    count(distinct listener_key) filter (where event_type in ('play', 'qualified', 'complete')),
    count(distinct fan_id) filter (where event_type in ('play', 'qualified', 'complete')),
    coalesce((select sum(heard) from listens), 0),
    count(*) filter (where event_type = 'download'),
    count(*) filter (where event_type = 'download_remove'),
    min(created_at)
  from ev;
$$;

-- ── Per song ────────────────────────────────────────────────────────────────
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
      count(*) filter (where event_type = 'download') as downloads
    from ev group by product_id, song_slug
  )
  select
    a.product_id, p.slug, p.title, p.product_type,
    a.song_slug,
    coalesce(ct.title, case when a.song_slug is null then p.title end, a.song_slug),
    a.plays, a.qualified_plays, a.completes, a.skips,
    a.listeners, coalesce(r.repeat_listeners, 0), coalesce(h.listen_seconds, 0),
    case when a.plays > 0 then least(1, round(a.completes::numeric / a.plays, 4)) end,
    case when a.plays > 0 then least(1, round(a.skips::numeric / a.plays, 4)) end,
    a.downloads
  from agg a
  join public.products p on p.id = a.product_id
  left join public.catalog_tracks ct on ct.product_id = a.product_id and ct.slug = a.song_slug
  left join repeaters r on r.product_id = a.product_id and r.song_slug is not distinct from a.song_slug
  left join heard h on h.product_id = a.product_id and h.song_slug is not distinct from a.song_slug
  order by a.plays desc, a.qualified_plays desc;
$$;

-- ── Daily series (artist's local days) ──────────────────────────────────────
create or replace function public.analytics_daily(
  p_from timestamptz default null, p_to timestamptz default null, p_tz text default 'America/Chicago'
)
returns table (day date, plays bigint, qualified_plays bigint, completes bigint, listeners bigint)
language sql stable set search_path = public as $$
  select
    (created_at at time zone p_tz)::date as day,
    count(*) filter (where event_type = 'play'),
    count(*) filter (where event_type = 'qualified'),
    count(*) filter (where event_type = 'complete'),
    count(distinct listener_key) filter (where event_type in ('play', 'qualified', 'complete'))
  from public.analytics_fan_events
  where (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  group by 1
  order by 1;
$$;

-- ── Geography: country → region → city, each level counted on its own ──────
-- (distinct listeners cannot be summed up from cities, so every level is a
-- real GROUPING SET; plays are 'play' events only — no double counting).
create or replace function public.analytics_geo(p_from timestamptz default null, p_to timestamptz default null)
returns table (level text, country text, region text, city text, plays bigint, qualified_plays bigint, completes bigint, listeners bigint)
language sql stable set search_path = public as $$
  select
    case when grouping(region) = 1 then 'country' when grouping(city) = 1 then 'region' else 'city' end,
    country, region, city,
    count(*) filter (where event_type = 'play'),
    count(*) filter (where event_type = 'qualified'),
    count(*) filter (where event_type = 'complete'),
    count(distinct listener_key) filter (where event_type in ('play', 'qualified', 'complete'))
  from public.analytics_fan_events
  where country is not null
    and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  group by grouping sets ((country), (country, region), (country, region, city))
  having count(*) filter (where event_type in ('play', 'qualified', 'complete')) > 0;
$$;

-- ── New listeners per month (first counted listen) ──────────────────────────
create or replace function public.analytics_listener_growth(p_tz text default 'America/Chicago')
returns table (month text, new_listeners bigint, new_fans bigint)
language sql stable set search_path = public as $$
  with firsts as (
    select listener_key, bool_or(fan_id is not null) as is_fan, min(created_at) as first_at
    from public.analytics_fan_events
    where listener_key is not null and event_type in ('play', 'qualified', 'complete')
    group by listener_key
  )
  select to_char(first_at at time zone p_tz, 'YYYY-MM'), count(*), count(*) filter (where is_fan)
  from firsts group by 1 order by 1;
$$;

-- ── Fan demographics (signed-in fans who listened in the window) ────────────
create or replace function public.analytics_fan_demographics(p_from timestamptz default null, p_to timestamptz default null)
returns table (dimension text, value text, fans bigint)
language sql stable set search_path = public as $$
  with fans as (
    select distinct fan_id from public.analytics_fan_events
    where fan_id is not null and event_type in ('play', 'qualified', 'complete')
      and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  ),
  prof as (
    select f.fan_id, pr.gender, pr.age_range, nullif(trim(pr.country), '') as country,
           nullif(upper(trim(pr.state)), '') as state, nullif(trim(pr.city), '') as city
    from fans f left join public.profiles pr on pr.id = f.fan_id
  )
  select 'total', 'all', count(*) from prof
  union all select 'gender', coalesce(gender, 'unknown'), count(*) from prof group by 2
  union all select 'age_range', coalesce(age_range, 'unknown'), count(*) from prof group by 2
  union all select 'profiled', 'gender_and_age', count(*) from prof where gender is not null and age_range is not null
  union all select 'country', country, count(*) from prof where country is not null group by 2
  union all select 'state', state, count(*) from prof where state is not null group by 2
  union all select 'city', city || '|' || coalesce(state, ''), count(*) from prof where city is not null group by 2;
$$;

-- ── Funnels and cohorts: same fan definition (no admins, no previews) ───────
create or replace function public.get_funnel_stats(since timestamptz)
returns table (signups bigint, streamed bigint, purchased bigint)
language sql stable security definer set search_path = public as $$
  with first_stream as (
    select fan_id as user_id, min(created_at) as first_stream_at
    from public.analytics_fan_events
    where event_type in ('play', 'qualified') and fan_id is not null
    group by fan_id
  ),
  first_purchase as (
    select user_id, min(purchased_at) as first_purchase_at
    from public.purchases where status = 'completed' group by user_id
  )
  select
    count(*) filter (where p.created_at >= since),
    count(*) filter (where p.created_at >= since and fs.first_stream_at is not null),
    count(*) filter (where p.created_at >= since and fp.first_purchase_at is not null)
  from public.profiles p
  left join first_stream fs on fs.user_id = p.id
  left join first_purchase fp on fp.user_id = p.id;
$$;

create or replace function public.get_cohort_retention(months_back int default 6)
returns table (cohort_month text, cohort_size bigint, month_offset int, retained_fans bigint)
language sql stable security definer set search_path = public as $$
  with cohorts as (
    select id as user_id, date_trunc('month', created_at) as cohort_month
    from public.profiles
    where created_at >= date_trunc('month', now()) - (months_back || ' months')::interval
  ),
  cohort_sizes as (select cohort_month, count(*) as cohort_size from cohorts group by cohort_month),
  activity_months as (
    select distinct fan_id as user_id, date_trunc('month', created_at) as active_month
    from public.analytics_fan_events
    where event_type in ('play', 'qualified') and fan_id is not null
  ),
  offsets as (select generate_series(0, months_back) as month_offset)
  select to_char(c.cohort_month, 'YYYY-MM'), cs.cohort_size, o.month_offset, count(distinct am.user_id)
  from cohorts c
  join cohort_sizes cs on cs.cohort_month = c.cohort_month
  cross join offsets o
  left join activity_months am
    on am.user_id = c.user_id and am.active_month = c.cohort_month + (o.month_offset || ' months')::interval
  where c.cohort_month + (o.month_offset || ' months')::interval <= date_trunc('month', now())
  group by c.cohort_month, cs.cohort_size, o.month_offset
  order by c.cohort_month, o.month_offset;
$$;

-- Attribution: a visit with a referrer but no utm_source is referral traffic
-- from that site, not "direct"; purchases are counted inside the window too.
create or replace function public.get_attribution_breakdown(since timestamptz)
returns table (source text, medium text, campaign text, signups bigint, purchases bigint, revenue_cents bigint)
language sql stable security definer set search_path = public as $$
  with attributed as (
    select
      id as user_id,
      coalesce(
        nullif(first_touch->>'source', ''),
        'referral:' || nullif(lower(regexp_replace(substring(first_touch->>'referrer' from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#:]+)'), '^www\.', '')), ''),
        'direct'
      ) as source,
      coalesce(nullif(first_touch->>'medium', ''), case when first_touch->>'referrer' is not null and first_touch->>'source' is null then 'referral' end, 'none') as medium,
      coalesce(nullif(first_touch->>'campaign', ''), 'none') as campaign
    from public.profiles
    where created_at >= since
  ),
  purchase_totals as (
    select user_id, count(*) as purchases, sum(amount_cents) as revenue_cents
    from public.purchases
    where status = 'completed' and purchased_at >= since
    group by user_id
  )
  select a.source, a.medium, a.campaign, count(*),
         coalesce(sum(pt.purchases), 0), coalesce(sum(pt.revenue_cents), 0)::bigint
  from attributed a left join purchase_totals pt on pt.user_id = a.user_id
  group by a.source, a.medium, a.campaign
  order by count(*) desc;
$$;

-- ── Listening times: fan listening only; global hours in the artist's time zone ──
create or replace function public.get_listening_time_patterns(since timestamptz)
returns table (hour_of_day int, day_of_week int, plays bigint)
language sql stable security definer set search_path = public as $$
  select
    extract(hour from created_at at time zone 'America/Chicago')::int as hour_of_day,
    extract(dow from created_at at time zone 'America/Chicago')::int as day_of_week,
    count(*) as plays
  from public.analytics_fan_events
  where event_type = 'play' and created_at >= since
  group by 1, 2
  order by 2, 1;
$$;

-- Regional local-time patterns: unchanged regions and time zones, now over
-- fan listening only (no admins, no previews). Region is populated from
-- 2026-11-19 (Vercel x-vercel-ip-country-region); older US plays have no
-- state and fall back to US Eastern, as before.
create or replace function public.get_regional_listening_patterns(since timestamptz)
returns table (
  region      text,
  hour_of_day int,
  day_of_week int,
  plays       bigint
)
language sql
stable
security definer
as $$
  with zoned as (
    select
      case
        when country = 'US' and region in ('CT','DE','FL','GA','IN','KY','ME','MD','MA','MI','NH','NJ','NY','NC','OH','PA','RI','SC','VT','VA','WV','DC') then 'US — Eastern'
        when country = 'US' and region in ('AL','AR','IL','IA','KS','LA','MN','MS','MO','NE','ND','OK','SD','TN','TX','WI') then 'US — Central'
        when country = 'US' and region in ('AZ','CO','ID','MT','NM','UT','WY') then 'US — Mountain'
        when country = 'US' and region in ('CA','NV','OR','WA') then 'US — Pacific'
        when country = 'US' and region = 'AK' then 'US — Alaska'
        when country = 'US' and region = 'HI' then 'US — Hawaii'
        when country = 'US' then 'US — Eastern'
        when country = 'CA' then 'Canada'
        when country in ('GB','IE','PT') then 'UK & Ireland'
        when country in ('FR','ES','DE','IT','NL','BE','CH','AT','DK','NO','SE','PL','CZ','SK','HU','SI','HR') then 'Central Europe'
        when country in ('FI','EE','LV','LT','RO','BG','GR','UA','MD','BY','RS','BA','MK','AL','ME','XK') then 'Eastern Europe'
        when country = 'RU' then 'Russia'
        when country in ('TR','IL','SA','AE','QA','KW','BH','OM','JO','LB','IQ','IR','YE','SY','PS') then 'Middle East'
        when country in ('EG','MA','DZ','TN','LY','SD') then 'North Africa'
        when country in ('NG','GH','KE','ZA','ET','TZ','UG','SN','CI','CM','ZW','RW','AO','MZ','ZM','MW','BW','NA','LS','SZ','BI','SL','LR','GN','GW','ML','BF','NE','TD','CF','CG','CD','GA','GQ','ST','CV','KM','DJ','ER','GM','TG','BJ','MR','MU','SC','SS') then 'Sub-Saharan Africa'
        when country = 'KR' then 'Korea'
        when country = 'JP' then 'Japan'
        when country in ('CN','HK','TW','MN') then 'China & Taiwan'
        when country in ('IN','PK','BD','LK','NP','BT','MV','AF') then 'South Asia'
        when country in ('TH','VN','ID','MY','PH','SG','KH','LA','MM','BN','TL') then 'Southeast Asia'
        when country in ('AU','NZ','FJ','PG','SB','VU','WS','TO','KI','FM','PW','MH','NR','TV') then 'Oceania'
        when country in ('BR','AR','CL','CO','PE','VE','EC','BO','PY','UY','GY','SR') then 'South America'
        when country in ('MX','GT','HN','SV','NI','CR','PA','BZ','CU','DO','HT','JM','TT','BS','BB','LC','GD','VC','AG','KN','DM') then 'Central America & Caribbean'
        when country in ('KZ','UZ','TM','KG','TJ','AM','AZ','GE') then 'Central Asia & Caucasus'
        else 'Other'
      end as region,
      case
        when country = 'US' and region in ('CT','DE','FL','GA','IN','KY','ME','MD','MA','MI','NH','NJ','NY','NC','OH','PA','RI','SC','VT','VA','WV','DC') then created_at at time zone 'America/New_York'
        when country = 'US' and region in ('AL','AR','IL','IA','KS','LA','MN','MS','MO','NE','ND','OK','SD','TN','TX','WI') then created_at at time zone 'America/Chicago'
        when country = 'US' and region in ('AZ','CO','ID','MT','NM','UT','WY') then created_at at time zone 'America/Denver'
        when country = 'US' and region in ('CA','NV','OR','WA') then created_at at time zone 'America/Los_Angeles'
        when country = 'US' and region = 'AK' then created_at at time zone 'America/Anchorage'
        when country = 'US' and region = 'HI' then created_at at time zone 'Pacific/Honolulu'
        when country = 'US' then created_at at time zone 'America/New_York'
        when country = 'CA' then created_at at time zone 'America/Toronto'
        when country in ('GB','IE','PT') then created_at at time zone 'Europe/London'
        when country in ('FR','ES','DE','IT','NL','BE','CH','AT','DK','NO','SE','PL','CZ','SK','HU','SI','HR') then created_at at time zone 'Europe/Berlin'
        when country in ('FI','EE','LV','LT','RO','BG','GR','UA','MD','BY','RS','BA','MK','AL','ME','XK') then created_at at time zone 'Europe/Athens'
        when country = 'RU' then created_at at time zone 'Europe/Moscow'
        when country in ('TR','IL','SA','AE','QA','KW','BH','OM','JO','LB','IQ','IR','YE','SY','PS') then created_at at time zone 'Asia/Dubai'
        when country in ('EG','MA','DZ','TN','LY','SD') then created_at at time zone 'Africa/Cairo'
        when country in ('NG','GH','KE','ZA','ET','TZ','UG','SN','CI','CM','ZW','RW','AO','MZ','ZM','MW','BW','NA','LS','SZ','BI','SL','LR','GN','GW','ML','BF','NE','TD','CF','CG','CD','GA','GQ','ST','CV','KM','DJ','ER','GM','TG','BJ','MR','MU','SC','SS') then created_at at time zone 'Africa/Lagos'
        when country = 'KR' then created_at at time zone 'Asia/Seoul'
        when country = 'JP' then created_at at time zone 'Asia/Tokyo'
        when country in ('CN','HK','TW','MN') then created_at at time zone 'Asia/Shanghai'
        when country in ('IN','PK','BD','LK','NP','BT','MV','AF') then created_at at time zone 'Asia/Kolkata'
        when country in ('TH','VN','ID','MY','PH','SG','KH','LA','MM','BN','TL') then created_at at time zone 'Asia/Bangkok'
        when country in ('AU','NZ','FJ','PG','SB','VU','WS','TO','KI','FM','PW','MH','NR','TV') then created_at at time zone 'Australia/Sydney'
        when country in ('BR','AR','CL','CO','PE','VE','EC','BO','PY','UY','GY','SR') then created_at at time zone 'America/Sao_Paulo'
        when country in ('MX','GT','HN','SV','NI','CR','PA','BZ','CU','DO','HT','JM','TT','BS','BB','LC','GD','VC','AG','KN','DM') then created_at at time zone 'America/Mexico_City'
        when country in ('KZ','UZ','TM','KG','TJ','AM','AZ','GE') then created_at at time zone 'Asia/Almaty'
        else created_at at time zone 'UTC'
      end as local_ts
    from public.analytics_fan_events
    where event_type = 'play'
      and created_at >= since
      and country is not null
  )
  select
    region,
    extract(hour from local_ts)::int as hour_of_day,
    extract(dow from local_ts)::int as day_of_week,
    count(*) as plays
  from zoned
  group by region, hour_of_day, day_of_week
  order by region, day_of_week, hour_of_day;
$$;

-- ── Access: service role only (the admin API), never the browser ────────────
revoke all on public.analytics_fan_events from public, anon, authenticated;
grant select on public.analytics_fan_events to service_role;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.analytics_overview(timestamptz, timestamptz)',
    'public.analytics_track_stats(timestamptz, timestamptz)',
    'public.analytics_daily(timestamptz, timestamptz, text)',
    'public.analytics_geo(timestamptz, timestamptz)',
    'public.analytics_listener_growth(text)',
    'public.analytics_fan_demographics(timestamptz, timestamptz)',
    'public.get_funnel_stats(timestamptz)',
    'public.get_cohort_retention(int)',
    'public.get_attribution_breakdown(timestamptz)',
    'public.get_listening_time_patterns(timestamptz)',
    'public.get_regional_listening_patterns(timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
