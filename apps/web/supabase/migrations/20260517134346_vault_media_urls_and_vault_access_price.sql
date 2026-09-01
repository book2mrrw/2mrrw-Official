-- Align Vault Access pricing and external media URL support.

alter table public.vault_content
  add column if not exists thumbnail_url text,
  add column if not exists preview_url text,
  add column if not exists content_url text;

update public.products
set title = 'Vault Access',
    price_cents = 2799,
    metadata = coalesce(metadata, '{}'::jsonb) ||
      '{"access_tier":"vault_pass","one_time":true,"requires_active_subscription":true,"description":"Lifetime full Vault archive access for active subscribers"}'::jsonb,
    active = true,
    updated_at = now()
where slug = 'vault-pass';

insert into public.products (slug, title, product_type, price_cents, cover_url, metadata, active)
values (
  'vault-pass',
  'Vault Access',
  'vault',
  2799,
  '/images/albums/lovehz.jpg',
  '{"access_tier":"vault_pass","one_time":true,"requires_active_subscription":true,"description":"Lifetime full Vault archive access for active subscribers"}'::jsonb,
  true
)
on conflict (slug) do update
set title = excluded.title,
    product_type = excluded.product_type,
    price_cents = excluded.price_cents,
    cover_url = excluded.cover_url,
    metadata = public.products.metadata || excluded.metadata,
    active = true,
    updated_at = now();

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
  thumbnail_url,
  preview_url,
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

grant select on public.public_vault_content to anon, authenticated;
