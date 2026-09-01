-- FULL REPAIR: run this entire file in Supabase SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / DROP POLICY IF EXISTS).
-- Fixes: missing products, legacy purchases, partial 001 failures.

create extension if not exists "pgcrypto";

-- ── PROFILES ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  email text,
  avatar_url text,
  mfa_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);

-- ── PRODUCTS (required before library_items / access_tokens) ─────────────────
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  product_type text not null check (product_type in (
    'single', 'album', 'feature', 'vault', 'vinyl', 'ticket', 'merch', 'bundle'
  )),
  price_cents integer not null check (price_cents >= 0),
  cover_url text,
  storage_path text,
  preview_path text,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_slug_idx on public.products (slug);
create index if not exists products_type_idx on public.products (product_type);
create index if not exists products_active_idx on public.products (active) where active = true;

-- ── PURCHASES ─────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases' and column_name = 'item_slug'
  ) then
    alter table public.purchases rename to purchases_legacy;
  end if;
end $$;

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_payment_intent_id text unique,
  stripe_checkout_session_id text unique,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'refunded')),
  items jsonb not null default '[]'::jsonb,
  receipt_url text,
  purchased_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists purchases_user_id_idx on public.purchases (user_id);
create index if not exists purchases_status_idx on public.purchases (status);
create index if not exists purchases_purchased_at_idx on public.purchases (purchased_at desc);

-- ── LIBRARY ITEMS ─────────────────────────────────────────────────────────────
create table if not exists public.library_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  purchase_id uuid references public.purchases (id) on delete set null,
  source text not null default 'purchase' check (source in ('purchase', 'grant', 'bundle')),
  granted_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index if not exists library_items_user_id_idx on public.library_items (user_id);
create index if not exists library_items_product_id_idx on public.library_items (product_id);

-- ── ACCESS TOKENS ─────────────────────────────────────────────────────────────
create table if not exists public.access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  purchase_id uuid references public.purchases (id) on delete set null,
  token_hash text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists access_tokens_user_id_idx on public.access_tokens (user_id);
create index if not exists access_tokens_token_hash_idx on public.access_tokens (token_hash);

-- ── AUTO PROFILE ON SIGNUP ───────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── UPDATED_AT ─────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.purchases enable row level security;
alter table public.library_items enable row level security;
alter table public.access_tokens enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

drop policy if exists "products_select_active" on public.products;
create policy "products_select_active" on public.products for select using (active = true);

drop policy if exists "purchases_select_own" on public.purchases;
create policy "purchases_select_own" on public.purchases for select using (auth.uid() = user_id);

drop policy if exists "library_select_own" on public.library_items;
create policy "library_select_own" on public.library_items for select using (auth.uid() = user_id);

drop policy if exists "access_tokens_select_own" on public.access_tokens;
create policy "access_tokens_select_own" on public.access_tokens for select using (auth.uid() = user_id);
