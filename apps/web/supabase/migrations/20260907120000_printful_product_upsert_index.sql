-- PostgREST's on_conflict=external_product_id cannot infer the original
-- partial index (it does not supply a WHERE predicate). Every product upsert
-- therefore fails with 42P10 before any size/color variants can be saved.
-- A normal unique index still allows multiple NULLs for non-Printful products.
begin;
drop index if exists public.products_external_product_id_uidx;
create unique index products_external_product_id_uidx
  on public.products (external_product_id);
commit;
