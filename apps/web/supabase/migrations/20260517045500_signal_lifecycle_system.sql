-- Production signal lifecycle source of truth and per-user tracking.
-- The public client does not write these tables directly; app routes use the
-- service role and apply delivery/reward rules server-side.

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null default 'text'
    check (type in ('text', 'audio', 'video', 'hybrid')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'expired', 'archived')),
  trigger_mode text not null default 'persistent'
    check (trigger_mode in ('persistent', 'live_window', 'hybrid')),
  priority integer not null default 0,
  duration_ms integer not null default 5200
    check (duration_ms between 3000 and 10000),
  payload jsonb not null default '{}'::jsonb,
  loot jsonb not null default '{}'::jsonb,
  audience_rules jsonb not null default '{"scope":"all"}'::jsonb,
  unlock_rules jsonb not null default '{}'::jsonb,
  timestamp_schedule jsonb not null default '{}'::jsonb,
  starts_at timestamptz,
  expires_at timestamptz,
  live_starts_at timestamptz,
  live_expires_at timestamptz,
  timezone text not null default 'America/Chicago',
  cooldown_enabled boolean not null default false,
  cooldown_metadata jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.signal_user_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  signal_id uuid not null references public.signals (id) on delete cascade,
  viewed_at timestamptz,
  completed_at timestamptz,
  ignored_at timestamptz,
  interaction_duration_ms integer
    check (interaction_duration_ms is null or interaction_duration_ms >= 0),
  loot_claimed_at timestamptz,
  loot_status text not null default 'none'
    check (loot_status in ('none', 'intent_recorded', 'claimed', 'rejected')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, signal_id)
);

create index if not exists signals_active_lookup_idx
  on public.signals (status, trigger_mode, priority desc, starts_at, expires_at)
  where status = 'active';

create index if not exists signals_live_window_idx
  on public.signals (live_starts_at, live_expires_at)
  where status = 'active';

create index if not exists signal_user_states_user_signal_idx
  on public.signal_user_states (user_id, signal_id);

create index if not exists signal_user_states_signal_user_idx
  on public.signal_user_states (signal_id, user_id);

drop trigger if exists signals_updated_at on public.signals;
create trigger signals_updated_at before update on public.signals
  for each row execute function public.set_updated_at();

drop trigger if exists signal_user_states_updated_at on public.signal_user_states;
create trigger signal_user_states_updated_at before update on public.signal_user_states
  for each row execute function public.set_updated_at();

alter table public.signals enable row level security;
alter table public.signal_user_states enable row level security;

drop policy if exists "signals_select_active" on public.signals;

drop policy if exists "signal_user_states_select_own" on public.signal_user_states;
create policy "signal_user_states_select_own"
  on public.signal_user_states
  for select
  using (auth.uid() = user_id);
