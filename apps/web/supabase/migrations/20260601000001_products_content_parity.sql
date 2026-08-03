-- Align storefront products with control 0020_universal_commerce_catalog (additive).
-- Rollback: columns are nullable; safe to leave in place.

alter table public.products
  add column if not exists content_type text check (
    content_type is null or content_type in ('release', 'collector_card', 'vault_item', 'vault_access', 'track')
  ),
  add column if not exists content_id uuid,
  add column if not exists gifting_enabled boolean not null default false;

comment on column public.products.content_type is 'release | collector_card | vault_item | vault_access | track';
comment on column public.products.content_id is 'UUID of linked control/storefront content row.';

create index if not exists products_content_idx
  on public.products (content_type, content_id)
  where content_id is not null;

-- Mirror metadata.content_* when top-level columns were never set.
update public.products
set
  content_type = coalesce(content_type, nullif(metadata->>'content_type', '')),
  content_id = coalesce(content_id, nullif(metadata->>'content_id', '')::uuid),
  gifting_enabled = coalesce(gifting_enabled, (metadata->>'gifting_enabled')::boolean, false)
where content_type is null
   or content_id is null;
