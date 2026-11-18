-- An event is either a show (tickets) or a 2MRRW Live event. The homepage
-- 2MRRW Live countdown follows the next upcoming active event of type 'live'
-- whenever no broadcast is live or scheduled. Existing events stay shows.

alter table public.shows_events
  add column if not exists event_type text not null default 'show';

alter table public.shows_events
  drop constraint if exists shows_events_event_type_check;
alter table public.shows_events
  add constraint shows_events_event_type_check check (event_type in ('show', 'live'));

create index if not exists shows_events_upcoming_live_idx
  on public.shows_events (event_date asc)
  where active = true and event_type = 'live';
