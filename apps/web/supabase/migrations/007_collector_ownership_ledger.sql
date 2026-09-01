-- Collector ownership ledger for verified physical access-key collectibles.

create table if not exists public.collector_ownerships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  purchase_id uuid references public.purchases (id) on delete set null,
  product_slug text not null,
  title text not null,
  collector_type text not null default 'collector_card' check (collector_type in ('collector_card', 'collector_bundle', 'verified_collectible')),
  sku text,
  version text,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  stripe_order_id text,
  payment_status text not null default 'completed' check (payment_status in ('completed', 'refunded', 'disputed')),
  verification_status text not null default 'verified' check (verification_status in ('pending', 'verified', 'revoked')),
  entitlement_status text not null default 'active' check (entitlement_status in ('active', 'paused', 'revoked')),
  customer_email text,
  customer_phone text,
  shipping_name text,
  shipping_country text,
  shipping_state text,
  shipping_city text,
  shipping_postal_code text,
  shipping_address_line1 text,
  shipping_address_line2 text,
  metadata jsonb not null default '{}'::jsonb,
  purchased_at timestamptz not null default now(),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index if not exists collector_ownerships_user_idx
  on public.collector_ownerships (user_id, purchased_at desc);

create index if not exists collector_ownerships_product_idx
  on public.collector_ownerships (product_id, purchased_at desc);

create index if not exists collector_ownerships_slug_idx
  on public.collector_ownerships (product_slug);

create index if not exists collector_ownerships_region_idx
  on public.collector_ownerships (shipping_country, shipping_state, shipping_city);

create index if not exists collector_ownerships_entitlement_idx
  on public.collector_ownerships (entitlement_status, verification_status)
  where entitlement_status = 'active' and verification_status = 'verified';

drop trigger if exists collector_ownerships_updated_at on public.collector_ownerships;
create trigger collector_ownerships_updated_at
  before update on public.collector_ownerships
  for each row execute function public.set_updated_at();

alter table public.collector_ownerships enable row level security;

drop policy if exists "collector_ownerships_select_own" on public.collector_ownerships;
create policy "collector_ownerships_select_own"
  on public.collector_ownerships for select
  using (auth.uid() = user_id);

-- Writes are performed by server-side Stripe webhook/API fulfillment using service role.
