-- Admin gifting system (2026-05-22 spec)

create extension if not exists "pgcrypto";

alter table public.profiles
  add column if not exists role text not null default 'user' check (role in ('user', 'admin'));

alter table public.profiles
  add column if not exists phone_verified boolean not null default false;

create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sender_id uuid references auth.users (id) on delete set null,
  recipient_id uuid references auth.users (id) on delete set null,
  recipient_email text not null,
  recipient_phone text,
  item_type text check (item_type in ('single', 'ep', 'album', 'deluxe', 'collector_card')),
  item_id uuid not null,
  item_title text,
  message text,
  claimed boolean not null default false,
  claimed_at timestamptz,
  gift_link_token text unique default encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz not null default (now() + interval '15 days'),
  notified_email boolean not null default false,
  reminder_sent boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'expired', 'revoked'))
);

create index if not exists idx_gifts_recipient_id on public.gifts (recipient_id);
create index if not exists idx_gifts_recipient_email on public.gifts (lower(recipient_email));
create index if not exists idx_gifts_token on public.gifts (gift_link_token);
create index if not exists idx_gifts_status on public.gifts (status);
create index if not exists idx_gifts_sender on public.gifts (sender_id);
create index if not exists idx_gifts_item on public.gifts (item_id, lower(recipient_email));

alter table public.gifts enable row level security;

drop policy if exists "gifts_admin_full_access" on public.gifts;
create policy "gifts_admin_full_access" on public.gifts
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "gifts_recipient_read_own" on public.gifts;
create policy "gifts_recipient_read_own" on public.gifts
  for select using (auth.uid() = recipient_id);

alter table public.purchases
  add column if not exists purchase_type text not null default 'purchase';

alter table public.purchases
  add column if not exists gifted_by uuid references auth.users (id) on delete set null;

alter table public.purchases
  add column if not exists gift_id uuid references public.gifts (id) on delete set null;

alter table public.purchases
  add column if not exists item_id uuid;

alter table public.purchases
  add column if not exists item_type text;

alter table public.purchases
  add column if not exists price_paid integer not null default 0;

alter table public.library_items
  add column if not exists gifted_by uuid references auth.users (id) on delete set null;

alter table public.library_items
  add column if not exists gift_id uuid references public.gifts (id) on delete set null;

alter table public.purchases
  drop constraint if exists purchases_status_check;

alter table public.purchases
  add constraint purchases_status_check
  check (status in ('pending', 'completed', 'failed', 'refunded', 'revoked'));

drop trigger if exists gifts_updated_at on public.gifts;
create trigger gifts_updated_at before update on public.gifts
  for each row execute function public.set_updated_at();
