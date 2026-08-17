-- Twitch / live broadcast session state
-- One row per scheduled or active session; is_live = true for the currently broadcasting session.

create table if not exists public.live_broadcasts (
  id                          uuid        primary key default gen_random_uuid(),
  title                       text        not null default '2MRRW Live',
  platform                    text        not null default 'twitch',
  channel                     text        not null default 'callme2mrrw',
  is_live                     boolean     not null default false,
  goes_live_at                timestamptz,
  ended_at                    timestamptz,
  notification_24h_sent_at    timestamptz,
  notification_prelive_sent_at timestamptz,
  notification_live_sent_at   timestamptz,
  audience                    text        not null default 'all' check (audience in ('all','subscriber','collector','purchaser')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- Only one session may be live at a time.
create unique index if not exists live_broadcasts_one_live_idx
  on public.live_broadcasts (is_live)
  where (is_live = true);

-- Service role writes; everyone can read (public show schedule).
alter table public.live_broadcasts enable row level security;

drop policy if exists "live_broadcasts_public_read" on public.live_broadcasts;
create policy "live_broadcasts_public_read" on public.live_broadcasts
  for select using (true);

comment on table public.live_broadcasts is 'Twitch live broadcast schedule and current is_live state; service role manages writes.';
