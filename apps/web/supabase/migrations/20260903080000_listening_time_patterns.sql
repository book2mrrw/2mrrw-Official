-- P4 (peak-listening-time / day-of-week only — queue/shuffle analytics was
-- deliberately deferred: it would require new instrumentation inside the
-- playback engine itself, which this project treats as sacrosanct). Entirely
-- read-side over media_stream_events.created_at, which every play event
-- already carries — no new write-path instrumentation needed.
--
-- Buckets in UTC (the timestamps' native storage timezone) rather than
-- attempting per-fan local time, which this schema has no reliable way to
-- infer — bucketing in a fan's local time would require a timezone on every
-- profile, which doesn't exist and would need geo/IP-based guessing far less
-- reliable than the UTC hour actually recorded.
create or replace function public.get_listening_time_patterns(since timestamptz)
returns table (
  hour_of_day int,
  day_of_week int,
  plays       bigint
)
language sql
stable
security definer
as $$
  select
    extract(hour from created_at)::int as hour_of_day,
    extract(dow from created_at)::int as day_of_week,
    count(*) as plays
  from public.media_stream_events
  where event_type = 'play'
    and created_at >= since
  group by hour_of_day, day_of_week
  order by day_of_week, hour_of_day;
$$;

grant execute on function public.get_listening_time_patterns(timestamptz) to service_role;
