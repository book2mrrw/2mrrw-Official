-- Per-item revenue ledger. purchases.amount_cents remains the single source
-- of truth for what was actually charged on a purchase (potentially
-- multi-item, via the existing purchases.items JSONB) — this table allocates
-- that real charged total across the individual items, proportional to each
-- item's list price, so sum(unit_price_cents * quantity) for a purchase
-- always exactly equals purchases.amount_cents, even when a collector
-- discount was applied to the checkout as a whole. This is what makes
-- revenue summable per release/product instead of only countable.

create table if not exists public.purchase_items (
  id                uuid        primary key default gen_random_uuid(),
  purchase_id       uuid        not null references public.purchases(id) on delete cascade,
  product_id        uuid        references public.products(id) on delete set null,
  product_slug      text        not null,
  title             text,
  item_type         text        not null default 'digital' check (item_type in ('digital', 'merch')),
  access_type       text,
  release_id        uuid,
  unit_price_cents  integer     not null check (unit_price_cents >= 0),
  quantity          integer     not null default 1 check (quantity > 0),
  created_at        timestamptz not null default now()
);

create index if not exists purchase_items_purchase_id_idx on public.purchase_items (purchase_id);
create index if not exists purchase_items_product_slug_idx on public.purchase_items (product_slug);
create index if not exists purchase_items_product_id_idx on public.purchase_items (product_id);

comment on table public.purchase_items is
  'Per-item revenue allocation for a purchase. Populated at fulfillment time (fulfill-purchase.js) alongside the existing purchases row — never a replacement for purchases.items, which remains the raw checkout-time snapshot.';
