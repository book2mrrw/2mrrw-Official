-- Shows and live events listing for the platform (distinct from event_checkins
-- which logs physical NFC attendance, and stream_events which logs audio analytics).

begin;

create table if not exists public.shows_events (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  location      text        not null,
  event_date    date        not null,
  event_time    text        not null,
  price_cents   integer     not null default 0 check (price_cents >= 0),
  tickets_available integer,
  ticket_url    text,
  active        boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists shows_events_date_active_idx
  on public.shows_events (event_date asc)
  where active = true;

alter table public.shows_events enable row level security;

drop policy if exists "shows_events_public_read" on public.shows_events;
create policy "shows_events_public_read"
  on public.shows_events
  for select
  using (active = true);

comment on table public.shows_events is 'Upcoming live show listings displayed on the platform shows tab. Distinct from event_checkins (physical NFC attendance) and stream_events (audio streaming analytics).';

-- Seed with the current static events from page.js so existing data is preserved.
insert into public.shows_events (name, location, event_date, event_time, price_cents, tickets_available)
values
  ('2MRRW Live – Dallas',      'Dallas, TX',       '2026-05-10', '8:00 PM', 2500, 50),
  ('2MRRW Live – Houston',     'Houston, TX',      '2026-05-24', '9:00 PM', 2500, 75),
  ('2MRRW Live – Atlanta',     'Atlanta, GA',      '2026-06-07', '8:30 PM', 3000, 60),
  ('2MRRW Live – LA',          'Los Angeles, CA',  '2026-06-21', '9:00 PM', 3500, 40),
  ('2MRRW Live – NYC',         'New York, NY',     '2026-07-04', '8:00 PM', 3500, 45)
on conflict do nothing;

commit;

-- ── Rollback (manual; not auto-run) ─────────────────────────────────────────
-- drop table if exists public.shows_events;
