-- Aggregate play statistics at the DB level so the analytics route
-- never pulls 10k individual rows into application memory.
-- Returns one row per product_slug with play count and average completion rate.
create or replace function get_play_stats(since timestamptz)
returns table (
  product_slug text,
  plays        bigint,
  avg_completion numeric
)
language sql
stable
security definer
as $$
  select
    product_slug,
    count(*)                          as plays,
    avg(completion_rate)::numeric     as avg_completion
  from media_stream_events
  where event_type = 'play'
    and created_at >= since
    and product_slug is not null
  group by product_slug
  order by plays desc;
$$;

grant execute on function get_play_stats(timestamptz) to service_role;
