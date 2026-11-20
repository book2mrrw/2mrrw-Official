-- Public play counts on release cards (owner decision 2026-11-19: streams earn
-- no revenue, but each release card shows its plays).
--
-- A release's count is its lifetime fan plays: 'play' events attributed to the
-- release (album songs count toward their album), never admin sessions and
-- never previews — the same definition as the analytics dashboard.

-- Plays recorded before media_stream_events.product_id existed (before
-- 2026-09-07) were keyed only by the release slug. Attach them to their
-- release so lifetime counts include them. Fills a missing reference; no
-- event's facts change.
update public.media_stream_events e
set product_id = p.id
from public.products p
where e.product_id is null
  and e.product_slug = p.slug;

-- Index-only counting of fan plays per release.
create index if not exists media_stream_events_fan_plays_idx
  on public.media_stream_events (product_id)
  where event_type = 'play' and not is_internal and coalesce(access_tier, 'full') = 'full';

create or replace function public.release_play_counts()
returns table (product_id uuid, plays bigint)
language sql stable set search_path = public as $$
  select product_id, count(*)
  from public.media_stream_events
  where event_type = 'play' and not is_internal and coalesce(access_tier, 'full') = 'full'
    and product_id is not null
  group by product_id;
$$;

revoke all on function public.release_play_counts() from public, anon, authenticated;
grant execute on function public.release_play_counts() to service_role;
