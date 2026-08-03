-- Invisible operational hardening for launch traffic and scalable guest identity lookup.

create table if not exists public.api_rate_limits (
  key text primary key,
  route_key text not null,
  identifier_hash text not null,
  window_start timestamptz not null,
  expires_at timestamptz not null,
  count integer not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists api_rate_limits_expires_at_idx
  on public.api_rate_limits (expires_at);

create index if not exists api_rate_limits_route_window_idx
  on public.api_rate_limits (route_key, window_start desc);

alter table public.api_rate_limits enable row level security;

drop trigger if exists api_rate_limits_updated_at on public.api_rate_limits;
create trigger api_rate_limits_updated_at before update on public.api_rate_limits
  for each row execute function public.set_updated_at();

create index if not exists profiles_email_phone_lookup_idx
  on public.profiles (lower(email), phone)
  where email is not null and phone is not null;

create index if not exists profiles_phone_lookup_idx
  on public.profiles (phone)
  where phone is not null;
