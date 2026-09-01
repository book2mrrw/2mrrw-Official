-- Stream analytics events (start on stream route, end via /api/stream/end).

create table if not exists public.stream_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists stream_events_user_started_idx
  on public.stream_events (user_id, started_at desc);

create index if not exists stream_events_product_idx
  on public.stream_events (product_id, started_at desc);

alter table public.stream_events enable row level security;

drop policy if exists "stream_events_select_own" on public.stream_events;
create policy "stream_events_select_own" on public.stream_events
  for select using (auth.uid() = user_id);

comment on table public.stream_events is 'Library stream analytics; service role inserts/updates.';
