-- Printful distinguishes two different ids per variant: the "sync variant"
-- id (external_variant_id) identifies THIS store's specific design+size/color
-- combo and is what order creation (POST /orders) must reference; the plain
-- catalog "variant_id" (catalog_variant_id) identifies the blank product/size
-- in Printful's generic catalog and is what shipping-rate lookups
-- (POST /shipping/rates) require instead — confirmed against the real API,
-- each endpoint rejects the other id with a 400. Both are needed.
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  external_variant_id text not null,
  catalog_variant_id text,
  sku text,
  size text,
  color text,
  price_cents integer not null check (price_cents >= 0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, external_variant_id)
);

create index if not exists product_variants_product_id_idx on public.product_variants(product_id);

-- external_product_id is Printful's sync_product.id — the stable key the
-- catalog sync matches against on every re-sync so re-running it updates
-- existing rows instead of creating duplicates.
alter table public.products
  add column if not exists external_product_id text;

create unique index if not exists products_external_product_id_uidx
  on public.products (external_product_id)
  where external_product_id is not null;

create table if not exists public.merch_fulfillments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique references public.purchases(id) on delete cascade,
  provider text not null default 'printful',
  external_order_id text,
  status text not null default 'pending'
    check (status in ('pending','submitted','shipped','delivered','failed','canceled')),
  tracking_number text,
  tracking_url text,
  carrier text,
  shipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists merch_fulfillments_external_order_id_idx on public.merch_fulfillments(external_order_id);

alter table public.purchases
  add column if not exists shipping_address jsonb,
  add column if not exists shipping_rate_cents integer;

alter table public.purchase_items
  add column if not exists variant_id uuid references public.product_variants(id);
