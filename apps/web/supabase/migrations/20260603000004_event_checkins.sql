-- Event check-in log for NFC/JWT verification at shows (physical presence).

create table if not exists public.event_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  collector_card_id uuid references public.collector_cards (id) on delete set null,
  event_name text not null default 'general',
  checkin_method text not null default 'nfc' check (
    checkin_method in ('nfc', 'jwt', 'admin', 'manual')
  ),
  status text not null default 'checked_in' check (
    status in ('checked_in', 'duplicate', 'blocked', 'revoked')
  ),
  device_info jsonb not null default '{}'::jsonb,
  ip_hash text,
  metadata jsonb not null default '{}'::jsonb,
  checked_in_at timestamptz not null default now()
);

create index if not exists event_checkins_user_idx
  on public.event_checkins (user_id, checked_in_at desc)
  where user_id is not null;

create index if not exists event_checkins_card_idx
  on public.event_checkins (collector_card_id, checked_in_at desc)
  where collector_card_id is not null;

create index if not exists event_checkins_event_idx
  on public.event_checkins (event_name, checked_in_at desc);

alter table public.event_checkins enable row level security;

drop policy if exists "event_checkins_select_own" on public.event_checkins;
create policy "event_checkins_select_own"
  on public.event_checkins
  for select
  using (auth.uid() = user_id);

comment on table public.event_checkins is 'Physical event attendance; distinct from digital vault/streaming entitlements.';
