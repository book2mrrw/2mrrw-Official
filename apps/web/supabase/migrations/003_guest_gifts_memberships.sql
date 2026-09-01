-- Guest identity support, gifting, and optional membership layer.
-- Core guest identity reuses auth.users + public.profiles so existing purchases/library
-- can keep using user_id while the user never sees a password flow.

create extension if not exists "pgcrypto";

-- Enforce the production guest identity key: email + phone.
create unique index if not exists profiles_email_phone_unique_idx
  on public.profiles (lower(email), phone)
  where email is not null and phone is not null;

-- Optional VIP/membership layer. Purchases do not require this table.
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tier text not null default 'vip',
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'canceled')),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  started_at timestamptz not null default now(),
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memberships_user_id_idx on public.memberships (user_id);
create index if not exists memberships_status_idx on public.memberships (status);

-- Gift links let the creator grant albums/songs/cards without payment.
create table if not exists public.gift_links (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  token_hash text not null unique,
  active boolean not null default true,
  max_redemptions integer,
  redemption_count integer not null default 0,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gift_link_items (
  id uuid primary key default gen_random_uuid(),
  gift_link_id uuid not null references public.gift_links (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  unique (gift_link_id, product_id)
);

create table if not exists public.gift_redemptions (
  id uuid primary key default gen_random_uuid(),
  gift_link_id uuid not null references public.gift_links (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (gift_link_id, user_id)
);

create index if not exists gift_link_items_link_idx on public.gift_link_items (gift_link_id);
create index if not exists gift_redemptions_user_idx on public.gift_redemptions (user_id);

alter table public.memberships enable row level security;
alter table public.gift_links enable row level security;
alter table public.gift_link_items enable row level security;
alter table public.gift_redemptions enable row level security;

drop policy if exists "memberships_select_own" on public.memberships;
create policy "memberships_select_own" on public.memberships for select using (auth.uid() = user_id);

drop policy if exists "gift_redemptions_select_own" on public.gift_redemptions;
create policy "gift_redemptions_select_own" on public.gift_redemptions for select using (auth.uid() = user_id);

drop trigger if exists memberships_updated_at on public.memberships;
create trigger memberships_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();
