-- Forward-only correction to 20260827000052: the previous version of
-- activate_scheduled_release() treated `UPDATE products ... WHERE release_id
-- = p_release_id` affecting zero rows as ordinary success — Postgres does not
-- raise an error for an UPDATE that matches no rows. That meant a release
-- could still commit as releases.status='published' with no corresponding
-- active product, silently reconstructing exactly the split-brain state this
-- function exists to prevent.
--
-- Domain invariant, verified against the actual publish path (publish/route.js):
-- a release can only ever reach status='scheduled' after the SAME request
-- has already upserted its products row (products.release_id is a plain FK,
-- not schema-enforced unique, so the "exactly one" guarantee is an
-- application invariant this function must now assert, not assume). No
-- delete path removes a products row while its release stays
-- scheduled/published. This function now enforces that invariant explicitly:
-- if the products update does not affect exactly one row, it raises inside
-- the same transaction, rolling back the releases update alongside it.

begin;

set local lock_timeout = '5s';

create or replace function public.activate_scheduled_release(
  p_release_id uuid,
  p_now timestamptz default now()
) returns table (activated boolean, release_id uuid, slug text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text;
  v_product_count integer;
begin
  update public.releases
    set status = 'published',
        storefront_visible = true,
        published_at = coalesce(published_at, p_now)
    where id = p_release_id
      and status = 'scheduled'
      and available_at is not null
      and available_at <= p_now
    returning slug into v_slug;

  if v_slug is null then
    -- Not due, already activated, or not in a scheduled state — safe no-op.
    return query select false, p_release_id, null::text;
    return;
  end if;

  update public.products
    set active = true
    where release_id = p_release_id;
  get diagnostics v_product_count = row_count;

  if v_product_count <> 1 then
    -- Zero rows: no product exists for this release — the split-brain case
    -- this function exists to prevent. More than one: release_id is not
    -- actually unique on products in the schema, and this function's
    -- guarantee depends on it being so in practice; either way, committing a
    -- status flip without a confirmed 1:1 product transition is unsafe.
    -- Raising here rolls back the releases update above in the same
    -- transaction — the release stays 'scheduled' and the next cron tick
    -- retries it, rather than silently going live with no active product.
    raise exception
      'activate_scheduled_release: release % expected exactly one products row, found %',
      p_release_id, v_product_count;
  end if;

  return query select true, p_release_id, v_slug;
end;
$$;

revoke all on function public.activate_scheduled_release(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.activate_scheduled_release(uuid, timestamptz) to service_role;

commit;
