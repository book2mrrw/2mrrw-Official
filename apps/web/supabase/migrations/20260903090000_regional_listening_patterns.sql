-- Extends P4's peak-listening-time analytics with real local time of day
-- across major world regions, instead of only raw UTC. Uses Postgres's own
-- IANA timezone database via `timestamptz AT TIME ZONE 'zone_name'`, which
-- correctly applies each zone's real DST rules for the specific date of every
-- row — not a fixed hand-rolled offset that would drift wrong for half the
-- year. Entirely read-side over existing media_stream_events.country/region
-- (already populated from Vercel's geo headers on every play event) — no new
-- column, no new write-path instrumentation.
--
-- Country/state-level geo is the ceiling of what this schema knows about a
-- listener's location, so a handful of large countries (the US primarily,
-- via its already-recorded state in `region`) get split into their real
-- internal zones; every other country maps to one representative zone for
-- its most populous region — the same simplification virtually every
-- analytics platform makes without per-city geolocation.
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
    from public.media_stream_events
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

grant execute on function public.get_regional_listening_patterns(timestamptz) to service_role;
