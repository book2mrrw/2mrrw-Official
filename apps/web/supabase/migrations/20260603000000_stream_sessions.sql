-- Concurrent stream session guard (one active session per user+product within overlap window).

create table if not exists public.stream_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists stream_sessions_user_product_expires_idx
  on public.stream_sessions (user_id, product_id, expires_at desc);

create index if not exists stream_sessions_expires_at_idx
  on public.stream_sessions (expires_at);

alter table public.stream_sessions enable row level security;

drop policy if exists "stream_sessions_select_own" on public.stream_sessions;
create policy "stream_sessions_select_own" on public.stream_sessions
  for select using (auth.uid() = user_id);

comment on table public.stream_sessions is 'Active library stream leases; service role manages writes.';
