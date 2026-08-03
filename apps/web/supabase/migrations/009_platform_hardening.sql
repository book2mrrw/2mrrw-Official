-- Platform hardening: fulfillment idempotency and safe public read surfaces.

create table if not exists public.fulfillment_orders (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  provider text not null check (provider in ('printful')),
  status text not null default 'pending' check (status in ('pending', 'submitted', 'failed', 'canceled')),
  external_order_id text,
  external_status text,
  idempotency_key text not null unique,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_id, provider)
);

create index if not exists fulfillment_orders_purchase_idx
  on public.fulfillment_orders (purchase_id);

create index if not exists fulfillment_orders_status_idx
  on public.fulfillment_orders (provider, status, created_at desc);

drop trigger if exists fulfillment_orders_updated_at on public.fulfillment_orders;
create trigger fulfillment_orders_updated_at
  before update on public.fulfillment_orders
  for each row execute function public.set_updated_at();

alter table public.fulfillment_orders enable row level security;

drop policy if exists "fulfillment_orders_select_own" on public.fulfillment_orders;
create policy "fulfillment_orders_select_own"
  on public.fulfillment_orders for select
  using (
    exists (
      select 1 from public.purchases
      where purchases.id = fulfillment_orders.purchase_id
        and purchases.user_id = auth.uid()
    )
  );

create or replace view public.public_products
with (security_invoker = true) as
select
  id,
  slug,
  title,
  product_type,
  price_cents,
  cover_url,
  metadata,
  active,
  created_at,
  updated_at
from public.products
where active = true;

create or replace view public.public_vault_content
with (security_invoker = true) as
select
  id,
  slug,
  category,
  title,
  description,
  access_tier,
  media_type,
  atmosphere,
  behavior,
  cover_url,
  duration_seconds,
  sort_order,
  featured,
  visibility,
  published_at,
  metadata,
  created_at,
  updated_at
from public.vault_content
where visibility = 'published';

revoke select on public.products from anon, authenticated;
revoke select on public.vault_content from anon, authenticated;
grant select on public.public_products to anon, authenticated;
grant select on public.public_vault_content to anon, authenticated;
